import ExcelJS from 'exceljs';

type Timestamp = string | Date;
export type ScanReportRow = {
  id: string;
  barcode: string;
  name: string;
  inventory_type: string;
  location_name?: string | null;
  status: 'SCANNED' | 'NOT_SCANNED';
  scan_id?: string | null;
  scanned_at?: Timestamp | null;
  window_started_at?: Timestamp | null;
  window_expires_at?: Timestamp | null;
  scanner_name?: string | null;
  condition?: string | null;
  photo_count: number;
  latitude?: number | null;
  longitude?: number | null;
  location_accuracy?: number | null;
  period_scan_count: number;
  period_scanned: boolean;
  period_photo_count: number;
};
export type DailyScanReport = {
  asOf: Timestamp;
  current: boolean;
  startsAt: Timestamp;
  endsAt: Timestamp;
  reportDate: string;
  generatedAt?: Timestamp;
  rows: ScanReportRow[];
};
export type MonthlyScanReport = {
  month: string;
  generatedAt: Timestamp;
  timezone: string;
  reports: DailyScanReport[];
};

const COLORS = { charcoal: 'FF272726', orange: 'FFE86C1C', cream: 'FFF5EBDD', pale: 'FFFCF8F2', ink: 'FF242421', green: 'FF21623B', red: 'FF9A392B', white: 'FFFFFFFF' };
const HEADER_ROW = 10;
const LOCAL_OFFSET_MS = 3 * 60 * 60 * 1000;
const DATE_TIME_FORMAT = 'yyyy-mm-dd hh:mm:ss';
const DATE_FORMAT = 'yyyy-mm-dd';

// Excel stores timezone-free dates. Shift the UTC instant to the explicitly
// labelled Qatar/Saudi wall time, independent of the server's local timezone.
function localDate(value: Timestamp | null | undefined): Date | null {
  if (value == null) return null;
  const instant = new Date(value).getTime();
  if (!Number.isFinite(instant)) throw new Error('INVALID_REPORT_TIMESTAMP');
  return new Date(instant + LOCAL_OFFSET_MS);
}

function reportDate(value: string): Date {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error('INVALID_REPORT_DATE');
  }
  return parsed;
}

function text(value: string | null | undefined): string {
  // Always pass primitive strings to ExcelJS, never formula/hyperlink objects.
  // Leading =, +, -, @ and leading barcode zeroes remain literal XLSX text.
  return value ?? '';
}

function summary(rows: ScanReportRow[]) {
  return {
    units: rows.length,
    covered: rows.filter(row => row.status === 'SCANNED').length,
    scanned: rows.filter(row => row.period_scanned).length,
    submissions: rows.reduce((total, row) => total + row.period_scan_count, 0),
    photos: rows.reduce((total, row) => total + row.period_photo_count, 0),
  };
}

function createWorkbook(generatedAt: Timestamp) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'BlueRock IMS';
  workbook.lastModifiedBy = 'BlueRock IMS';
  workbook.created = new Date(generatedAt);
  workbook.modified = new Date(generatedAt);
  workbook.subject = 'Scan checklist report — Qatar/Saudi time (UTC+3)';
  workbook.description = 'Backend-generated scan coverage and submission results. Barcode rolling windows remain fixed at 24 hours.';
  return workbook;
}

type Column = { label: string; width: number; format?: string };

function addSheet(workbook: ExcelJS.Workbook, name: string, title: string, subtitle: string, columns: Column[], generatedAt: Timestamp) {
  const sheet = workbook.addWorksheet(name, {
    properties: { tabColor: { argb: COLORS.orange }, defaultRowHeight: 22 },
    views: [{ state: 'frozen', xSplit: 2, ySplit: HEADER_ROW, showGridLines: false }],
    pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: `1:${HEADER_ROW}` },
    headerFooter: { oddFooter: 'BlueRock IMS | UTC+3&CPage &P of &N' },
  });
  sheet.columns = columns.map(column => ({ width: column.width, style: { font: { name: 'Aptos', size: 11, color: { argb: COLORS.ink } }, alignment: { vertical: 'middle', wrapText: true }, numFmt: column.format ?? '@' } }));
  for (const [row, value] of [[1, title], [2, subtitle]] as const) {
    sheet.mergeCells(row, 1, row, columns.length);
    sheet.getCell(row, 1).value = value;
    sheet.getRow(row).height = row === 1 ? 34 : 28;
    sheet.getCell(row, 1).font = { name: 'Aptos', size: row === 1 ? 20 : 11, bold: row === 1, color: { argb: row === 1 ? COLORS.white : COLORS.ink } };
    sheet.getCell(row, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: row === 1 ? COLORS.charcoal : COLORS.cream } };
  }
  sheet.getCell('A3').value = 'Generated (UTC+3)';
  sheet.getCell('B3').value = localDate(generatedAt);
  sheet.getCell('B3').numFmt = DATE_TIME_FORMAT;
  return sheet;
}

