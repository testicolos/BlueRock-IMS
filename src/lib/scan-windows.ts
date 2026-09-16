// Immutable scan events are retained; a window is the replaceable reporting record.
// Run inside the inventory migration transaction/advisory lock.
export const scanWindowMigration = `
  create table if not exists ims_scan_windows (
    id uuid primary key default gen_random_uuid(),
    inventory_item_id uuid not null references ims_inventory_items(id),
    started_at timestamptz not null,
    expires_at timestamptz not null,
    check (expires_at = started_at + interval '24 hours')
  );
  alter table ims_scans add column if not exists scan_window_id uuid references ims_scan_windows(id);
  create index if not exists idx_scan_windows_item_time on ims_scan_windows(inventory_item_id,started_at desc);
  create index if not exists idx_scans_window_time on ims_scans(scan_window_id,scanned_at desc,created_at desc);
  alter table ims_inventory_items add column if not exists archived_at timestamptz;
  update ims_inventory_items set archived_at=updated_at where archived and archived_at is null;
  create or replace function ims_track_inventory_archive() returns trigger language plpgsql as $$
  begin
    if new.archived and not old.archived then new.archived_at=clock_timestamp(); end if;
    if not new.archived then new.archived_at=null; end if;
    return new;
  end $$;
  create or replace trigger ims_inventory_archive_timestamp before update of archived on ims_inventory_items
    for each row execute function ims_track_inventory_archive();

  -- Backfill original events without changing their timestamps, evidence or issue references.
  do $$ declare event record; window_id uuid; window_end timestamptz; begin
    for event in select id,inventory_item_id,scanned_at from ims_scans
      where scan_window_id is null order by inventory_item_id,scanned_at,created_at,id
    loop
      select id,expires_at into window_id,window_end from ims_scan_windows
        where inventory_item_id=event.inventory_item_id and started_at<=event.scanned_at
        order by started_at desc limit 1;
      if window_id is null or event.scanned_at>=window_end then
        insert into ims_scan_windows(inventory_item_id,started_at,expires_at)
          values(event.inventory_item_id,event.scanned_at,event.scanned_at+interval '24 hours')
          returning id into window_id;
      end if;
      update ims_scans set scan_window_id=window_id where id=event.id;
    end loop;
  end $$;

  -- Compatibility for in-flight requests from the previous deployment. Such
  -- inserts must not become invisible to reports after the one-time backfill.
  create or replace function ims_assign_scan_window() returns trigger language plpgsql as $$
  begin
    if new.scan_window_id is null then
      perform 1 from ims_inventory_items where id=new.inventory_item_id for update;
      select id into new.scan_window_id from ims_scan_windows
        where inventory_item_id=new.inventory_item_id and started_at<=new.scanned_at and expires_at>new.scanned_at
        order by started_at desc limit 1;
      if new.scan_window_id is null then
        insert into ims_scan_windows(inventory_item_id,started_at,expires_at)
          values(new.inventory_item_id,new.scanned_at,new.scanned_at+interval '24 hours')
          returning id into new.scan_window_id;
      end if;
    end if;
    return new;
  end $$;
  create or replace trigger ims_scan_window_assignment before insert on ims_scans
    for each row execute function ims_assign_scan_window();
  alter table ims_scans alter column scan_window_id set not null;

  create table if not exists ims_scan_report_settings (
    id boolean primary key default true check (id),
    anchor_at timestamptz not null
  );
  insert into ims_scan_report_settings(id,anchor_at)
    select true,date_trunc('milliseconds',coalesce(min(started_at),clock_timestamp())) from ims_scan_windows
    on conflict (id) do nothing;
  alter table ims_scan_windows enable row level security;
  alter table ims_scan_report_settings enable row level security;
  alter table ims_scan_attempts enable row level security;
  revoke all on ims_scan_windows,ims_scan_report_settings,ims_scan_attempts from public;
  do $$ declare role_name text; begin
    foreach role_name in array array['anon','authenticated'] loop
      if exists(select 1 from pg_roles where rolname=role_name) then
        execute format('revoke all on ims_scan_windows,ims_scan_report_settings,ims_scan_attempts from %I',role_name);
      end if;
    end loop;
  end $$;
`;
