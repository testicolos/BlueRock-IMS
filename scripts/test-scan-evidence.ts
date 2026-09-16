import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { TransactionSql } from 'postgres';

import { recordScan, type RecordScanInput } from '../src/lib/record-scan';
import { assertScanEvidence, isInlineCapturedImage } from '../src/lib/scan-evidence-policy';

// Small complete image fixtures. No network or production database is used.
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+lmUYAAAAASUVORK5CYII=';
const jpeg = 'data:image/jpeg;base64,/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKpAB//Z';
const webp = 'data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA';
const scannerId = randomUUID();
const itemId = randomUUID();
const locationId = randomUUID();
const attemptId = randomUUID();
const timestamp = new Date('2026-09-17T10:00:00Z');

function input(extra: Partial<RecordScanInput> = {}): RecordScanInput {
  return {
    barcode: 'TL-TEST-001', locationId, condition: 'GOOD', reportIssue: false,
    validationAttemptId: attemptId, captureMethod: 'MANUAL', latitude: 25.1,
    longitude: 51.2, capturedAt: timestamp.toISOString(), evidenceImageUrl: png,
    ...extra,
  };
}

function transaction(attempt: Record<string, unknown> | null) {
  const calls: { statement: string; values: unknown[] }[] = [];
  const tx = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const statement = strings.join('?').replace(/\s+/g, ' ').trim();
    calls.push({ statement, values });
    if (statement.includes('pg_advisory_xact_lock')) return [];
    if (statement.includes('from ims_scans where client_transaction_id')) return [];
    if (statement.includes('from ims_scan_attempts')) {
      assert.ok(statement.includes('scanner_user_id=?'));
      assert.ok(statement.includes("created_at > now() - interval '15 minutes'"));
      assert.deepEqual(values, [attemptId, scannerId]);
      return attempt ? [attempt] : [];
    }
    if (statement.includes('from ims_inventory_items')) return [{ id: itemId, barcode: 'TL-TEST-001', name: 'Test unit', current_location_id: locationId }];
    if (statement.includes('from ims_locations')) return [{ id: locationId, name: 'Test location' }];
    if (statement.includes('from ims_scan_windows')) return [{ id: randomUUID(), started_at: timestamp, expires_at: new Date(timestamp.getTime() + 86_400_000) }];
    if (statement.startsWith('insert into ims_scans')) return [{ id: randomUUID(), barcode: 'TL-TEST-001', scanned_at: timestamp }];
    if (statement.startsWith('update ims_inventory_items')) return [];
    throw new Error(`Unexpected statement: ${statement}`);
  }) as unknown as TransactionSql;
  return { tx, calls };
}

async function main() {
  for (const image of [png, jpeg, webp]) {
    assert.equal(isInlineCapturedImage(image), true);
    assert.doesNotThrow(() => assertScanEvidence({ captureMethod: 'MANUAL', evidenceImageUrl: image }));
  }
  console.log('PASS: matching inline PNG, JPEG and WebP photos are accepted');

  const invalid = [
    undefined, '', ' ', 'https://example.com/barcode.jpg', 'blob:photo',
    'data:image/jpeg;base64,placeholder', 'data:image/svg+xml;base64,PHN2Zy8+',
    png.replace('image/png', 'image/jpeg'), png.replace('image/png', 'image/webp'),
    jpeg.replace('image/jpeg', 'image/png'), jpeg.replace(/.{4}$/, ''),
    png + '\n', png.replace(/=$/, ''), png.replace(/.{12}$/, ''),
    'data:image/png;base64,' + 'A'.repeat(3_500_000),
  ];
  for (const evidenceImageUrl of invalid) {
    assert.equal(isInlineCapturedImage(evidenceImageUrl), false);
    assert.throws(() => assertScanEvidence({ captureMethod: 'MANUAL', evidenceImageUrl }), /MANUAL_PHOTO_REQUIRED/);
    const { tx, calls } = transaction(null);
    await assert.rejects(recordScan(tx, scannerId, input({ evidenceImageUrl }), randomUUID()), /MANUAL_PHOTO_REQUIRED/);
    assert.equal(calls.length, 0, 'Invalid manual photos must be rejected before any database operation');
  }
  console.log('PASS: absent, placeholder, remote, malformed, mismatched and oversized manual photos cannot reach scan writes');

  assert.doesNotThrow(() => assertScanEvidence({ captureMethod: 'CAMERA' }));
  const matchingAttempt = { id: attemptId, inventory_item_id: itemId, barcode: 'TL-TEST-001', matched: true, capture_method: 'MANUAL' };
  const spoofed = transaction(matchingAttempt);
  await assert.rejects(recordScan(spoofed.tx, scannerId, input({ captureMethod: 'CAMERA', evidenceImageUrl: undefined }), randomUUID()), /INVALID_VALIDATION/);
  assert.equal(spoofed.calls.filter(call => /^(insert|update)/.test(call.statement)).length, 0);
  console.log('PASS: a manual validation attempt cannot be submitted as CAMERA to bypass its photo requirement');

  for (const attempt of [null, { ...matchingAttempt, matched: false }, { ...matchingAttempt, barcode: 'OTHER-001' }, { ...matchingAttempt, capture_method: 'CAMERA' }]) {
    const rejected = transaction(attempt);
    await assert.rejects(recordScan(rejected.tx, scannerId, input(), randomUUID()), /INVALID_VALIDATION/);
    assert.equal(rejected.calls.filter(call => /^(insert|update)/.test(call.statement)).length, 0);
  }
  console.log('PASS: absent/expired, unmatched, wrong-barcode and wrong-method attempts cannot write scans');

  const validManual = transaction(matchingAttempt);
  const result = await recordScan(validManual.tx, scannerId, input(), randomUUID(), async () => timestamp);
  assert.equal(result.duplicate, false);
  const manualInsert = validManual.calls.find(call => call.statement.startsWith('insert into ims_scans'));
  assert.ok(manualInsert);
  assert.ok(manualInsert.values.includes(png));
  assert.ok(manualInsert.values.includes('MANUAL'));
  assert.ok(manualInsert.values.includes(25.1));
  assert.ok(manualInsert.values.includes(51.2));
  console.log('PASS: a matched manual barcode with its photo and coordinates is saved');

  const validCamera = transaction({ ...matchingAttempt, capture_method: 'CAMERA' });
  await recordScan(validCamera.tx, scannerId, input({ captureMethod: 'CAMERA', evidenceImageUrl: undefined }), randomUUID(), async () => timestamp);
  assert.ok(validCamera.calls.find(call => call.statement.startsWith('insert into ims_scans')));
  console.log('PASS: camera-decoded barcode scans still work without an optional photo');
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
