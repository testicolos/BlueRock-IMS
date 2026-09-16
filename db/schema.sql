create extension if not exists pgcrypto;

create table if not exists ims_users (
  id uuid primary key default gen_random_uuid(),
  username varchar(80) not null unique,
  password_hash text not null,
  full_name varchar(120) not null,
  role varchar(20) not null check (role in ('ADMIN','SCANNER')) default 'SCANNER',
  active boolean not null default true,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ims_locations (
  id uuid primary key default gen_random_uuid(),
  name varchar(120) not null,
  code varchar(30) not null unique,
  description text,
  address text,
  location_type varchar(60),
  active boolean not null default true,
  created_by uuid references ims_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ims_categories (
  id uuid primary key default gen_random_uuid(),
  name varchar(120) not null,
  inventory_type varchar(20) not null check (inventory_type in ('TOOL','SAMPLE')),
  active boolean not null default true,
  unique(name,inventory_type)
);

create table if not exists ims_materials (
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
);

create table if not exists ims_inventory_items (
  id uuid primary key default gen_random_uuid(),
  barcode varchar(100) not null unique,
  inventory_type varchar(20) not null check (inventory_type in ('TOOL','SAMPLE')),
  name varchar(160) not null,
  material_id uuid references ims_materials(id),
  unit_number integer,
  description text,
  category_id uuid references ims_categories(id),
  manufacturer varchar(120),
  model varchar(120),
  serial_number varchar(120),
  current_location_id uuid references ims_locations(id),
  condition varchar(30) not null check (condition in ('GOOD','MINOR_ISSUE','DAMAGED','MISSING_PARTS','NEEDS_MAINTENANCE')) default 'GOOD',
  status varchar(30) not null check (status in ('ACTIVE','INACTIVE','MAINTENANCE','LOST','RETIRED')) default 'ACTIVE',
  archived boolean not null default false,
  last_scanned_at timestamptz,
  last_scanned_by uuid references ims_users(id),
  created_by uuid references ims_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ims_scans (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references ims_inventory_items(id),
  barcode varchar(100) not null,
  previous_location_id uuid references ims_locations(id),
  new_location_id uuid not null references ims_locations(id),
  scanner_user_id uuid not null references ims_users(id),
  condition varchar(30) not null,
  notes text,
  client_transaction_id uuid not null unique,
  scanned_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists ims_issues (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references ims_inventory_items(id),
  scan_id uuid references ims_scans(id),
  reported_by uuid not null references ims_users(id),
  issue_type varchar(120) not null,
  description text not null,
  image_url text,
  status varchar(20) not null check (status in ('OPEN','RESOLVED')) default 'OPEN',
  reported_at timestamptz not null default now(),
  resolved_by uuid references ims_users(id),
  resolution_note text,
  resolved_at timestamptz,
  updated_at timestamptz not null default now(),
  archived boolean not null default false
);

create table if not exists ims_audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references ims_users(id),
  action varchar(100) not null,
  entity varchar(100) not null,
  entity_id uuid,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_inventory_barcode on ims_inventory_items(barcode);
create index if not exists idx_inventory_location on ims_inventory_items(current_location_id);
create index if not exists idx_inventory_type on ims_inventory_items(inventory_type);
create index if not exists idx_inventory_material on ims_inventory_items(material_id,unit_number);
create index if not exists idx_scans_item_time on ims_scans(inventory_item_id,scanned_at desc);
create index if not exists idx_scans_user_time on ims_scans(scanner_user_id,scanned_at desc);
create index if not exists idx_issues_status on ims_issues(status,reported_at desc);
