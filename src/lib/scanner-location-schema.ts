import type { Sql, TransactionSql } from 'postgres';

import { db } from '@/lib/db';

let ready: Promise<void> | null = null;

export function ensureScannerLocationSchema() {
  if (!ready) ready = migrateScannerLocationSchema(db()).catch((error) => { ready = null; throw error; });
  return ready;
}

export async function migrateScannerLocationSchema(database: Sql | TransactionSql) {
  await database`alter table ims_users add column if not exists assigned_location_id uuid references ims_locations(id)`;
  await database`create index if not exists idx_users_assigned_location on ims_users(assigned_location_id) where active=true`;
  await database`alter table ims_scans alter column new_location_id drop not null`;
  await database`create table if not exists ims_location_transfers (
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
  await database`create unique index if not exists idx_location_transfers_one_pending_item on ims_location_transfers(inventory_item_id) where status='PENDING'`;
  await database`create index if not exists idx_location_transfers_destination on ims_location_transfers(destination_location_id,status,requested_at desc)`;
  await database`alter table ims_location_transfers enable row level security`;
  await database`revoke all on ims_location_transfers from public`;
}