function note(sheet: ExcelJS.Worksheet, row: number, value: string, endColumn: number) {
  sheet.mergeCells(row, 1, row, endColumn);
  sheet.getCell(row, 1).value = value;
  sheet.getCell(row, 1).font = { name: 'Aptos', size: 11, color: { argb: COLORS.ink } };
  sheet.getRow(row).height = 28;
}

function metric(sheet: ExcelJS.Worksheet, column: number, label: string, value: number) {
  const labelCell = sheet.getCell(7, column);
  labelCell.value = label;
  labelCell.font = { name: 'Aptos', bold: true, size: 11, color: { argb: COLORS.ink } };
  const valueCell = sheet.getCell(7, column + 1);
  valueCell.value = value;
  valueCell.numFmt = '#,##0';
  valueCell.font = { name: 'Aptos', bold: true, size: 18, color: { argb: COLORS.orange } };
  sheet.getRow(7).height = 38;
}

function addTable(sheet: ExcelJS.Worksheet, name: string, columns: Column[], rows: ExcelJS.CellValue[][]) {
  if (rows.length) {
    sheet.addTable({ name, ref: `A${HEADER_ROW}`, headerRow: true, totalsRow: false,
      // Neutral table chrome plus explicit charcoal/orange cell formatting.
      style: { theme: 'TableStyleLight1', showRowStripes: false },
      columns: columns.map(column => ({ name: column.label, filterButton: true })), rows });
  } else {
    // No synthetic data row: a genuinely empty report still has usable headers.
    sheet.getRow(HEADER_ROW).values = columns.map(column => column.label);
    sheet.autoFilter = { from: { row: HEADER_ROW, column: 1 }, to: { row: HEADER_ROW, column: columns.length } };
    note(sheet, HEADER_ROW + 1, 'No eligible inventory units in this reporting period.', columns.length);
  }
  sheet.getRow(HEADER_ROW).height = 44;
  for (let column = 1; column <= columns.length; column++) {
    const cell = sheet.getCell(HEADER_ROW, column);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.charcoal } };
    cell.font = { name: 'Aptos', size: 11, bold: true, color: { argb: COLORS.white } };
    cell.alignment = { vertical: 'middle', wrapText: true };
    cell.border = { bottom: { style: 'medium', color: { argb: COLORS.orange } } };
  }
  rows.forEach((_row, index) => {
    const row = sheet.getRow(HEADER_ROW + 1 + index);
    row.height = 32;
    columns.forEach((column, columnIndex) => {
      const cell = row.getCell(columnIndex + 1);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: index % 2 ? COLORS.pale : COLORS.cream } };
      cell.numFmt = column.format ?? '@';
      cell.font = { name: 'Aptos', size: 11, color: { argb: cell.value === 'NOT SCANNED' ? COLORS.red : cell.value === 'SCANNED' ? COLORS.green : COLORS.ink } };
      cell.alignment = { vertical: 'middle', wrapText: true };
    });
  });
}

const UNIT_COLUMNS: Column[] = [
  { label: 'Barcode', width: 25 },
  { label: 'Material / unit', width: 36 },
  { label: 'Inventory type', width: 19 },
  { label: 'Location at cutoff', width: 27 },
  { label: 'Rolling status at cutoff', width: 25 },
  { label: 'Scanned during period', width: 23 },
  { label: 'Submissions during period', width: 24, format: '#,##0' },
  { label: 'Photos during period', width: 23, format: '#,##0' },
  { label: 'Latest scan (UTC+3)', width: 25, format: DATE_TIME_FORMAT },
  { label: 'Window start (UTC+3)', width: 25, format: DATE_TIME_FORMAT },
  { label: 'Window expiry (UTC+3)', width: 25, format: DATE_TIME_FORMAT },
  { label: 'Latest scanner', width: 27 },
  { label: 'Condition at latest scan', width: 25 },
  { label: 'Latest latitude', width: 19, format: '0.000000' },
  { label: 'Latest longitude', width: 19, format: '0.000000' },
  { label: 'GPS accuracy (m)', width: 20, format: '0.0' },
  { label: 'Photos in latest window', width: 25, format: '#,##0' },
];

function unitValues(row: ScanReportRow): ExcelJS.CellValue[] {
  return [text(row.barcode), text(row.name), text(row.inventory_type), text(row.location_name), row.status === 'SCANNED' ? 'SCANNED' : 'NOT SCANNED',
    row.period_scanned ? 'YES' : 'NO', row.period_scan_count, row.period_photo_count, localDate(row.scanned_at), localDate(row.window_started_at),
    localDate(row.window_expires_at), text(row.scanner_name), text(row.condition).replaceAll('_', ' '), row.latitude ?? null, row.longitude ?? null,
    row.location_accuracy ?? null, row.photo_count];
}

