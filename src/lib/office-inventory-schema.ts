import type { Sql, TransactionSql } from 'postgres';

import { db } from '@/lib/db';

let ready: Promise<void> | null = null;
const officeLock = 78243192;

export function ensureOfficeInventorySchema() {
  if (!ready) ready = migrateOfficeInventorySchema(db()).catch((error) => { ready = null; throw error; });
  return ready;
}

async function boundMigrationTransaction(sql: TransactionSql) {
  await sql`set local lock_timeout = '4s'`;
  await sql`set local statement_timeout = '30s'`;
  await sql`set local idle_in_transaction_session_timeout = '45s'`;
}

async function officeSchemaApplied(database: Sql | TransactionSql) {
  const [row] = await database`
    select
      to_regclass('ims_office_inventory_items') is not null as items,
      to_regclass('ims_office_owner_history') is not null as owner_history,
      to_regclass('ims_office_validation_sessions') is not null as sessions,
      to_regclass('ims_office_validation_targets') is not null as targets,
      to_regclass('ims_office_validation_scans') is not null as scans
  `;
  return Boolean(row?.items && row?.owner_history && row?.sessions && row?.targets && row?.scans);
}

export async function migrateOfficeInventorySchema(database: Sql) {
  const applied = await database.begin('read only', async sql => {
    await boundMigrationTransaction(sql);
    return officeSchemaApplied(sql);
  });
  if (applied) return;

  await database.begin(async tx => {
    await boundMigrationTransaction(tx);
    const [lock] = await tx`select pg_try_advisory_xact_lock(${officeLock}) as locked`;
    if (!lock?.locked) {
      const error = Object.assign(new Error('Office Inventory schema migration is already running'), { code: '55P03' });
      throw error;
    }
    if (await officeSchemaApplied(tx)) return;

    await tx`create table if not exists ims_office_inventory_items (
      id uuid primary key default gen_random_uuid(),
      barcode varchar(100) not null unique,
      name varchar(160) not null,
      category varchar(120) not null,
      manufacturer varchar(120),
      model varchar(120),
      serial_number varchar(120),
      owner_name varchar(160),
      current_location_id uuid references ims_locations(id),
      condition varchar(30) not null check (condition in ('GOOD','MINOR_ISSUE','DAMAGED','MISSING_PARTS','NEEDS_MAINTENANCE')) default 'GOOD',
      status varchar(30) not null check (status in ('ACTIVE','INACTIVE','MAINTENANCE','LOST','RETIRED')) default 'ACTIVE',
      archived boolean not null default false,
      last_validated_at timestamptz,
      last_validated_by uuid references ims_users(id),
      created_by uuid references ims_users(id),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )`;

    await tx`create table if not exists ims_office_owner_history (
      id uuid primary key default gen_random_uuid(),
      inventory_item_id uuid not null references ims_office_inventory_items(id),
      previous_owner varchar(160),
      new_owner varchar(160),
      changed_by uuid not null references ims_users(id),
      changed_at timestamptz not null default now()
    )`;

    await tx`create table if not exists ims_office_validation_sessions (
      id uuid primary key default gen_random_uuid(),
      status varchar(20) not null check (status in ('OPEN','CLOSED')) default 'OPEN',
      started_by uuid not null references ims_users(id),
      started_at timestamptz not null default now(),
      closed_by uuid references ims_users(id),
      closed_at timestamptz,
      check ((status='OPEN' and closed_at is null) or (status='CLOSED' and closed_at is not null))
    )`;

    await tx`create table if not exists ims_office_validation_targets (
      session_id uuid not null references ims_office_validation_sessions(id) on delete cascade,
      inventory_item_id uuid not null references ims_office_inventory_items(id),
      validated_at timestamptz,
      validated_by uuid references ims_users(id),
      primary key(session_id,inventory_item_id)
    )`;

    await tx`create table if not exists ims_office_validation_scans (
      id uuid primary key default gen_random_uuid(),
      session_id uuid not null references ims_office_validation_sessions(id),
      inventory_item_id uuid not null references ims_office_inventory_items(id),
      barcode varchar(100) not null,
      scanner_user_id uuid not null references ims_users(id),
      condition varchar(30) not null check (condition in ('GOOD','MINOR_ISSUE','DAMAGED','MISSING_PARTS','NEEDS_MAINTENANCE')),
      scanned_at timestamptz not null default now()
    )`;

    await tx`create unique index if not exists idx_office_validation_one_open
      on ims_office_validation_sessions((1)) where status='OPEN'`;
    await tx`create index if not exists idx_office_inventory_barcode on ims_office_inventory_items(barcode)`;
    await tx`create index if not exists idx_office_inventory_owner on ims_office_inventory_items(owner_name)`;
    await tx`create index if not exists idx_office_owner_history_item on ims_office_owner_history(inventory_item_id,changed_at desc)`;
    await tx`create index if not exists idx_office_validation_targets_session on ims_office_validation_targets(session_id,validated_at)`;
    await tx`create index if not exists idx_office_validation_scans_session on ims_office_validation_scans(session_id,scanned_at desc)`;

    for (const table of [
      'ims_office_inventory_items',
      'ims_office_owner_history',
      'ims_office_validation_sessions',
      'ims_office_validation_targets',
      'ims_office_validation_scans',
    ]) {
      await tx.unsafe(`alter table ${table} enable row level security`);
      await tx.unsafe(`revoke all on ${table} from public`);
    }

    await tx`do $$ declare role_name text; table_name text; begin
      foreach role_name in array array['anon','authenticated'] loop
        if exists(select 1 from pg_roles where rolname=role_name) then
          foreach table_name in array array[
            'ims_office_inventory_items',
            'ims_office_owner_history',
            'ims_office_validation_sessions',
            'ims_office_validation_targets',
            'ims_office_validation_scans'
          ] loop
            execute format('revoke all on %I from %I',table_name,role_name);
          end loop;
        end if;
      end loop;
    end $$`;
  });
}

export function officeCategoryCode(category: string) {
  const normalized = category.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return (normalized.slice(0, 3) || 'ITM').padEnd(3, 'X');
}

export function officeBarcode(category: string, sequence: number) {
  return `OI-${officeCategoryCode(category)}-${String(sequence).padStart(4, '0')}`;
}
