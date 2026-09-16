import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';

import { recordScan, type RecordScanInput } from '../src/lib/record-scan';
import { scanWindowMigration } from '../src/lib/scan-windows';
import { scanRecords } from '../src/lib/scan-records';
import { scanChecklist } from '../src/lib/scan-checklist';
import { scanEvidenceRows } from '../src/lib/scan-evidence';

// Explicit test connection only. All objects live in a fresh, private schema;
// search_path excludes public and cleanup removes only this generated schema.
async function main() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('Set TEST_DATABASE_URL to a disposable PostgreSQL test database');
  const schemaName = `ims_scan_test_${randomUUID().replaceAll('-', '')}`;
  const local = ['localhost', '127.0.0.1', '::1'].includes(new URL(url).hostname);
  const options = { ssl: local ? false as const : 'require' as const, prepare: false, onnotice: () => {} };
  const control = postgres(url, { ...options, max: 1 });
  const sql = postgres(url, { ...options, max: 10, connection: { search_path: schemaName } });
  const base = new Date('2025-01-01T23:30:00.000Z');
  const DAY = 86_400_000;
  const at = (offset: number) => new Date(base.getTime() + offset);
  let checks = 0;
  function pass(label: string) { checks++; console.log(`PASS ${label}`); }

  try {
    await control`create schema ${control(schemaName)}`;
    assert.equal((await sql`select current_schema() as name`)[0].name, schemaName);
    const baseSchema = (await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8'))
      .replace(/^create extension[^\n]*\n/m, '');
    await sql.unsafe(baseSchema);
    const [scanner] = await sql`insert into ims_users(username,password_hash,full_name,role) values('scanner','test-only','Test Scanner','SCANNER') returning id`;
    const [scanner2] = await sql`insert into ims_users(username,password_hash,full_name,role) values('scanner2','test-only','Other Scanner','SCANNER') returning id`;
    const [locationA] = await sql`insert into ims_locations(name,code) values('Test A','TA') returning id`;
    const [locationB] = await sql`insert into ims_locations(name,code) values('Test B','TB') returning id`;

    async function item(barcode: string, createdAt = at(-DAY)) {
      const [row] = await sql`insert into ims_inventory_items(barcode,inventory_type,name,created_at)
        values(${barcode},'TOOL',${barcode},${createdAt}) returning *`;
      return row;
    }
    async function input(unit: postgres.Row, extra: Partial<RecordScanInput> = {}): Promise<RecordScanInput> {
      const [attempt] = await sql`insert into ims_scan_attempts(scanner_user_id,inventory_item_id,barcode,matched,capture_method,latitude,longitude,captured_at)
        values(${scanner.id},${unit.id},${unit.barcode},true,'CAMERA',25.1,51.2,clock_timestamp()) returning id`;
      return {
        barcode: unit.barcode, locationId: locationA.id, condition: 'GOOD', reportIssue: false,
        validationAttemptId: attempt.id, captureMethod: 'CAMERA', latitude: 25.1, longitude: 51.2,
        capturedAt: new Date().toISOString(), ...extra,
      };
    }
    async function scan(unit: postgres.Row, time: Date | undefined, extra: Partial<RecordScanInput> = {}) {
      const data = await input(unit, extra);
      const result = await sql.begin(tx => recordScan(tx, scanner.id, data, randomUUID(), time ? async () => time : undefined));
      assert.equal(result.duplicate, false);
      if (result.duplicate) throw new Error('Unexpected duplicate');
      return result;
    }
    async function legacyScan(unit: postgres.Row, time: Date, image: string | null = null) {
      const [row] = await sql`insert into ims_scans(inventory_item_id,barcode,new_location_id,scanner_user_id,condition,client_transaction_id,scanned_at,evidence_image_url)
        values(${unit.id},${unit.barcode},${locationA.id},${scanner.id},'GOOD',${randomUUID()},${time},${image}) returning *`;
      return row;
    }

    const legacy = await item('LEGACY-001');
    const legacy1 = await legacyScan(legacy, at(0), 'data:image/jpeg;base64,old-photo');
    await legacyScan(legacy, at(DAY - 1));
    await legacyScan(legacy, at(DAY));
    await sql`insert into ims_issues(inventory_item_id,scan_id,reported_by,issue_type,description) values(${legacy.id},${legacy1.id},${scanner.id},'TEST','Keep issue reference')`;
    await sql.begin(tx => tx.unsafe(scanWindowMigration));
    const backfilled = await sql`select id,scan_window_id,scanned_at,evidence_image_url from ims_scans where inventory_item_id=${legacy.id} order by scanned_at`;
    assert.equal(backfilled.length, 3);
    assert.equal(backfilled[0].scan_window_id, backfilled[1].scan_window_id);
    assert.notEqual(backfilled[1].scan_window_id, backfilled[2].scan_window_id);
    assert.equal(backfilled[0].evidence_image_url, legacy1.evidence_image_url);
    assert.equal((await sql`select scan_id from ims_issues`)[0].scan_id, legacy1.id);
    await sql.begin(tx => tx.unsafe(scanWindowMigration));
    assert.deepEqual(await sql`select id,scan_window_id,scanned_at,evidence_image_url from ims_scans where inventory_item_id=${legacy.id} order by scanned_at`, backfilled);
    pass('migration backfills exact boundaries, preserves photos/issues and is repeatable');

    const compatible = await item('LEGACY-INFLIGHT-001');
    const compatibleFirst = await legacyScan(compatible, at(0));
    const compatibleRepeat = await legacyScan(compatible, at(DAY - 1));
    const compatibleNext = await legacyScan(compatible, at(DAY));
    assert.ok(compatibleFirst.scan_window_id);
    assert.equal(compatibleFirst.scan_window_id, compatibleRepeat.scan_window_id);
    assert.notEqual(compatibleFirst.scan_window_id, compatibleNext.scan_window_id);
    pass('in-flight legacy inserts are assigned windows by the compatibility trigger after migration');

    const a = await item('LADDER-001');
    const b = await item('LADDER-002');
    const first = await scan(a, at(0), { evidenceImageUrl: 'data:image/jpeg;base64,first', reportIssue: true, notes: 'First issue' });
    const repeat = await scan(a, at(2 * 3_600_000), { locationId: locationB.id, condition: 'DAMAGED' });
    assert.equal(first.replaced, false);
    assert.equal(repeat.replaced, true);
    assert.equal(repeat.scan.scan_window_id, first.scan.scan_window_id);
    assert.equal(new Date(repeat.windowExpiresAt).getTime(), at(DAY).getTime());
    assert.equal(repeat.previousLocationId, locationA.id);
    const [latestItem] = await sql`select current_location_id,condition from ims_inventory_items where id=${a.id}`;
    assert.equal(latestItem.current_location_id, locationB.id);
    assert.equal(latestItem.condition, 'DAMAGED');
    const almost = await scan(a, at(DAY - 1), { evidenceImageUrl: 'data:image/jpeg;base64,later' });
    const boundary = await scan(a, at(DAY));
    assert.equal(almost.scan.scan_window_id, first.scan.scan_window_id);
    assert.notEqual(boundary.scan.scan_window_id, first.scan.scan_window_id);
    assert.equal(boundary.replaced, false);
    pass('same barcode replaces reporting record across midnight without extending 24h; exact boundary starts a new window');

    const bFirst = await scan(b, at(DAY / 2));
    const bRepeat = await scan(b, at(DAY + 3_600_000));
    assert.equal(bFirst.scan.scan_window_id, bRepeat.scan.scan_window_id);
    assert.equal(new Date(bRepeat.windowExpiresAt).getTime(), at(DAY * 1.5).getTime());
    pass('each barcode has its own independent 24-hour window');

    const records = await scanRecords(sql);
    const aRecords = records.filter(row => row.barcode === a.barcode);
    assert.equal(aRecords.length, 2);
    const oldRecord = aRecords.find(row => row.id === almost.scan.id)!;
    assert.equal(oldRecord.scan_count, 3);
    assert.equal(oldRecord.photo_count, 2);
    assert.ok(records.every(row => !Object.hasOwn(row, 'evidence_image_url')));
    assert.equal((await sql`select count(*)::int as count from ims_scans where inventory_item_id=${a.id}`)[0].count, 4);
    assert.equal((await sql`select count(*)::int as count from ims_issues where scan_id=${first.scan.id}`)[0].count, 1);
    pass('history shows only latest record per window while retaining immutable events and issue references');

    const oldPhotos = await scanEvidenceRows(sql, almost.scan.id);
    assert.equal(oldPhotos.filter(row => row.has_evidence).length, 2);
    assert.ok(oldPhotos.every(row => row.evidence_image_url === null));
    const earlyPhotos = await scanEvidenceRows(sql, first.scan.id);
    assert.equal(earlyPhotos.filter(row => row.has_evidence).length, 1);
    assert.equal((await scanEvidenceRows(sql, first.scan.id, almost.scan.id)).length, 0);
    assert.equal((await scanEvidenceRows(sql, almost.scan.id, first.scan.id))[0].evidence_image_url, 'data:image/jpeg;base64,first');
    assert.equal((await scanEvidenceRows(sql, boundary.scan.id, first.scan.id)).length, 0);
    pass('evidence is retained, fetched individually, and limited to selected window and historical timestamp');

    const retryUnit = await item('RETRY-001');
    const retryData = await input(retryUnit);
    const retryId = randomUUID();
    const retries = await Promise.all(Array.from({ length: 6 }, () => sql.begin(tx => recordScan(tx, scanner.id, retryData, retryId))));
    assert.equal(retries.filter(result => !result.duplicate).length, 1);
    assert.equal(retries.filter(result => result.duplicate).length, 5);
    assert.equal((await sql`select count(*)::int as count from ims_scans where inventory_item_id=${retryUnit.id}`)[0].count, 1);
    await assert.rejects(sql.begin(tx => recordScan(tx, scanner2.id, retryData, retryId)), /TRANSACTION_CONFLICT/);
    await assert.rejects(sql.begin(tx => recordScan(tx, scanner.id, { ...retryData, barcode: 'WRONG' }, retryId)), /TRANSACTION_CONFLICT/);
    pass('concurrent retries create one event; reused request IDs cannot cross users or barcodes');

    const concurrentUnit = await item('CONCURRENT-001');
    const concurrentInputs = await Promise.all(Array.from({ length: 8 }, () => input(concurrentUnit)));
    await Promise.all(concurrentInputs.map(data => sql.begin(tx => recordScan(tx, scanner.id, data, randomUUID()))));
    const [counts] = await sql`select count(*)::int as total,count(distinct scan_window_id)::int as windows,count(distinct scanned_at)::int as timestamps from ims_scans where inventory_item_id=${concurrentUnit.id}`;
    assert.deepEqual({ ...counts }, { total: 8, windows: 1, timestamps: 8 });
    const [clockState] = await sql`select i.last_scanned_at=(select max(scanned_at) from ims_scans where inventory_item_id=i.id) as latest from ims_inventory_items i where id=${concurrentUnit.id}`;
    assert.equal(clockState.latest, true);
    pass('concurrent independent requests share one window with strictly ordered DB timestamps and latest inventory state');

    const expired = await item('EXPIRED-001');
    const current = await item('CURRENT-001');
    const never = await item('NEVER-001');
    await scan(expired, new Date(Date.now() - DAY - 60_000));
    await scan(current, new Date(Date.now() - 3_600_000));
    const currentList = await scanChecklist('current', sql);
    assert.equal(currentList.rows.find(row => row.id === expired.id)?.status, 'NOT_SCANNED');
    assert.equal(currentList.rows.find(row => row.id === current.id)?.status, 'SCANNED');
    assert.equal(currentList.rows.find(row => row.id === never.id)?.status, 'NOT_SCANNED');
    assert.ok(currentList.rows.every(row => !Object.hasOwn(row, 'evidence_image_url')));
    pass('current checklist includes unscanned items and expires status after 24 hours without image payloads');

    await scan(a, at(DAY + 3_600_000), { evidenceImageUrl: 'data:image/jpeg;base64,future' });
    const future = await item('FUTURE-SCAN-001');
    await scan(future, at(DAY + 3_600_000), { locationId: locationB.id });
    const late = await item('CREATED-LATER-001', at(DAY + 1));
    const archived = await item('ARCHIVED-001');
    await sql`update ims_inventory_items set archived=true where id=${archived.id}`;
    const historic = await scanChecklist(at(DAY).toISOString(), sql);
    const historicA = historic.rows.find(row => row.id === a.id)!;
    assert.equal(historicA.scan_id, boundary.scan.id);
    assert.equal(historicA.photo_count, 0);
    assert.equal(historic.rows.find(row => row.id === future.id)?.location_name, null);
    assert.equal(historic.rows.find(row => row.id === future.id)?.status, 'NOT_SCANNED');
    assert.ok(historic.rows.some(row => row.id === archived.id));
    assert.ok(!historic.rows.some(row => row.id === late.id));
    const refreshedCurrent = await scanChecklist('current', sql);
    assert.ok(!refreshedCurrent.rows.some(row => row.id === archived.id));
    await assert.rejects(scanChecklist(at(DAY + 1).toISOString(), sql), /INVALID_REPORT_PERIOD/);
    pass('historical checklists ignore future scans/photos, preserve earlier location/archive state and validate period boundaries');

    console.log(`\n${checks} PostgreSQL scan checks passed.`);
  } finally {
    await sql.end({ timeout: 5 });
    // Schema name is generated above and constrained before any destructive SQL.
    assert.match(schemaName, /^ims_scan_test_[0-9a-f]{32}$/);
    await control`drop schema if exists ${control(schemaName)} cascade`;
    await control.end({ timeout: 5 });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