export function buildDailyScanWorkbook(report: DailyScanReport): ExcelJS.Workbook {
  reportDate(report.reportDate);
  const workbook = createWorkbook(report.generatedAt ?? new Date());
  const sheet = addSheet(workbook, 'Daily checklist', 'BlueRock IMS | Daily scan checklist',
    `${report.reportDate} period start date | Qatar/Saudi time (UTC+3) | ${report.current ? 'PROVISIONAL — period in progress' : 'CLOSED DAILY REPORT'}`,
    UNIT_COLUMNS, report.generatedAt ?? workbook.created);
  sheet.getCell('D3').value = 'Period start (UTC+3)';
  sheet.getCell('E3').value = localDate(report.startsAt);
  sheet.getCell('E3').numFmt = DATE_TIME_FORMAT;
  sheet.getCell('G3').value = 'Cutoff (UTC+3)';
  sheet.getCell('H3').value = localDate(report.asOf);
  sheet.getCell('H3').numFmt = DATE_TIME_FORMAT;
  note(sheet, 4, 'Reports retain the existing 24-hour cadence (not midnight resets), labelled by UTC+3 start date. Rolling status uses each barcode’s separate fixed 24-hour window.', UNIT_COLUMNS.length);
  note(sheet, 5, 'Source: BlueRock IMS backend. Every barcode is one unit. Rescans count as submissions, not extra units. Photo totals are counts; view images securely in the app.', UNIT_COLUMNS.length);
  const totals = summary(report.rows);
  metric(sheet, 1, 'Eligible units', totals.units);
  metric(sheet, 4, 'Scanned at cutoff', totals.covered);
  metric(sheet, 7, 'Not scanned at cutoff', totals.units - totals.covered);
  metric(sheet, 10, 'Scanned in period', totals.scanned);
  metric(sheet, 13, 'Submissions', totals.submissions);
  metric(sheet, 16, 'Photos in period', totals.photos);
  addTable(sheet, 'DailyScanUnits', UNIT_COLUMNS, report.rows.map(unitValues));
  return workbook;
}

