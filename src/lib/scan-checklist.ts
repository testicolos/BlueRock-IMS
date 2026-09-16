import { db } from '@/lib/db';
import { RETENTION_DAYS, REPORT_TIMEZONE, monthPeriods, reportHistory, reportMonths, resolveReportPeriod } from '@/lib/scan-report-periods';
import { reportClock, reportsAt } from '@/lib/scan-report-data';
export type { ChecklistRow, ScanReport } from '@/lib/scan-report-data';

export async function scanChecklist(period: string | null, sql = db()) {
  const {now, anchor} = await reportClock(sql);
  const selected = resolveReportPeriod(anchor, now, period);
  const [report] = await reportsAt([selected], sql);
  const current = resolveReportPeriod(anchor, now, 'current');
  return {
    ...report, generatedAt: new Date(now).toISOString(), timezone: REPORT_TIMEZONE, retentionDays: RETENTION_DAYS,
    nextReportAt: current.endsAt, periods: reportHistory(anchor, now), months: reportMonths(anchor, now),
  };
}

export async function scanMonthlyReport(month: string, sql = db()) {
  const {now, anchor} = await reportClock(sql);
  const reports = await reportsAt(monthPeriods(anchor, now, month), sql);
  return {month, generatedAt: new Date(now).toISOString(), timezone: REPORT_TIMEZONE, reports};
}
