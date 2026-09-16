import assert from 'node:assert/strict';
import {
  DAY, RETENTION_DAYS, REPORT_TIMEZONE, reportDate, reportPeriod,
  reportHistory, resolveReportPeriod, reportMonths, monthPeriods,
} from '../src/lib/scan-report-periods';

let checks = 0;
const timestamp = (value: string) => new Date(value).getTime();
const iso = (value: number) => new Date(value).toISOString();

function check(name: string, run: () => void) {
  run();
  checks += 1;
  console.log(`PASS ${name}`);
}

function throwsCode(run: () => unknown, code: string) {
  assert.throws(run, (error: unknown) => error instanceof Error && error.message === code);
}

check('report constants use fixed 24 hours, 30 retained days, and Qatar dates', () => {
  assert.equal(DAY, 24 * 60 * 60 * 1000);
  assert.equal(RETENTION_DAYS, 30);
  assert.equal(REPORT_TIMEZONE, 'Asia/Qatar');
});

check('reportDate accepts ISO strings, Dates, and numeric timestamps', () => {
  const value = '2026-09-17T21:05:00.000Z';
  for (const input of [value, new Date(value), timestamp(value)]) {
    assert.equal(reportDate(input), '2026-09-18');
  }
});

check('reportDate changes at UTC+3 midnight, including month and year boundaries', () => {
  assert.equal(reportDate('2026-01-31T20:59:59.999Z'), '2026-01-31');
  assert.equal(reportDate('2026-01-31T21:00:00.000Z'), '2026-02-01');
  assert.equal(reportDate('2026-12-31T20:59:59.999Z'), '2026-12-31');
  assert.equal(reportDate('2026-12-31T21:00:00.000Z'), '2027-01-01');
});

check('report periods retain the first-scan anchor instead of resetting at midnight', () => {
  const anchor = timestamp('2026-01-01T13:37:45.123Z');
  const now = anchor + 2 * DAY + 5_000;
  const closed = reportPeriod(anchor, now, 0);
  assert.equal(closed.startsAt, iso(anchor));
  assert.equal(closed.endsAt, iso(anchor + DAY));
  assert.equal(closed.asOf, closed.endsAt);
  assert.equal(closed.current, false);
  assert.equal(closed.reportDate, '2026-01-01');
  const current = reportPeriod(anchor, now, 2);
  assert.equal(current.startsAt, iso(anchor + 2 * DAY));
  assert.equal(current.endsAt, iso(anchor + 3 * DAY));
  assert.equal(current.asOf, iso(now));
  assert.equal(current.current, true);
  assert.equal(current.reportDate, '2026-01-03');
});

check('a newly created dataset has only a provisional current report', () => {
  const anchor = timestamp('2026-09-17T09:00:00.000Z');
  assert.deepEqual(reportHistory(anchor, anchor), []);
  const current = resolveReportPeriod(anchor, anchor, null);
  assert.equal(current.current, true);
  assert.equal(current.startsAt, iso(anchor));
  assert.equal(current.asOf, iso(anchor));
  assert.deepEqual(reportMonths(anchor, anchor), ['2026-09']);
  assert.equal(monthPeriods(anchor, anchor, '2026-09').length, 1);
});

check('the first closed report appears exactly 24 hours after the anchor', () => {
  const anchor = timestamp('2026-01-01T13:00:00.000Z');
  assert.equal(reportHistory(anchor, anchor + DAY - 1).length, 0);
  const history = reportHistory(anchor, anchor + DAY);
  assert.equal(history.length, 1);
  assert.equal(history[0].endsAt, iso(anchor + DAY));
  assert.equal(history[0].current, false);
  const current = resolveReportPeriod(anchor, anchor + DAY, 'current');
  assert.equal(current.startsAt, iso(anchor + DAY));
  assert.equal(current.current, true);
});

