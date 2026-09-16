import { db } from '@/lib/db';
import { scanWindowMigration } from '@/lib/scan-windows';
import type { Sql, TransactionSql } from 'postgres';

let ready: Promise<void> | null = null;
const rollingVersion = '2026-09-17-rolling-scans-v1';
const sampleVersion = '2026-09-17-sample-assignments-v1';

export function ensureInventorySchema() {
  if (!ready) ready = migrateInventorySchema(db()).catch((error) => { ready = null; throw error; });
  return ready;
}

async function migrationsApplied(database: Sql | TransactionSql) {
  // Most cold starts only need to read the migration markers. Do not acquire
  // an exclusive metadata-table lock (ALTER/REVOKE) after migration is complete.
  // Resolve the registry through this connection's search_path, never a hard-
  // coded public schema: isolated test schemas and custom installs must work.
  const [registry] = await database`select to_regclass('ims_schema_migrations') is not null as exists`;
  if (registry.exists) {
    const applied = await database`select version from ims_schema_migrations
      where version in (${rollingVersion},${sampleVersion})`;
    if (applied.length === 2) return true;
  }
  return false;
}

async function boundMigrationTransaction(sql: TransactionSql) {
  // These settings last only this transaction, including pooled connections.
  await sql`set local lock_timeout = '5s'`;
  await sql`set local statement_timeout = '45s'`;
  await sql`set local idle_in_transaction_session_timeout = '60s'`;
}

export async function migrateInventorySchema(database: ReturnType<typeof db>) {
  // Bound even the marker SELECT: it can wait behind an older DDL transaction.
  // End this read transaction before waiting for the migration advisory lock,
  // so its metadata read locks cannot deadlock another instance's DDL.
  const applied = await database.begin('read only', async sql => {
    await boundMigrationTransaction(sql);
    return migrationsApplied(sql);
  });
  if (applied) return;

  await database.begin(async (sql) => {
  // A busy table or abandoned serverless transaction must not stall every
  // inventory request indefinitely.
  await boundMigrationTransaction(sql);
  // Serialize cold-start migrations across serverless instances.
  await sql`select pg_advisory_xact_lock(78243190)`;
  // Another cold instance may have completed the migration while we waited.
  if (await migrationsApplied(sql)) return;
  await sql`create table if not exists ims_schema_migrations (version text primary key,applied_at timestamptz not null default now())`;
  await sql`alter table ims_schema_migrations enable row level security`;
  await sql`revoke all on ims_schema_migrations from public`;
  const version = rollingVersion;
  if (!(await sql`select version from ims_schema_migrations where version=${version}`).length) {
  await sql`create table if not exists ims_materials (
    id uuid primary key default gen_random_uuid(),
    inventory_type varchar(20) not null check (inventory_type in ('TOOL','SAMPLE')),
    name varchar(160) not null,
    code varchar(12) not null unique,
    image_url text,
    image_source_url text,
    description text,
    active boolean not null default true,
    created_by uuid references ims_users(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`;
  await sql`alter table ims_inventory_items add column if not exists material_id uuid references ims_materials(id)`;
  await sql`alter table ims_inventory_items add column if not exists unit_number integer`;
  await sql`alter table ims_issues add column if not exists image_url text`;
  await sql`alter table ims_issues add column if not exists archived boolean not null default false`;
  await sql`create table if not exists ims_scan_attempts (
    id uuid primary key default gen_random_uuid(),
    scanner_user_id uuid not null references ims_users(id),
    inventory_item_id uuid references ims_inventory_items(id),
    barcode varchar(100) not null,
    matched boolean not null default false,
    capture_method varchar(20) not null check (capture_method in ('CAMERA','MANUAL')),
    latitude double precision not null,
    longitude double precision not null,
    location_accuracy double precision,
    captured_at timestamptz not null,
    created_at timestamptz not null default now()
  )`;
  await sql`alter table ims_scans add column if not exists validation_attempt_id uuid references ims_scan_attempts(id)`;
  await sql`alter table ims_scans add column if not exists capture_method varchar(20) check (capture_method in ('CAMERA','MANUAL'))`;
  await sql`alter table ims_scans add column if not exists latitude double precision`;
  await sql`alter table ims_scans add column if not exists longitude double precision`;
  await sql`alter table ims_scans add column if not exists location_accuracy double precision`;
  await sql`alter table ims_scans add column if not exists captured_at timestamptz`;
  await sql`alter table ims_scans add column if not exists evidence_image_url text`;
  await sql`create index if not exists idx_inventory_material on ims_inventory_items(material_id,unit_number)`;
  await sql`create index if not exists idx_scan_attempts_user_time on ims_scan_attempts(scanner_user_id,created_at desc)`;
  await sql.unsafe(scanWindowMigration);
  await sql`insert into ims_schema_migrations(version) values(${version})`;
  }

  // Keep each migration independent: existing installations already have the
  // rolling-scan version, but must still receive new sample assignment columns.
  if (!(await sql`select version from ims_schema_migrations where version=${sampleVersion}`).length) {
    await sql`alter table ims_materials add column if not exists customer_name varchar(160)`;
    await sql`alter table ims_materials add column if not exists employee_name varchar(160)`;
    // Existing samples remain unassigned until an administrator edits them.
    // No scan, location, barcode, or movement history is rewritten.
    await sql`alter table ims_materials enable row level security`;
    await sql`revoke all on ims_materials from public`;
    await sql`do $$ declare role_name text; begin
      foreach role_name in array array['anon','authenticated'] loop
        if exists(select 1 from pg_roles where rolname=role_name) then
          execute format('revoke all on ims_materials from %I',role_name);
        end if;
      end loop;
    end $$`;
    await sql`insert into ims_schema_migrations(version) values(${sampleVersion})`;
  }
  });
}
