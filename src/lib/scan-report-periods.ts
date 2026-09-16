export const DAY = 86_400_000;
export const RETENTION_DAYS = 30;
export const REPORT_TIMEZONE = 'Asia/Qatar';
const OFFSET = 3 * 60 * 60 * 1000;

export type ReportPeriod = {
  id: string; startsAt: string; endsAt: string; asOf: string; current: boolean; reportDate: string;
};

export function reportDate(timestamp: string | Date | number): string {
  return new Date(new Date(timestamp).getTime() + OFFSET).toISOString().slice(0, 10);
}

export function reportPeriod(anchor: number, now: number, index: number): ReportPeriod {
  const startsAt = anchor + index * DAY;
  const endsAt = startsAt + DAY;
  const current = endsAt > now;
  return { id: current ? 'current' : new Date(endsAt).toISOString(), startsAt: new Date(startsAt).toISOString(),
    endsAt: new Date(endsAt).toISOString(), asOf: new Date(Math.min(endsAt, now)).toISOString(),
    current, reportDate: reportDate(startsAt) };
}

export function reportHistory(anchor: number, now: number): ReportPeriod[] {
  const completed = Math.max(0, Math.floor((now - anchor) / DAY));
  return Array.from({length: Math.min(completed, RETENTION_DAYS)}, (_, offset) => reportPeriod(anchor, now, completed - offset - 1));
}

export function resolveReportPeriod(anchor: number, now: number, period: string | null): ReportPeriod {
  const completed = Math.max(0, Math.floor((now - anchor) / DAY));
  if (!period || period === 'current') return reportPeriod(anchor, now, completed);
  const requested = Date.parse(period);
  const index = (requested - anchor) / DAY - 1;
  if (!Number.isFinite(requested) || !Number.isInteger(index) || index < 0 || requested > now) throw new Error('INVALID_REPORT_PERIOD');
  if (index < completed - RETENTION_DAYS) throw new Error('REPORT_EXPIRED');
  return reportPeriod(anchor, now, index);
}

function monthNumber(value: string): number {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new Error('INVALID_REPORT_MONTH');
  const [year, month] = value.split('-').map(Number);
  return year * 12 + month - 1;
}

export function reportMonths(anchor: number, now: number): string[] {
  const completed = Math.max(0, Math.floor((now - anchor) / DAY));
  const first = monthNumber(reportDate(anchor).slice(0, 7));
  const latest = monthNumber(reportDate(anchor + completed * DAY).slice(0, 7));
  return Array.from({length: Math.max(0, latest - first + 1)}, (_, offset) => {
    const month = latest - offset;
    return `${String(Math.floor(month / 12)).padStart(4, '0')}-${String(month % 12 + 1).padStart(2, '0')}`;
  });
}

// The monthly archive reads immutable events, independently of the daily list.
// Neither scan history nor photo evidence is deleted after the thirtieth day.
export function monthPeriods(anchor: number, now: number, month: string): ReportPeriod[] {
  const number = monthNumber(month);
  if (!reportMonths(anchor, now).includes(month)) throw new Error('INVALID_REPORT_MONTH');
  const year = Math.floor(number / 12);
  const monthIndex = number % 12;
  const monthStart = Date.UTC(year, monthIndex, 1) - OFFSET;
  const monthEnd = Date.UTC(year, monthIndex + 1, 1) - OFFSET;
  const firstIndex = Math.max(0, Math.ceil((monthStart - anchor) / DAY));
  const lastIndex = Math.min(Math.ceil((monthEnd - anchor) / DAY) - 1, Math.max(0, Math.floor((now - anchor) / DAY)));
  return Array.from({length: Math.max(0, lastIndex - firstIndex + 1)}, (_, index) => reportPeriod(anchor, now, firstIndex + index));
}
