import type { Sql, TransactionSql } from 'postgres';

import { db } from '@/lib/db';

export type ScannerAccess = 'MATERIALS' | 'OFFICE' | 'BOTH';
export type ScanArea = 'MATERIALS' | 'OFFICE';

let ready: Promise<void> | null = null;
const scannerAccessVersion = '2026-09-23-scanner-access-v1';
const scannerAccessLock = 78243194;

export function ensureScannerAccessSchema() {
  if (!ready) ready = migrateScannerAccessSchema(db()).catch(error => { ready = null; throw error; });
  return ready;
}

async function boundMigrationTransaction(sql: TransactionSql) {
  await sql`set local lock_timeout = '5s'`;
  await sql`set local statement_timeout = '30s'`;
  await sql`set local idle_in_transaction_session_timeout = '45s'`;
}

async function migrationApplied(database: Sql | TransactionSql) {
  const [registry] = await database`select to_regclass('ims_schema_migrations') is not null as exists`;
  if (!registry?.exists) return false;
  const [row] = await database`
    select exists(
      select 1 from ims_schema_migrations where version=${scannerAccessVersion}
    ) as applied,
    exists(
      select 1 from information_schema.columns
      where table_schema=current_schema() and table_name='ims_users' and column_name='scanner_access'
    ) as has_column
  `;
  return Boolean(row?.applied && row?.has_column);
}

export async function migrateScannerAccessSchema(database: Sql) {
  const applied = await database.begin('read only', async sql => {
    await boundMigrationTransaction(sql);
    return migrationApplied(sql);
  });
  if (applied) return;

  await database.begin(async sql => {
    await boundMigrationTransaction(sql);
    await sql`select pg_advisory_xact_lock(${scannerAccessLock})`;
    if (await migrationApplied(sql)) return;

    await sql`create table if not exists ims_schema_migrations (
      version text primary key,
      applied_at timestamptz not null default now()
    )`;
    await sql`alter table ims_schema_migrations enable row level security`;
    await sql`revoke all on ims_schema_migrations from public`;

    await sql`alter table ims_users
      add column if not exists scanner_access varchar(20) not null default 'MATERIALS'`;

    await sql`do $$ begin
      if not exists (
        select 1 from pg_constraint where conname='ims_users_scanner_access_check'
      ) then
        alter table ims_users add constraint ims_users_scanner_access_check
          check (scanner_access in ('MATERIALS','OFFICE','BOTH'));
      end if;
    end $$`;

    await sql`update ims_users set scanner_access='MATERIALS'
      where role='SCANNER' and scanner_access not in ('MATERIALS','OFFICE','BOTH')`;

    await sql`create index if not exists idx_users_scanner_access
      on ims_users(scanner_access) where role='SCANNER' and active=true`;

    await sql`insert into ims_schema_migrations(version)
      values(${scannerAccessVersion}) on conflict (version) do nothing`;
  });
}

export function scannerAccessAllows(access: ScannerAccess, area: ScanArea) {
  return access === 'BOTH' || access === area;
}

export async function scannerAccessForUser(user: { id: string; role: 'ADMIN' | 'SCANNER' }) {
  if (user.role === 'ADMIN') return 'BOTH' as ScannerAccess;
  await ensureScannerAccessSchema();
  const [row] = await db()`
    select scanner_access from ims_users
    where id=${user.id} and role='SCANNER' and active=true limit 1
  `;
  if (!row) throw new Error('SCANNER_ACCOUNT_NOT_FOUND');
  return (row.scanner_access || 'MATERIALS') as ScannerAccess;
}

export async function requireScannerAccess(user: { id: string; role: 'ADMIN' | 'SCANNER' }, area: ScanArea) {
  const access = await scannerAccessForUser(user);
  if (!scannerAccessAllows(access, area)) throw new Error('SCAN_ACCESS_DENIED');
  return access;
}
