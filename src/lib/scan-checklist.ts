import { db } from '@/lib/db';

const DAY = 24 * 60 * 60 * 1000;

export async function scanChecklist(period: string | null, sql = db()) {
  const [settings] = await sql`
    select anchor_at,clock_timestamp() as server_now from ims_scan_report_settings where id=true
  `;
  const now = new Date(settings.server_now).getTime();
  const anchor = new Date(settings.anchor_at).getTime();
  const completed = Math.max(0, Math.floor((now - anchor) / DAY));
  const periods = Array.from({ length: Math.min(completed, 90) }, (_, index) => {
    const endsAt = new Date(anchor + (completed - index) * DAY).toISOString();
    return { id: endsAt, endsAt };
  });
  const current = !period || period === 'current';
  const requested = current ? now : Date.parse(period!);
  // Closed lists are reproducible snapshots, not another barcode reset schedule.
  if (!current && (!Number.isFinite(requested) || requested <= anchor || requested > now || (requested - anchor) % DAY !== 0)) {
    throw new Error('INVALID_REPORT_PERIOD');
  }
  const asOf = new Date(requested).toISOString();
  const rows = await sql`
    select i.id,i.barcode,i.name,i.inventory_type,l.name as location_name,
      case when w.expires_at>${asOf}::timestamptz then 'SCANNED' else 'NOT_SCANNED' end as status,
      s.id as scan_id,s.scanned_at,w.started_at as window_started_at,w.expires_at as window_expires_at,
      u.full_name as scanner_name,s.condition,coalesce(photos.photo_count,0)::int as photo_count
    from ims_inventory_items i
    left join lateral (
      select id,scanned_at,new_location_id,scanner_user_id,condition,scan_window_id
      from ims_scans where inventory_item_id=i.id and scanned_at<=${asOf}::timestamptz
      order by scanned_at desc,created_at desc,id desc limit 1
    ) s on true
    left join ims_scan_windows w on w.id=s.scan_window_id
    left join lateral (
      select count(*)::int as photo_count from ims_scans
      where scan_window_id=w.id and scanned_at<=s.scanned_at and nullif(evidence_image_url,'') is not null
    ) photos on true
    left join lateral (
      select id,previous_location_id from ims_scans
      where inventory_item_id=i.id and scanned_at>${asOf}::timestamptz
      order by scanned_at,created_at,id limit 1
    ) future on s.id is null
    left join ims_locations l on l.id=case when s.id is not null then s.new_location_id
      when future.id is not null then future.previous_location_id else i.current_location_id end
    left join ims_users u on u.id=s.scanner_user_id
    where i.created_at<=${asOf}::timestamptz
      and (${current}::boolean and not i.archived
        or not ${current}::boolean and (i.archived_at is null or i.archived_at>${asOf}::timestamptz))
    order by i.name,i.barcode
  `;
  return { asOf, current, nextReportAt: new Date(anchor + (completed + 1) * DAY).toISOString(), periods, rows };
}
