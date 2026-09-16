import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { NextRequest } from 'next/server';
import { createToken } from '../src/lib/auth';
import { GET as exportReport } from '../src/app/api/scans/checklist/export/route';
import { GET as checklistReport } from '../src/app/api/scans/checklist/route';
import { reportInventoryType } from '../src/lib/scan-report-scope';
import { buildDailyScanWorkbook, buildMonthlyScanWorkbook, type DailyScanReport, type ScanReportRow } from '../src/lib/scan-report-xlsx';

const START = Date.parse('2024-02-01T04:00:00.000Z');
const DAY = 86_400_000;
const scanned: ScanReportRow = {
  id: 'unit-1', barcode: '00000123456789012345', name: '=HYPERLINK("https://example.invalid", "Do not run")', inventory_type: 'TOOL',
  location_name: '+SUM(1,1)', status: 'SCANNED', scan_id: 'scan-2', scanned_at: '2024-02-01T20:59:30.000Z',
  window_started_at: '2024-02-01T04:30:00.000Z', window_expires_at: '2024-02-02T04:30:00.000Z', scanner_name: '@SUM(1,1)',
  condition: 'NEEDS_MAINTENANCE', photo_count: 1, latitude: 25.2854, longitude: 51.531, location_accuracy: 7.2,
  period_scan_count: 2, period_scanned: true, period_photo_count: 1,
};
const unscanned: ScanReportRow = { id: 'unit-2', barcode: '=1+1', name: 'Never scanned sample', inventory_type: 'SAMPLE',
  location_name: 'Sample store', status: 'NOT_SCANNED', photo_count: 0, period_scan_count: 0, period_scanned: false, period_photo_count: 0 };

function dayReport(index: number, rows: ScanReportRow[] = [scanned, unscanned]): DailyScanReport {
  return {
    startsAt: new Date(START + index * DAY).toISOString(), endsAt: new Date(START + (index + 1) * DAY).toISOString(),
    asOf: new Date(START + (index + 1) * DAY).toISOString(), current: false,
    reportDate: `2024-02-${String(index + 1).padStart(2, '0')}`, generatedAt: '2024-03-01T07:00:00.000Z', rows,
  };
}

async function reopen(workbook: ExcelJS.Workbook) {
  const bytes = await workbook.xlsx.writeBuffer();
  assert.ok(bytes.byteLength > 5_000, 'Generated XLSX should contain real workbook content');
  const reopened = new ExcelJS.Workbook();
  await reopened.xlsx.load(bytes);
  return reopened;
}

function assertLiteralText(cell: ExcelJS.Cell, expected: string) {
  assert.equal(cell.type, ExcelJS.ValueType.String);
  assert.equal(cell.value, expected);
  assert.equal(cell.formula, undefined);
}