check('all 30 closed daily reports are available at the retention boundary', () => {
  const anchor = timestamp('2026-01-01T13:00:00.000Z');
  const now = anchor + 30 * DAY;
  const history = reportHistory(anchor, now);
  assert.equal(history.length, 30);
  assert.equal(history[0].endsAt, iso(now));
  assert.equal(history[29].startsAt, iso(anchor));
  assert.equal(resolveReportPeriod(anchor, now, iso(anchor + DAY)).startsAt, iso(anchor));
});

check('the 31st closed report rolls the oldest daily report out exactly at its boundary', () => {
  const anchor = timestamp('2026-01-01T13:00:00.000Z');
  const before = anchor + 31 * DAY - 1;
  assert.equal(resolveReportPeriod(anchor, before, iso(anchor + DAY)).startsAt, iso(anchor));
  const now = anchor + 31 * DAY;
  const history = reportHistory(anchor, now);
  assert.equal(history.length, 30);
  assert.equal(history[29].startsAt, iso(anchor + DAY));
  assert.ok(!history.some(period => period.startsAt === iso(anchor)));
  throwsCode(() => resolveReportPeriod(anchor, now, iso(anchor + DAY)), 'REPORT_EXPIRED');
  assert.equal(resolveReportPeriod(anchor, now, iso(anchor + 2 * DAY)).startsAt, iso(anchor + DAY));
});

check('history contains only the newest 30 closed reports in newest-first order', () => {
  const anchor = timestamp('2026-01-01T13:00:00.000Z');
  const now = anchor + 80 * DAY + DAY / 2;
  const history = reportHistory(anchor, now);
  assert.equal(history.length, 30);
  for (let index = 0; index < history.length; index += 1) {
    assert.equal(history[index].endsAt, iso(anchor + (80 - index) * DAY));
    assert.equal(history[index].current, false);
    assert.equal(history[index].asOf, history[index].endsAt);
  }
  assert.equal(resolveReportPeriod(anchor, now, null).current, true);
  throwsCode(() => resolveReportPeriod(anchor, now, iso(anchor + 50 * DAY)), 'REPORT_EXPIRED');
});

check('daily report selection rejects malformed, nonaligned, pre-dataset, and future periods', () => {
  const anchor = timestamp('2026-01-01T13:00:00.000Z');
  const now = anchor + 3 * DAY + DAY / 2;
  for (const value of ['not-a-date', '2026-99-99', iso(anchor), iso(anchor - DAY), iso(anchor + DAY + 1), iso(anchor + 4 * DAY), iso(anchor + 10 * DAY)]) {
    throwsCode(() => resolveReportPeriod(anchor, now, value), 'INVALID_REPORT_PERIOD');
  }
  assert.deepEqual(resolveReportPeriod(anchor, now, null), resolveReportPeriod(anchor, now, 'current'));
  assert.equal(resolveReportPeriod(anchor, now, iso(anchor + 3 * DAY)).current, false);
});

check('months remain available after their daily reports expire', () => {
  const anchor = timestamp('2026-01-01T13:00:00.000Z');
  const now = timestamp('2026-04-05T18:00:00.000Z');
  assert.deepEqual(reportMonths(anchor, now), ['2026-04', '2026-03', '2026-02', '2026-01']);
  throwsCode(() => resolveReportPeriod(anchor, now, iso(anchor + DAY)), 'REPORT_EXPIRED');
  const january = monthPeriods(anchor, now, '2026-01');
  assert.equal(january.length, 31);
  assert.equal(january[0].startsAt, iso(anchor));
  assert.equal(january[30].reportDate, '2026-01-31');
  assert.ok(january.every(period => !period.current));
});

