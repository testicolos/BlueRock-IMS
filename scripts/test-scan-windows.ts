import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';

import { recordScan, type RecordScanInput } from '../src/lib/record-scan';
import { scanWindowMigration } from '../src/lib/scan-windows';
import { scanRecords } from '../src/lib/scan-records';
import { scanChecklist, scanMonthlyReport } from '../src/lib/scan-checklist';
import { scanEvidenceRows } from '../src/lib/scan-evidence';
import { reportClock, reportsAt } from '../src/lib/scan-report-data';
import { reportDate, reportPeriod } from '../src/lib/scan-report-periods';
import { buildDailyScanWorkbook, buildMonthlyScanWorkbook } from '../src/lib/scan-report-xlsx';

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
  const DAY = 86_400_000;
  // Keep historical fixtures recent enough for the 30-day daily-report window,
  // while retaining a scan schedule that crosses midnight.
  const base = new Date();
  base.setUTCDate(base.getUTCDate() - 3);
  base.setUTCHours(23, 30, 0, 0);
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

    const periods = [0, 1].map(index => reportPeriod(base.getTime(), Date.now(), index));
    const batched = await reportsAt(periods, sql);
    assert.equal(batched.length, 2);
    assert.deepEqual(batched.map(report => report.id), periods.map(period => period.id));
    for (let index = 0; index < periods.length; index += 1) {
      assert.deepEqual(batched[index], (await reportsAt([periods[index]], sql))[0]);
    }
    assert.deepEqual(await reportsAt([], sql), []);
    const firstDayA = batched[0].rows.find(row => row.id === a.id)!;
    const secondDayA = batched[1].rows.find(row => row.id === a.id)!;
    assert.equal(firstDayA.period_scan_count, 3);
    assert.equal(firstDayA.period_scanned, true);
    assert.equal(firstDayA.period_photo_count, 2);
    assert.equal(secondDayA.period_scan_count, 2);
    assert.equal(secondDayA.period_photo_count, 1);
    assert.equal(batched[0].rows.find(row => row.id === b.id)?.period_scan_count, 1);
    assert.equal(batched[1].rows.find(row => row.id === b.id)?.period_scan_count, 1);
    const noActivity = batched[0].rows.find(row => row.id === never.id)!;
    assert.equal(noActivity.period_scanned, false);
    assert.equal(noActivity.period_scan_count, 0);
    assert.equal(noActivity.period_photo_count, 0);
    assert.ok(batched.every(report => report.rows.every(row => !Object.hasOwn(row, 'evidence_image_url'))));
    pass('batched reports match individual queries and count exact half-open daily activity without including future photos');

    const monthly = await scanMonthlyReport(reportDate(base).slice(0, 7), sql);
    const monthlyFirst = monthly.reports.find(report => report.startsAt === base.toISOString())!;
    assert.ok(monthlyFirst);
    assert.deepEqual(monthlyFirst, batched[0]);
    assert.equal(monthlyFirst.rows.filter(row => row.id === a.id && row.period_scanned).length, 1);
    assert.equal(monthlyFirst.rows.find(row => row.id === a.id)?.period_scan_count, 3);
    assert.ok(monthly.reports.every(report => report.rows.length === new Set(report.rows.map(row => row.id)).size));
    assert.ok(monthly.reports.every((report, index) => index === 0 || report.startsAt > monthly.reports[index - 1].startsAt));
    assert.equal((await sql`select count(distinct scan_window_id)::int as count from ims_scans where inventory_item_id=${a.id}`)[0].count, 2);
    pass('monthly reports count a repeatedly scanned unit once per day while retaining event totals and fixed barcode windows');

    const sampleFixtures = [
      {code: 'SPC', customer: 'Sample customer', employee: null},
      {code: 'SPE', customer: null, employee: 'Sample employee'},
      {code: 'SPB', customer: 'Both customer', employee: 'Both employee'},
    ];
    const sampleUnits: postgres.Row[] = [];
    for (const fixture of sampleFixtures) {
      const [material] = await sql`insert into ims_materials(inventory_type,name,code,customer_name,employee_name)
        values('SAMPLE',${fixture.code},${fixture.code},${fixture.customer},${fixture.employee}) returning id`;
      const [unit] = await sql`insert into ims_inventory_items(barcode,inventory_type,name,material_id,unit_number,created_at)
        values(${`SP-${fixture.code}-0001`},'SAMPLE',${fixture.code},${material.id},1,${at(-DAY)}) returning *`;
      sampleUnits.push(unit);
    }
    const sampleScan = await scan(sampleUnits[0], at(2 * 3_600_000), {evidenceImageUrl: 'data:image/jpeg;base64,sample-photo'});
    const sampleRepeat = await scan(sampleUnits[0], at(3 * 3_600_000));
    assert.equal(sampleRepeat.replaced, true);
    assert.equal(sampleRepeat.scan.scan_window_id, sampleScan.scan.scan_window_id);
    const sampleDays = await reportsAt(periods, sql, 'SAMPLE');
    const toolDays = await reportsAt(periods, sql, 'TOOL');
    assert.equal(sampleDays[0].inventoryType, 'SAMPLE');
    assert.equal(toolDays[0].inventoryType, 'TOOL');
    assert.ok(sampleDays.every(day => day.rows.length === 3 && day.rows.every(row => row.inventory_type === 'SAMPLE')));
    assert.ok(toolDays.every(day => day.rows.length > 0 && day.rows.every(row => row.inventory_type === 'TOOL')));
    assert.equal(sampleDays[0].rows.find(row => row.id === sampleUnits[0].id)?.period_scan_count, 2);
    assert.equal(sampleDays[0].rows.find(row => row.id === sampleUnits[0].id)?.period_photo_count, 1);
    assert.equal(sampleDays[0].rows.find(row => row.id === sampleUnits[0].id)?.status, 'SCANNED');
    assert.equal(sampleDays[1].rows.find(row => row.id === sampleUnits[0].id)?.period_scan_count, 0);
    assert.equal(sampleDays[1].rows.find(row => row.id === sampleUnits[0].id)?.status, 'NOT_SCANNED');
    for (let index = 0; index < sampleFixtures.length; index++) {
      const row = sampleDays[0].rows.find(row => row.id === sampleUnits[index].id)!;
      assert.equal(row.customer_name, sampleFixtures[index].customer);
      assert.equal(row.employee_name, sampleFixtures[index].employee);
    }
    const sampleChecklist = await scanChecklist('current', sql, 'SAMPLE');
    assert.equal(sampleChecklist.inventoryType, 'SAMPLE');
    assert.equal(sampleChecklist.rows.length, 3);
    const sampleMonthly = await scanMonthlyReport(reportDate(base).slice(0, 7), sql, 'SAMPLE');
    assert.equal(sampleMonthly.inventoryType, 'SAMPLE');
    assert.ok(sampleMonthly.reports.every(day => day.rows.every(row => row.inventory_type === 'SAMPLE')));
    assert.deepEqual(sampleMonthly.reports.find(day => day.id === sampleDays[0].id), sampleDays[0]);
    const toolChecklist = await scanChecklist('current', sql, 'TOOL');
    assert.equal(toolChecklist.inventoryType, 'TOOL');
    assert.ok(toolChecklist.rows.every(row => row.inventory_type === 'TOOL'));
    const toolMonthly = await scanMonthlyReport(reportDate(base).slice(0, 7), sql, 'TOOL');
    assert.equal(toolMonthly.inventoryType, 'TOOL');
    assert.ok(toolMonthly.reports.every(day => day.rows.every(row => row.inventory_type === 'TOOL')));
    assert.deepEqual(toolMonthly.reports.find(day => day.id === toolDays[0].id), toolDays[0]);
    const allChecklist = await scanChecklist('current', sql);
    assert.equal(allChecklist.rows.length, toolChecklist.rows.length + sampleChecklist.rows.length);
    pass('sample/material daily and monthly reports isolate domains, retain customer/employee assignments, and share rolling scan/photo logic');

    const archiveAnchor = at(-40 * DAY);
    await sql`update ims_scan_report_settings set anchor_at=${archiveAnchor} where id=true`;
    const archivedHistoryUnit = await item('MONTHLY-ARCHIVE-001', archiveAnchor);
    await scan(archivedHistoryUnit, new Date(archiveAnchor.getTime() + 3_600_000), { evidenceImageUrl: 'data:image/jpeg;base64,archived-evidence' });
    const archiveLatest = await scan(archivedHistoryUnit, new Date(archiveAnchor.getTime() + 2 * 3_600_000));
    const archiveEnd = new Date(archiveAnchor.getTime() + DAY).toISOString();
    await assert.rejects(scanChecklist(archiveEnd, sql), /REPORT_EXPIRED/);
    const retainedDaily = await scanChecklist('current', sql);
    assert.equal(retainedDaily.periods.length, 30);
    assert.ok(retainedDaily.periods.every(period => period.endsAt !== archiveEnd));
    const oldMonthly = await scanMonthlyReport(reportDate(archiveAnchor).slice(0, 7), sql);
    const archivedReport = oldMonthly.reports.find(report => report.endsAt === archiveEnd)!;
    assert.ok(archivedReport);
    assert.equal(archivedReport.rows.length, 1, 'old reports must not fabricate items created later');
    const archivedRow = archivedReport.rows[0];
    assert.equal(archivedRow.id, archivedHistoryUnit.id);
    assert.equal(archivedRow.period_scanned, true);
    assert.equal(archivedRow.period_scan_count, 2);
    assert.equal(archivedRow.period_photo_count, 1);
    assert.equal(archivedRow.photo_count, 1);
    assert.equal(archivedRow.scan_id, archiveLatest.scan.id);
    assert.equal((await sql`select count(*)::int as count from ims_scans where inventory_item_id=${archivedHistoryUnit.id}`)[0].count, 2);
    assert.equal((await scanEvidenceRows(sql, archiveLatest.scan.id)).filter(row => row.has_evidence).length, 1);
    pass('daily reports expire after 30 closed days while monthly history, immutable scans, and photo evidence remain available');

    const isoBaseline = await reportsAt(periods, sql);
    const nonIso = postgres(url, { ...options, max: 1, idle_timeout: 1,
      connection: {search_path: schemaName, DateStyle: 'SQL, DMY'} });
    try {
      const [dateStyle] = await nonIso`show datestyle`;
      assert.equal(dateStyle.DateStyle, 'SQL, DMY');
      const [unparseable] = await nonIso`select timestamptz '2026-09-17T00:00:00+00' as sample`;
      assert.equal(Number.isFinite(new Date(unparseable.sample).getTime()), false,
        'fixture must exercise a timestamp format rejected by the default Date parser');
      const backendIds: number[] = [];
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (attempt === 2) await new Promise(resolve => setTimeout(resolve, 1_500));
        const [backend] = await nonIso`select pg_backend_pid() as id`;
        backendIds.push(backend.id);
        const before = Date.now();
        const clock = await reportClock(nonIso);
        const after = Date.now();
        assert.equal(clock.anchor, archiveAnchor.getTime());
        assert.ok(Number.isInteger(clock.now));
        assert.ok(clock.now >= before - 1_000 && clock.now <= after + 1_000);
        const warm = await scanChecklist('current', nonIso);
        assert.equal(warm.current, true);
        assert.ok(Number.isFinite(new Date(warm.asOf).getTime()));
        assert.ok(Number.isFinite(new Date(warm.generatedAt).getTime()));
        assert.equal(warm.periods.length, 30);
        assert.equal(warm.rows.find(row => row.id === expired.id)?.status, 'NOT_SCANNED');
        assert.equal(warm.rows.find(row => row.id === current.id)?.status, 'SCANNED');
        assert.equal(warm.rows.find(row => row.id === never.id)?.status, 'NOT_SCANNED');
        for (const row of warm.rows.filter(row => row.scan_id)) {
          for (const value of [row.scanned_at, row.window_started_at, row.window_expires_at]) {
            assert.equal(typeof value, 'string');
            assert.match(value as string, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
            assert.ok(Number.isFinite(new Date(value as string).getTime()));
          }
        }
        const noScan = warm.rows.find(row => row.id === never.id)!;
        assert.equal(noScan.scanned_at, null);
        assert.equal(noScan.window_started_at, null);
        assert.equal(noScan.window_expires_at, null);
        assert.deepEqual(await reportsAt(periods, nonIso), isoBaseline,
          'historical rows, statuses, timestamps, and counts must not depend on connection DateStyle');
        if (attempt === 2) {
          const dailyBytes = await buildDailyScanWorkbook(warm).xlsx.writeBuffer();
          const nonIsoMonthly = await scanMonthlyReport(reportDate(base).slice(0, 7), nonIso);
          const monthlyBytes = await buildMonthlyScanWorkbook(nonIsoMonthly).xlsx.writeBuffer();
          assert.ok(dailyBytes.byteLength > 5_000);
          assert.ok(monthlyBytes.byteLength > 5_000);
        }
      }
      assert.equal(backendIds[0], backendIds[1], 'second request must reuse the warm database connection');
      assert.notEqual(backendIds[1], backendIds[2], 'third request must reconnect after the idle timeout');
    } finally {
      await nonIso.end({timeout: 5});
    }
    pass('report clock and ISO timestamps survive non-ISO formats, warm queries, and idle reconnection without changing statuses');

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