export function buildMonthlyScanWorkbook(report: MonthlyScanReport): ExcelJS.Workbook {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(report.month)) throw new Error('INVALID_REPORT_MONTH');
  const seenDates = new Set<string>();
  const reports = [...report.reports].sort((a, b) => a.reportDate.localeCompare(b.reportDate));
  for (const day of reports) {
    reportDate(day.reportDate);
    if (!day.reportDate.startsWith(`${report.month}-`) || seenDates.has(day.reportDate)) throw new Error('INVALID_REPORT_MONTH_SCOPE');
    seenDates.add(day.reportDate);
  }
  const workbook = createWorkbook(report.generatedAt);
  const provisional = reports.some(day => day.current);
  const subtitle = `${report.month} | Grouped by period start date in Qatar/Saudi time (UTC+3) | ${provisional ? 'PROVISIONAL — includes current partial period' : 'COMPLETED REPORT PERIODS'}`;
  const dailyColumns: Column[] = [
    { label: 'Period start date (UTC+3)', width: 27, format: DATE_FORMAT },
    { label: 'Report status', width: 30 },
    { label: 'Cutoff (UTC+3)', width: 25, format: DATE_TIME_FORMAT },
    { label: 'Eligible units', width: 20, format: '#,##0' },
    { label: 'Scanned at cutoff', width: 23, format: '#,##0' },
    { label: 'Not scanned at cutoff', width: 25, format: '#,##0' },
    { label: 'Rolling coverage', width: 22, format: '0.0%' },
    { label: 'Units scanned during period', width: 28, format: '#,##0' },
    { label: 'Submissions during period', width: 27, format: '#,##0' },
    { label: 'Photos during period', width: 25, format: '#,##0' },
    { label: 'Period start (UTC+3)', width: 25, format: DATE_TIME_FORMAT },
  ];
  const daily = addSheet(workbook, 'Monthly summary', 'BlueRock IMS | Monthly scan results', subtitle, dailyColumns, report.generatedAt);
  note(daily, 4, 'Rolling coverage is the share of eligible units whose fixed 24-hour window is active at cutoff. Activity counts distinct units submitted during each report period.', dailyColumns.length);
  note(daily, 5, 'Source: BlueRock IMS backend. Reports retain the existing 24-hour cadence, not midnight resets. A period is assigned to the month of its start date (UTC+3).', dailyColumns.length);
  const unitMap = new Map<string, { row: ScanReportRow; days: number; coveredDays: number; scannedDays: number; submissions: number; photos: number }>();
  for (const day of reports) for (const row of day.rows) {
    const unit = unitMap.get(row.id) ?? { row, days: 0, coveredDays: 0, scannedDays: 0, submissions: 0, photos: 0 };
    unit.row = row;
    unit.days++;
    unit.coveredDays += Number(row.status === 'SCANNED');
    unit.scannedDays += Number(row.period_scanned);
    unit.submissions += row.period_scan_count;
    unit.photos += row.period_photo_count;
    unitMap.set(row.id, unit);
  }
  const units = [...unitMap.values()].sort((a, b) => a.row.name.localeCompare(b.row.name) || a.row.barcode.localeCompare(b.row.barcode));
  metric(daily, 1, 'Report days', reports.length);
  metric(daily, 4, 'Distinct units', units.length);
  metric(daily, 7, 'Units scanned in month', units.filter(unit => unit.scannedDays > 0).length);
  metric(daily, 9, 'Total submissions', units.reduce((total, unit) => total + unit.submissions, 0));
  addTable(daily, 'MonthlyDailySummary', dailyColumns, reports.map(day => {
    const totals = summary(day.rows);
    return [reportDate(day.reportDate), day.current ? 'PROVISIONAL' : 'CLOSED', localDate(day.asOf), totals.units, totals.covered,
      totals.units - totals.covered, totals.units ? totals.covered / totals.units : null, totals.scanned, totals.submissions, totals.photos, localDate(day.startsAt)];
  }));

  const monthlyColumns: Column[] = [
    { label: 'Barcode', width: 25 }, { label: 'Material / unit', width: 36 }, { label: 'Inventory type', width: 19 },
    { label: 'Location at latest cutoff', width: 28 }, { label: 'Eligible report days', width: 23, format: '#,##0' },
    { label: 'Days scanned at cutoff', width: 24, format: '#,##0' }, { label: 'Days not scanned at cutoff', width: 26, format: '#,##0' },
    { label: 'Days with submissions', width: 24, format: '#,##0' }, { label: 'Total submissions', width: 23, format: '#,##0' },
    { label: 'Total photos in period', width: 25, format: '#,##0' }, { label: 'Latest scan (UTC+3)', width: 25, format: DATE_TIME_FORMAT },
    { label: 'Latest scanner', width: 27 },
  ];
  const monthly = addSheet(workbook, 'Unit monthly totals', 'BlueRock IMS | Unit monthly totals', subtitle, monthlyColumns, report.generatedAt);
  note(monthly, 4, 'One row per inventory unit. Eligible report days can differ when units are added or archived. Provisional period counts may change.', monthlyColumns.length);
  note(monthly, 5, 'Days with submissions measures actual scan activity; days scanned at cutoff measures fixed 24-hour rolling coverage. Latest scan may predate the month.', monthlyColumns.length);
  metric(monthly, 1, 'Distinct units', units.length);
  metric(monthly, 4, 'Units scanned in month', units.filter(unit => unit.scannedDays > 0).length);
  metric(monthly, 7, 'Total submissions', units.reduce((total, unit) => total + unit.submissions, 0));
  metric(monthly, 10, 'Total period photos', units.reduce((total, unit) => total + unit.photos, 0));
  addTable(monthly, 'MonthlyUnitTotals', monthlyColumns, units.map(unit => [text(unit.row.barcode), text(unit.row.name), text(unit.row.inventory_type),
    text(unit.row.location_name), unit.days, unit.coveredDays, unit.days - unit.coveredDays, unit.scannedDays, unit.submissions, unit.photos,
    localDate(unit.row.scanned_at), text(unit.row.scanner_name)]));

  const detailColumns: Column[] = [{ label: 'Period start date (UTC+3)', width: 27, format: DATE_FORMAT }, { label: 'Report status', width: 22 }, ...UNIT_COLUMNS];
  const detail = addSheet(workbook, 'Unit daily detail', 'BlueRock IMS | Unit-by-day detail', subtitle, detailColumns, report.generatedAt);
  note(detail, 4, 'One row per eligible unit per report date. Use the table filters to review a barcode, location, report day, or rolling scan status.', detailColumns.length);
  note(detail, 5, 'Source: BlueRock IMS backend. Times are Qatar/Saudi (UTC+3); current-period data is provisional. Embedded photos are omitted for privacy and file size.', detailColumns.length);
  addTable(detail, 'MonthlyUnitDailyDetail', detailColumns, reports.flatMap(day => day.rows.map(row => [reportDate(day.reportDate), day.current ? 'PROVISIONAL' : 'CLOSED', ...unitValues(row)])));
  return workbook;
}