check('monthly membership uses the report start date in UTC+3, not its UTC date or end date', () => {
  const anchor = timestamp('2026-01-30T21:30:00.000Z');
  const now = anchor + 3 * DAY + 3_600_000;
  const january = monthPeriods(anchor, now, '2026-01');
  const february = monthPeriods(anchor, now, '2026-02');
  assert.equal(january.length, 1);
  assert.equal(january[0].reportDate, '2026-01-31');
  assert.equal(january[0].endsAt, '2026-01-31T21:30:00.000Z');
  assert.equal(february[0].startsAt, '2026-01-31T21:30:00.000Z');
  assert.equal(february[0].reportDate, '2026-02-01');
  assert.equal(february.length, 3);
  assert.equal(february[2].current, true);
  assert.deepEqual(reportMonths(anchor, now), ['2026-02', '2026-01']);
});

check('partial first and current months contain no fabricated pre-dataset or future days', () => {
  const anchor = timestamp('2026-02-26T23:15:00.000Z');
  const now = timestamp('2026-03-02T23:45:00.000Z');
  const february = monthPeriods(anchor, now, '2026-02');
  const march = monthPeriods(anchor, now, '2026-03');
  assert.deepEqual(february.map(period => period.reportDate), ['2026-02-27', '2026-02-28']);
  assert.deepEqual(march.map(period => period.reportDate), ['2026-03-01', '2026-03-02', '2026-03-03']);
  assert.deepEqual(march.map(period => period.current), [false, false, true]);
  assert.equal(march[2].asOf, iso(now));
  assert.ok([...february, ...march].every(period => timestamp(period.startsAt) >= anchor && timestamp(period.startsAt) <= now));
});

check('February includes leap day only in a leap year', () => {
  for (const [year, days] of [[2024, 29], [2025, 28]] as const) {
    const anchor = timestamp(`${year}-01-31T23:15:00.000Z`);
    const now = timestamp(`${year}-03-02T23:45:00.000Z`);
    const february = monthPeriods(anchor, now, `${year}-02`);
    assert.equal(february.length, days);
    assert.equal(february[0].reportDate, `${year}-02-01`);
    assert.equal(february[days - 1].reportDate, `${year}-02-${days}`);
    assert.ok(february.every(period => !period.current));
  }
});

check('monthly lists remain chronological across a year transition', () => {
  const anchor = timestamp('2025-12-30T23:00:00.000Z');
  const now = timestamp('2026-01-02T23:30:00.000Z');
  assert.deepEqual(reportMonths(anchor, now), ['2026-01', '2025-12']);
  assert.deepEqual(monthPeriods(anchor, now, '2025-12').map(period => period.reportDate), ['2025-12-31']);
  assert.deepEqual(monthPeriods(anchor, now, '2026-01').map(period => period.reportDate), ['2026-01-01', '2026-01-02', '2026-01-03']);
});

check('monthly selectors reject malformed, pre-dataset, and future months', () => {
  const anchor = timestamp('2026-01-31T21:30:00.000Z');
  const now = timestamp('2026-03-03T12:00:00.000Z');
  for (const month of ['', 'not-a-month', '2026-1', '2026-00', '2026-13', '2026-02-01', '2026-02suffix', ' 2026-02', '2026-02 ', '2025-12', '2026-01', '2026-04', '2027-02']) {
    throwsCode(() => monthPeriods(anchor, now, month), 'INVALID_REPORT_MONTH');
  }
  assert.deepEqual(reportMonths(anchor, now), ['2026-03', '2026-02']);
});

check('monthly reporting does not alter the anchored 24-hour report windows', () => {
  const anchor = timestamp('2026-01-30T21:30:45.123Z');
  const now = anchor + 5 * DAY + 1;
  const before = reportHistory(anchor, now);
  const periods = reportMonths(anchor, now).flatMap(month => monthPeriods(anchor, now, month));
  for (const period of periods) {
    assert.equal(timestamp(period.endsAt) - timestamp(period.startsAt), DAY);
    assert.equal((timestamp(period.startsAt) - anchor) % DAY, 0);
  }
  assert.deepEqual(reportHistory(anchor, now), before);
});

console.log(`\n${checks} report-period checks passed.`);
