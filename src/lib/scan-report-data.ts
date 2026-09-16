import { db } from '@/lib/db';
import type { ReportPeriod } from '@/lib/scan-report-periods';
import type { ReportInventoryType } from '@/lib/scan-report-scope';

type Timestamp = Date | string;
export type ChecklistRow = {
  id: string; barcode: string; name: string; inventory_type: 'TOOL' | 'SAMPLE';
  location_name: string | null; status: 'SCANNED' | 'NOT_SCANNED';
  customer_name: string | null; employee_name: string | null;
  scan_id: string | null; scanned_at: Timestamp | null;
  window_started_at: Timestamp | null; window_expires_at: Timestamp | null;
  scanner_name: string | null; condition: string | null; photo_count: number;
  latitude: number | null; longitude: number | null; location_accuracy: number | null;
  period_scan_count: number; period_scanned: boolean; period_photo_count: number;
};
export type ScanReport = ReportPeriod & { rows: ChecklistRow[]; inventoryType: ReportInventoryType };

export async function reportClock(sql: ReturnType<typeof db>) {
  // PostgreSQL timestamp text depends on connection DateStyle. Numeric epochs
  // remain stable across pooled connections and avoid the driver's Date parser.
  const [settings] = await sql<{anchor_ms: number; now_ms: number}[]>`
    select (extract(epoch from anchor_at)*1000)::double precision as anchor_ms,
      (extract(epoch from clock_timestamp())*1000)::double precision as now_ms
    from ims_scan_report_settings where id=true
  `;
  const anchor = Math.trunc(Number(settings?.anchor_ms));
  const now = Math.trunc(Number(settings?.now_ms));
  if (settings?.anchor_ms == null || settings?.now_ms == null
    || !Number.isFinite(new Date(anchor).getTime()) || !Number.isFinite(new Date(now).getTime())) {
    throw new Error('INVALID_REPORT_CLOCK');
  }
  return {now, anchor};
}

export async function reportsAt(periods: ReportPeriod[], sql: ReturnType<typeof db>, inventoryType: ReportInventoryType = 'ALL', sessionId: string | null = null): Promise<ScanReport[]> {
  if (!periods.length) return [];
  const contexts = periods.map(period => ({report_id: period.id, starts_at: period.startsAt,
    ends_at: period.endsAt, as_of: period.asOf, is_current: period.current}));
  // Batch all selected days in one query, avoiding a database round trip per day.
  const rows = await sql<(ChecklistRow & {report_id: string})[]>`
    with periods as (
      select * from jsonb_to_recordset(${sql.json(contexts)}::jsonb)
        as p(report_id text,starts_at timestamptz,ends_at timestamptz,as_of timestamptz,is_current boolean)
    )
    select p.report_id,i.id,i.barcode,i.name,i.inventory_type,l.name as location_name,
      m.customer_name,m.employee_name,
      case when w.expires_at>p.as_of then 'SCANNED' else 'NOT_SCANNED' end as status,
      s.id as scan_id,
      to_char(s.scanned_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as scanned_at,
      to_char(w.started_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as window_started_at,
      to_char(w.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as window_expires_at,
      u.full_name as scanner_name,s.condition,coalesce(photos.photo_count,0)::int as photo_count,
      s.latitude,s.longitude,s.location_accuracy,
      activity.period_scan_count,activity.period_scan_count>0 as period_scanned,activity.period_photo_count
    from periods p cross join ims_inventory_items i
    left join ims_materials m on m.id=i.material_id
    left join lateral (
      select id,scanned_at,new_location_id,scanner_user_id,condition,scan_window_id,latitude,longitude,location_accuracy
      from ims_scans where inventory_item_id=i.id and scanned_at<=p.as_of
        and (${sessionId}::uuid is null or session_id=${sessionId})
      order by scanned_at desc,created_at desc,id desc limit 1
    ) s on true
    left join ims_scan_windows w on w.id=s.scan_window_id
    left join lateral (
      select count(*)::int as photo_count from ims_scans
      where scan_window_id=w.id and scanned_at<=s.scanned_at and nullif(evidence_image_url,'') is not null
        and (${sessionId}::uuid is null or session_id=${sessionId})
    ) photos on true
    left join lateral (
      select count(*)::int as period_scan_count,
        count(*) filter(where nullif(evidence_image_url,'') is not null)::int as period_photo_count
      from ims_scans where inventory_item_id=i.id and scanned_at>=p.starts_at
        and scanned_at<p.ends_at and scanned_at<=p.as_of
        and (${sessionId}::uuid is null or session_id=${sessionId})
    ) activity on true
    left join lateral (
      select id,previous_location_id from ims_scans
      where inventory_item_id=i.id and scanned_at>p.as_of
        and (${sessionId}::uuid is null or session_id=${sessionId})
      order by scanned_at,created_at,id limit 1
    ) future on s.id is null
    left join ims_locations l on l.id=case when s.id is not null then s.new_location_id
      when future.id is not null then future.previous_location_id else i.current_location_id end
    left join ims_users u on u.id=s.scanner_user_id
    where i.created_at<=p.as_of
      and (${inventoryType}='ALL' or i.inventory_type=${inventoryType})
      and (p.is_current and not i.archived
        or not p.is_current and (i.archived_at is null or i.archived_at>p.as_of))
    order by p.starts_at,i.name,i.barcode
  `;
  const groups = new Map<string, ChecklistRow[]>();
  for (const {report_id, ...row} of rows) {
    const group = groups.get(report_id) ?? [];
    group.push(row);
    groups.set(report_id, group);
  }
  return periods.map(period => ({...period, inventoryType, rows: groups.get(period.id) ?? []}));
}
