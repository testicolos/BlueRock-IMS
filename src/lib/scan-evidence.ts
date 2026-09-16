import type { Sql } from 'postgres';

export function scanEvidenceRows(sql: Sql, scanId: string, photoId: string | null = null) {
  return sql`
    with selected as (
      select id, scan_window_id, scanned_at from ims_scans where id = ${scanId}
    )
    select s.id, s.barcode, i.name,
      case when ${photoId}::uuid is not null then s.evidence_image_url end as evidence_image_url,
      nullif(s.evidence_image_url,'') is not null as has_evidence,s.captured_at,s.scanned_at,
      u.full_name as scanner_name, s.latitude, s.longitude, s.location_accuracy,
      s.capture_method, nl.name as location_name, pl.name as previous_location_name
    from ims_scans s
    join ims_inventory_items i on i.id = s.inventory_item_id
    left join ims_users u on u.id = s.scanner_user_id
    left join ims_locations nl on nl.id = s.new_location_id
    left join ims_locations pl on pl.id = s.previous_location_id
    join selected on (
      (selected.scan_window_id is not null and s.scan_window_id = selected.scan_window_id
        and s.scanned_at <= selected.scanned_at)
      or (selected.scan_window_id is null and s.id = selected.id)
    )
    where (${photoId}::uuid is null or s.id=${photoId}::uuid)
    order by s.scanned_at desc, s.id desc
  `;
}
