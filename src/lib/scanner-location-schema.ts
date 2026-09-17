import type { Sql, TransactionSql } from 'postgres';

import { db } from '@/lib/db';

let ready: Promise<void> | null = null;
const scannerLocationVersion = '2026-09-17-scanner-location-transfers-v1';
const scannerLocationLock = 78243191;

export function ensureScannerLocationSchema() {
  if (!ready) ready = migrateScannerLocationSchema(db()).catch((error) => { ready = null; throw error; });
  return ready;
}

async function boundMigrationTransaction(sql: TransactionSql) {
  await sql`set local lock_timeout = '5s'`;
  await sql`set local statement_timeout = '45s'`;
  await sql`set local idle_in_transaction_session_timeout = '60s'`;
}

async function migrationApplied(database: Sql | TransactionSql) {
  const [registry] = await database`select to_regclass('ims_schema_migrations') is not null as exists`;
  if (!registry.exists) return false;
  const rows = await database`select version from ims_schema_migrations where version=${scannerLocationVersion}`;
  return rows.length > 0;
}

export async function migrateScannerLocationSchema(database: Sql) {
  const applied = await database.begin('read only', async sql => {
    await boundMigrationTransaction(sql);
    return migrationApplied(sql);
  });
  if (applied) return;

  await database.begin(async sql => {
    await boundMigrationTransaction(sql);
    await sql`select pg_advisory_xact_lock(${scannerLocationLock})`;
    if (await migrationApplied(sql)) return;

    await sql`create table if not exists ims_schema_migrations (
      version text primary key,
      applied_at timestamptz not null default now()
    )`;
    await sql`alter table ims_schema_migrations enable row level security`;
    await sql`revoke all on ims_schema_migrations from public`;

    await sql`alter table ims_users add column if not exists assigned_location_id uuid references ims_locations(id)`;
    await sql`create index if not exists idx_users_assigned_location on ims_users(assigned_location_id) where active=true`;
    await sql`alter table ims_scans alter column new_location_id drop not null`;
    await sql`create table if not exists ims_location_transfers (
      id uuid primary key default gen_random_uuid(),
      inventory_item_id uuid not null references ims_inventory_items(id),
      from_location_id uuid references ims_locations(id),
      destination_location_id uuid not null references ims_locations(id),
      requested_by uuid not null references ims_users(id),
      request_scan_id uuid references ims_scans(id),
      status varchar(20) not null check (status in ('PENDING','APPROVED','REJECTED')) default 'PENDING',
      decided_by uuid references ims_users(id),
      requested_at timestamptz not null default now(),
      decided_at timestamptz,
      decision_note text,
      check ((status='PENDING' and decided_at is null and decided_by is null) or (status in ('APPROVED','REJECTED') and decided_at is not null and decided_by is not null))
    )`;
    await sql`create unique index if not exists idx_location_transfers_one_pending_item on ims_location_transfers(inventory_item_id) where status='PENDING'`;
    await sql`create index if not exists idx_location_transfers_destination on ims_location_transfers(destination_location_id,status,requested_at desc)`;
    await sql`alter table ims_location_transfers enable row level security`;
    await sql`revoke all on ims_location_transfers from public`;
    await sql`insert into ims_schema_migrations(version) values(${scannerLocationVersion}) on conflict (version) do nothing`;
  });
}
