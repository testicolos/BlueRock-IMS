import { db } from '@/lib/db';
import { scanWindowMigration } from '@/lib/scan-windows';

let ready: Promise<void> | null = null;

export function ensureInventorySchema() {
  if (!ready) ready = migrate().catch((error) => { ready = null; throw error; });
  return ready;
}

async function migrate() {
  await db().begin(async (sql) => {
  // Serialize cold-start migrations across serverless instances.
  await sql`select pg_advisory_xact_lock(78243190)`;
  await sql`create table if not exists ims_schema_migrations (version text primary key,applied_at timestamptz not null default now())`;
  await sql`alter table ims_schema_migrations enable row level security`;
  await sql`revoke all on ims_schema_migrations from public`;
  const version = '2026-09-17-rolling-scans-v1';
  if ((await sql`select version from ims_schema_migrations where version=${version}`).length) return;
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
  });
}
