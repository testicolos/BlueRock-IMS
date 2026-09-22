import type { TransactionSql } from 'postgres';
import { assertScanEvidence } from './scan-evidence-policy';

export type RecordScanInput = {
  barcode: string;
  locationId?: string;
  condition: 'GOOD' | 'MINOR_ISSUE' | 'DAMAGED' | 'MISSING_PARTS' | 'NEEDS_MAINTENANCE';
  notes?: string;
  reportIssue: boolean;
  issueType?: string;
  evidenceImageUrl?: string;
  issueImageUrl?: string;
  validationAttemptId: string;
  captureMethod: 'CAMERA' | 'MANUAL';
  latitude: number;
  longitude: number;
  locationAccuracy?: number;
  capturedAt: string;
  sessionId?: string;
};

export async function recordScan(
  tx: TransactionSql,
  scannerId: string,
  data: RecordScanInput,
  transactionId: string,
  testClock?: () => Promise<Date>,
) {
  assertScanEvidence(data);
  const barcode = data.barcode.toUpperCase();
  await tx`select pg_advisory_xact_lock(hashtextextended(${transactionId},0))`;
  const existing = (await tx`select id,scanner_user_id,barcode from ims_scans where client_transaction_id=${transactionId} limit 1`)[0];
  if (existing) {
    if (existing.scanner_user_id !== scannerId || existing.barcode !== barcode) throw new Error('TRANSACTION_CONFLICT');
    return { duplicate: true as const, scanId: existing.id };
  }

  const attempt = (await tx`
    select id,inventory_item_id,barcode,matched,capture_method
    from ims_scan_attempts
    where id=${data.validationAttemptId} and scanner_user_id=${scannerId}
      and created_at > now() - interval '15 minutes'
    limit 1 for update
  `)[0];
  if (!attempt || !attempt.matched || attempt.barcode !== barcode || attempt.capture_method !== data.captureMethod) {
    throw new Error('INVALID_VALIDATION');
  }
  const item = (await tx`
    select * from ims_inventory_items
    where id=${attempt.inventory_item_id} and barcode=${barcode} and archived=false
    limit 1 for update
  `)[0];
  if (!item) throw new Error('ITEM_NOT_FOUND');
  if (data.sessionId) {
    const activeSession = (await tx`
      select id from ims_scan_sessions
      where id=${data.sessionId} and status='OPEN' and inventory_type=${item.inventory_type}
      limit 1
    `)[0];
    if (!activeSession) throw new Error('SCAN_SESSION_REQUIRED');
  }

  let destination = null;
  if (data.locationId) {
    destination = (await tx`select id,name from ims_locations where id=${data.locationId} and active=true limit 1`)[0];
    if (!destination) throw new Error('LOCATION_NOT_FOUND');
    if (destination.id === item.current_location_id) destination = null;
  }

  const scannedAt = testClock ? await testClock() : (await tx`
    select greatest(clock_timestamp(), coalesce(
      (select max(scanned_at) + interval '1 microsecond' from ims_scans where inventory_item_id=${item.id}),
      '-infinity'::timestamptz
    ))::text as scanned_at
  `)[0].scanned_at;
  let window = (await tx`
    select id,started_at,expires_at from ims_scan_windows
    where inventory_item_id=${item.id} and started_at<=${scannedAt} and expires_at>${scannedAt}
    order by started_at desc limit 1
  `)[0];
  const replaced = Boolean(window);
  if (!window) window = (await tx`
    insert into ims_scan_windows(inventory_item_id,started_at,expires_at)
    values(${item.id},${scannedAt},${scannedAt}::timestamptz+interval '24 hours')
    returning id,started_at,expires_at
  `)[0];

  const scans = await tx`
    insert into ims_scans(
      inventory_item_id,barcode,previous_location_id,new_location_id,scanner_user_id,
      condition,notes,client_transaction_id,validation_attempt_id,capture_method,session_id,
      latitude,longitude,location_accuracy,captured_at,evidence_image_url,scan_window_id,scanned_at
    ) values(
      ${item.id},${item.barcode},${item.current_location_id},${null},${scannerId},
      ${data.condition},${data.notes ?? null},${transactionId},${attempt.id},${data.captureMethod},${data.sessionId ?? null},
      ${data.latitude},${data.longitude},${data.locationAccuracy ?? null},${data.capturedAt},${data.evidenceImageUrl ?? null},${window.id},${scannedAt}
    ) returning id,barcode,scanned_at,scan_window_id
  `;

  await tx`
    update ims_inventory_items
    set condition=${data.condition},last_scanned_at=${scannedAt},last_scanned_by=${scannerId},updated_at=${scannedAt}
    where id=${item.id}
  `;

  let transfer = null;
  if (destination) {
    const pending = (await tx`
      select id from ims_location_transfers where inventory_item_id=${item.id} and status='PENDING' limit 1
    `)[0];
    if (pending) throw new Error('TRANSFER_ALREADY_PENDING');
    transfer = (await tx`
      insert into ims_location_transfers(
        inventory_item_id,from_location_id,destination_location_id,requested_by,request_scan_id
      ) values(${item.id},${item.current_location_id},${destination.id},${scannerId},${scans[0].id})
      returning id,status,requested_at
    `)[0];
  }

  if (data.reportIssue) {
    await tx`
      insert into ims_issues(inventory_item_id,scan_id,reported_by,issue_type,description,image_url)
      values(${item.id},${scans[0].id},${scannerId},${data.issueType ?? 'GENERAL'},
        ${data.notes ?? 'Issue reported during scan'},${data.issueImageUrl ?? null})
    `;
  }
  return {
    duplicate: false as const,
    replaced,
    windowStartedAt: window.started_at,
    windowExpiresAt: window.expires_at,
    scan: scans[0],
    item: { id: item.id, barcode: item.barcode, name: item.name },
    previousLocationId: item.current_location_id,
    currentLocationId: item.current_location_id,
    transfer: transfer && destination ? { ...transfer, destination: { id: destination.id, name: destination.name } } : null,
  };
}
