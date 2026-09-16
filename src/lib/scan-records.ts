import { db } from '@/lib/db';

export async function scanRecords(sql = db()) {
  return sql`
    select s.id,s.barcode,s.condition,s.notes,s.scanned_at,s.capture_method,
      s.latitude,s.longitude,s.location_accuracy,s.captured_at,
      i.name,i.inventory_type,pl.name as previous_location_name,
      nl.name as new_location_name,u.full_name as scanner_name,
      w.started_at as window_started_at,w.expires_at as window_expires_at,
      totals.scan_count,totals.photo_count
    from ims_scan_windows w
    join lateral (
      select * from ims_scans where scan_window_id=w.id
      order by scanned_at desc,created_at desc,id desc limit 1
    ) s on true
    join lateral (
      select count(*)::int as scan_count,
        count(*) filter(where nullif(evidence_image_url,'') is not null)::int as photo_count
      from ims_scans where scan_window_id=w.id
    ) totals on true
    join ims_inventory_items i on i.id=w.inventory_item_id
    left join ims_locations pl on pl.id=s.previous_location_id
    left join ims_locations nl on nl.id=s.new_location_id
    left join ims_users u on u.id=s.scanner_user_id
    order by s.scanned_at desc limit 500
  `;
}