async function main() {
  const daily = await reopen(buildDailyScanWorkbook(dayReport(0)));
  assert.equal(daily.worksheets.length, 1);
  const sheet = daily.worksheets[0];
  assertLiteralText(sheet.getCell('A11'), scanned.barcode);
  assertLiteralText(sheet.getCell('A12'), unscanned.barcode);
  assertLiteralText(sheet.getCell('B11'), scanned.name);
  assertLiteralText(sheet.getCell('D11'), scanned.location_name!);
  assertLiteralText(sheet.getCell('L11'), scanned.scanner_name!);
  assert.equal(sheet.getCell('A11').numFmt, '@');
  assert.equal(sheet.getCell('G11').type, ExcelJS.ValueType.Number);
  assert.equal(sheet.getCell('G11').value, 2);
  assert.equal(sheet.getCell('N11').value, 25.2854);
  assert.equal(sheet.getCell('I11').type, ExcelJS.ValueType.Date);
  assert.equal((sheet.getCell('I11').value as Date).toISOString(), '2024-02-01T23:59:30.000Z');
  assert.equal((sheet.getCell('E3').value as Date).toISOString(), '2024-02-01T07:00:00.000Z');
  assert.equal(sheet.getCell('I12').value, null, 'Never scanned is a blank timestamp, not an invented date');
  assert.equal(sheet.getCell('B7').value, 2, 'Inventory quantity counts unique barcode rows');
  assert.equal(sheet.getCell('E7').value, 1);
  assert.equal(sheet.getCell('H7').value, 1);
  assert.equal(sheet.getCell('K7').value, 1, 'Two submissions still mean one scanned unit');
  assert.equal(sheet.getCell('N7').value, 2);
  assert.equal(sheet.getCell('Q7').value, 1);
  assert.equal(sheet.getTable('DailyScanUnits').name, 'DailyScanUnits');
  assert.equal(sheet.views[0].state, 'frozen');
  assert.equal('ySplit' in sheet.views[0] && sheet.views[0].ySplit, 10);
  assert.equal((sheet.getCell('A10').fill as ExcelJS.FillPattern).fgColor?.argb, 'FF272726');
  assert.ok(sheet.getColumn(2).width! >= 30);
  assert.match(String(sheet.getCell('A4').value), /not midnight/);
  daily.eachSheet(worksheet => worksheet.eachRow(row => row.eachCell(cell => assert.notEqual(cell.type, ExcelJS.ValueType.Formula))));

  const allUnscanned = (await reopen(buildDailyScanWorkbook(dayReport(0, [unscanned])))).worksheets[0];
  assert.equal(allUnscanned.getCell('E7').value, 0);
  assert.equal(allUnscanned.getCell('H7').value, 1);
  assert.equal(allUnscanned.getCell('K7').value, 0);
  const empty = (await reopen(buildDailyScanWorkbook(dayReport(0, [])))).worksheets[0];
  assert.equal(empty.getCell('B7').value, 0);
  assert.match(String(empty.getCell('A11').value), /No eligible inventory/);
  assert.equal(empty.getCell('A10').value, 'Barcode');
  assert.ok(empty.autoFilter);
  const provisional = buildDailyScanWorkbook({ ...dayReport(0), current: true, asOf: '2024-02-01T21:00:00Z' }).worksheets[0];
  assert.match(String(provisional.getCell('A2').value), /PROVISIONAL/);
  assert.equal((provisional.getCell('H3').value as Date).toISOString(), '2024-02-02T00:00:00.000Z', 'UTC+3 correctly crosses midnight');

  const reports = Array.from({ length: 29 }, (_, index) => dayReport(index, [
    { ...scanned, status: index <= 1 ? 'SCANNED' : 'NOT_SCANNED', period_scanned: index === 0, period_scan_count: index === 0 ? 2 : 0, period_photo_count: index === 0 ? 1 : 0 },
    unscanned,
  ]));
  const monthly = await reopen(buildMonthlyScanWorkbook({ month: '2024-02', generatedAt: '2024-03-01T08:00:00.000Z', timezone: 'Asia/Qatar', reports }));
  assert.deepEqual(monthly.worksheets.map(worksheet => worksheet.name), ['Monthly summary', 'Unit monthly totals', 'Unit daily detail']);
  const summary = monthly.worksheets[0];
  assert.equal(summary.getCell('B7').value, 29, 'Leap February keeps all 29 report starts');
  assert.equal(summary.getCell('E7').value, 2);
  assert.equal(summary.getCell('H7').value, 1, 'Monthly unique scanned units are not the sum of daily coverage');
  assert.equal(summary.getCell('J7').value, 2);
  assert.equal((summary.getCell('A39').value as Date).toISOString(), '2024-02-29T00:00:00.000Z');
  assert.equal((summary.getCell('C39').value as Date).toISOString(), '2024-03-01T07:00:00.000Z', 'Month membership uses period start, not cutoff');
  assert.equal(summary.getCell('G11').value, 0.5);
  assert.equal(summary.getCell('H12').value, 0, 'A carried rolling window does not create a submission in the new period');
  assert.equal(summary.getCell('E12').value, 1, 'Rolling coverage is distinct from in-period activity');
  const units = monthly.worksheets[1];
  assert.equal(units.getCell('E11').value, 29);
  assert.equal(units.getCell('F11').value, 2);
  assert.equal(units.getCell('G11').value, 27);
  assert.equal(units.getCell('H11').value, 1);
  assert.equal(units.getCell('I11').value, 2);
  assert.equal(units.getCell('J11').value, 1);
  assert.equal(monthly.worksheets[2].rowCount, 68, '29 days × 2 units + 10 header rows');
  assertLiteralText(monthly.worksheets[2].getCell('C11'), scanned.barcode);
  assertLiteralText(monthly.worksheets[2].getCell('D11'), scanned.name);
  assert.throws(() => buildMonthlyScanWorkbook({ month: '2024-01', timezone: 'Asia/Qatar', generatedAt: new Date(), reports }), /INVALID_REPORT_MONTH_SCOPE/);
  assert.throws(() => buildMonthlyScanWorkbook({ month: '2024-02', timezone: 'Asia/Qatar', generatedAt: new Date(), reports: [reports[0], reports[0]] }), /INVALID_REPORT_MONTH_SCOPE/);
  assert.throws(() => buildDailyScanWorkbook({ ...dayReport(0), reportDate: '2023-02-29' }), /INVALID_REPORT_DATE/);
  const emptyMonth = await reopen(buildMonthlyScanWorkbook({ month: '2024-02', timezone: 'Asia/Qatar', generatedAt: new Date(), reports: [dayReport(0, [])] }));
  assert.equal(emptyMonth.worksheets[0].getCell('G11').value, null, 'Zero denominator coverage stays blank');

  const samples: ScanReportRow[] = [
    {...unscanned, id: 'sample-customer', barcode: 'SP-CUST-0001', customer_name: '=Customer', employee_name: null},
    {...unscanned, id: 'sample-employee', barcode: 'SP-EMP-0001', customer_name: null, employee_name: '@Employee'},
    {...unscanned, id: 'sample-both', barcode: 'SP-BOTH-0001', customer_name: 'Customer both', employee_name: 'Employee both',
      status: 'SCANNED', period_scanned: true, period_scan_count: 2, period_photo_count: 1},
  ];
  const mixedRows = [scanned, ...samples];
  const sampleDaily = (await reopen(buildDailyScanWorkbook({...dayReport(0, mixedRows), inventoryType: 'SAMPLE'}))).worksheets[0];
  assert.match(String(sampleDaily.getCell('A1').value), /Samples/);
  assert.equal(sampleDaily.getCell('B7').value, 3, 'Sample totals exclude tools even if given mixed input');
  assert.equal(sampleDaily.getCell('E7').value, 1);
  assert.equal(sampleDaily.getCell('N7').value, 2, 'Tool submissions do not enter sample totals');
  assert.equal(sampleDaily.getCell('D10').value, 'Customer');
  assert.equal(sampleDaily.getCell('E10').value, 'Employee');
  assertLiteralText(sampleDaily.getCell('D11'), '=Customer');
  assertLiteralText(sampleDaily.getCell('E12'), '@Employee');
  assertLiteralText(sampleDaily.getCell('D13'), 'Customer both');
  assertLiteralText(sampleDaily.getCell('E13'), 'Employee both');
  assert.equal(sampleDaily.getCell('E11').value, '');
  assert.equal(sampleDaily.getCell('D12').value, '');
  assert.ok(!sampleDaily.getRow(10).values.toString().includes('Location'));
  assert.match(String(sampleDaily.getCell('A6').value), /current sample assignment/);
  const materialDaily = (await reopen(buildDailyScanWorkbook({...dayReport(0, mixedRows), inventoryType: 'TOOL'}))).worksheets[0];
  assert.match(String(materialDaily.getCell('A1').value), /Materials/);
  assert.equal(materialDaily.getCell('B7').value, 1);
  assert.equal(materialDaily.getCell('D10').value, 'Location at cutoff');
  assertLiteralText(materialDaily.getCell('A11'), scanned.barcode);

  const sampleMonth = await reopen(buildMonthlyScanWorkbook({month: '2024-02', inventoryType: 'SAMPLE',
    generatedAt: new Date(), timezone: 'Asia/Qatar', reports: [dayReport(0, mixedRows), dayReport(1, mixedRows)]}));
  assert.equal(sampleMonth.worksheets[0].getCell('E7').value, 3);
  assert.equal(sampleMonth.worksheets[0].getCell('H7').value, 1);
  assert.equal(sampleMonth.worksheets[0].getCell('J7').value, 4);
  assert.equal(sampleMonth.worksheets[1].getCell('D10').value, 'Customer');
  assert.equal(sampleMonth.worksheets[1].getCell('E10').value, 'Employee');
  assert.equal(sampleMonth.worksheets[1].rowCount, 13);
  assert.equal(sampleMonth.worksheets[2].getCell('F10').value, 'Customer');
  assert.equal(sampleMonth.worksheets[2].getCell('G10').value, 'Employee');
  assert.equal(sampleMonth.worksheets[2].rowCount, 16);
  for (const worksheet of sampleMonth.worksheets) assert.match(String(worksheet.getCell('A1').value), /Samples/);
  assert.equal(reportInventoryType(new URLSearchParams()), 'ALL');
  assert.equal(reportInventoryType(new URLSearchParams('inventoryType=SAMPLE')), 'SAMPLE');
  assert.equal(reportInventoryType(new URLSearchParams('inventoryType=TOOL')), 'TOOL');

  // Anonymous/scanner users and invalid selectors must be rejected before DB access.
  process.env.JWT_SECRET = randomUUID() + randomUUID();
  delete process.env.DATABASE_URL;
  const scannerToken = await createToken({ id: randomUUID(), username: 'report-scanner', fullName: 'Report scanner', role: 'SCANNER' });
  const adminToken = await createToken({ id: randomUUID(), username: 'report-admin', fullName: 'Report administrator', role: 'ADMIN' });
  const url = 'http://localhost/api/scans/checklist/export';
  assert.equal((await exportReport(new NextRequest(url))).status, 401);
  assert.equal((await exportReport(new NextRequest(url, { headers: { Authorization: 'Bearer invalid-token' } }))).status, 401);
  assert.equal((await exportReport(new NextRequest(url, { headers: { Authorization: `Bearer ${scannerToken}` } }))).status, 403);
  for (const inventoryType of ['TOOL', 'SAMPLE']) {
    assert.equal((await checklistReport(new NextRequest(`http://localhost/api/scans/checklist?inventoryType=${inventoryType}`))).status, 401);
    assert.equal((await checklistReport(new NextRequest(`http://localhost/api/scans/checklist?inventoryType=${inventoryType}`, {headers: {Authorization: `Bearer ${scannerToken}`}}))).status, 403);
    assert.equal((await exportReport(new NextRequest(`${url}?inventoryType=${inventoryType}`, {headers: {Authorization: `Bearer ${scannerToken}`}}))).status, 403);
  }
  for (const query of ['?month=2024-13', '?period=2024-02-01', '?period=current&month=2024-02', '?period=current&period=current', '?month=2024-02&month=2024-02', '?month=',
    '?inventoryType=ALL', '?inventoryType=OTHER', '?inventoryType=', '?inventoryType=SAMPLE&inventoryType=TOOL']) {
    const response = await exportReport(new NextRequest(`${url}${query}`, { headers: { Authorization: `Bearer ${adminToken}` } }));
    assert.equal(response.status, 400, query);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    assert.equal((await response.json()).success, false);
  }
  for (const query of ['?inventoryType=ALL', '?inventoryType=OTHER', '?inventoryType=', '?inventoryType=SAMPLE&inventoryType=TOOL']) {
    const response = await checklistReport(new NextRequest(`http://localhost/api/scans/checklist${query}`, {headers: {Authorization: `Bearer ${adminToken}`}}));
    assert.equal(response.status, 400, query);
  }
  console.log('PASS: daily/monthly XLSX round-trip, text/formula safety, UTC+3 typed dates, material/sample isolation and assignments, scoped leap-month totals, empty/unscanned/provisional reports, styling, filters, selector validation, and admin-only access.');
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
