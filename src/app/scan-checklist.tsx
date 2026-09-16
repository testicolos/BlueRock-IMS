'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { CheckCircle2, ClipboardList, Clock3, Download, RefreshCw, Search } from 'lucide-react';

import ScanEvidence from './scan-evidence';
import styles from './scan-checklist.module.css';

type ChecklistRow = {
  id: string;
  barcode: string;
  name: string;
  inventory_type: string;
  location_name: string | null;
  status: 'SCANNED' | 'NOT_SCANNED';
  scan_id: string | null;
  scanned_at: string | null;
  window_started_at: string | null;
  window_expires_at: string | null;
  scanner_name: string | null;
  condition: string | null;
  photo_count: number;
};

type ReportPeriod = { id: string; startsAt: string; endsAt: string; reportDate: string };
type ChecklistResponse = {
  asOf: string;
  current: boolean;
  startsAt: string;
  endsAt: string;
  reportDate: string;
  retentionDays: number;
  months: string[];
  nextReportAt: string;
  periods: ReportPeriod[];
  rows: ChecklistRow[];
};
type Api = <T>(url: string, options?: RequestInit) => Promise<T>;

function displayDate(value: string | null) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not recorded';
  return date.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Riyadh', timeZoneName: 'short',
  });
}

function displayReportDate(value: string) {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}

function displayMonth(value: string) {
  return new Date(`${value}-01T00:00:00Z`).toLocaleDateString(undefined, {
    year: 'numeric', month: 'long', timeZone: 'UTC',
  });
}

function displayCondition(value: string | null) {
  return value ? value.toLowerCase().replace(/_/g, ' ').replace(/^\w/, letter => letter.toUpperCase()) : 'Not recorded';
}

export default function ScanChecklist({ api, download }: { api: Api; download: (url: string) => Promise<void> }) {
  const apiRef = useRef(api);
  const [period, setPeriod] = useState('current');
  const [periods, setPeriods] = useState<ReportPeriod[]>([]);
  const [data, setData] = useState<ChecklistResponse | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'ALL' | ChecklistRow['status']>('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [month, setMonth] = useState('');
  const [exporting, setExporting] = useState<'daily' | 'monthly' | null>(null);
  const [exportError, setExportError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const titleId = useId();
  const tableHintId = useId();

  useEffect(() => { apiRef.current = api; }, [api]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError('');
    async function load() {
      try {
        const result = await apiRef.current<ChecklistResponse>(
          `/api/scans/checklist?period=${encodeURIComponent(period)}`,
          { cache: 'no-store', signal: controller.signal },
        );
        if (!active) return;
        setData(result);
        setPeriods([...result.periods].sort((left, right) => new Date(right.endsAt).getTime() - new Date(left.endsAt).getTime()));
        setMonth(previous => result.months.includes(previous) ? previous : result.months[0] || '');
      } catch (caught) {
        if (!active || controller.signal.aborted) return;
        setError(caught instanceof Error ? caught.message : 'Could not load the scan checklist.');
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; controller.abort(); };
  }, [period, refreshKey]);

  useEffect(() => {
    if (period !== 'current') return;
    const timer = window.setInterval(() => setRefreshKey(value => value + 1), 60_000);
    return () => window.clearInterval(timer);
  }, [period]);

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    return (data?.rows || []).filter(row =>
      (status === 'ALL' || row.status === status) &&
      (!term || `${row.barcode} ${row.name} ${row.location_name || ''} ${row.inventory_type === 'SAMPLE' ? 'display sample' : 'tool equipment'} ${row.scanner_name || ''}`.toLowerCase().includes(term)),
    );
  }, [data, query, status]);
  const total = data?.rows.length || 0;
  const scanned = data?.rows.filter(row => row.status === 'SCANNED').length || 0;

  function changePeriod(next: string) {
    if (next === period) return;
    setData(null);
    setError('');
    setExportError('');
    setLoading(true);
    setPeriod(next);
  }

  async function exportReport(kind: 'daily' | 'monthly') {
    if (loading || exporting || !data || (kind === 'monthly' && !month)) return;
    setExporting(kind);
    setExportError('');
    try {
      const selection = kind === 'daily' ? `period=${encodeURIComponent(period)}` : `month=${encodeURIComponent(month)}`;
      await download(`/api/scans/checklist/export?${selection}`);
    } catch (caught) {
      setExportError(caught instanceof Error ? caught.message : 'Could not download the Excel report. Please try again.');
    } finally {
      setExporting(null);
    }
  }

  return <section className={styles.checklist} aria-labelledby={titleId}>
    <header className={styles.heading}>
      <div>
        <span className="eyebrow">BARCODE COVERAGE</span>
        <h2 id={titleId}>Scan checklist</h2>
        <p>Track every equipment and sample barcode, including units that still need a scan.</p>
      </div>
      <button type="button" className={`secondary ${styles.refresh}`} disabled={loading || !!exporting} onClick={() => setRefreshKey(value => value + 1)}>
        <RefreshCw size={17} aria-hidden="true" />{loading ? 'Refreshing…' : 'Refresh'}
      </button>
    </header>

    <div className={styles.explanation}>
      <Clock3 size={21} aria-hidden="true" />
      <div><strong>Each barcode has its own 24-hour scan window.</strong><p>The first scan starts its window. Further scans do not extend it. After 24 hours, that barcode needs a new scan. Daily report history is available for {data?.retentionDays || 30} days, with a report created automatically every 24 hours.</p></div>
    </div>

    <section className={styles.reportControls} aria-label="Report history and Excel exports">
      <div className={styles.reportChoice}>
        <label>Daily report history ({data?.retentionDays || 30} days)
          <select value={period} disabled={loading || !!exporting} onChange={event => changePeriod(event.target.value)}>
            <option value="current">Current checklist · in progress</option>
            {periods.map(report => <option key={report.id} value={report.endsAt}>{displayReportDate(report.reportDate)} · ending {displayDate(report.endsAt)}</option>)}
          </select>
        </label>
        <button type="button" className="primary" disabled={loading || !!exporting || !data} onClick={() => void exportReport('daily')}><Download size={17} aria-hidden="true" />{exporting === 'daily' ? 'Preparing daily Excel…' : 'Export daily Excel'}</button>
        {data && <p className={styles.periodRange}>{displayDate(data.startsAt)} – {displayDate(data.endsAt)}{data.current && ' · in progress'}</p>}
      </div>
      <div className={styles.reportChoice}>
        <label>Monthly results
          <select value={month} disabled={loading || !!exporting || !data?.months.length} onChange={event => { setMonth(event.target.value); setExportError(''); }}>
            {!data?.months.length && <option value="">No reports available</option>}
            {data?.months.map(value => <option key={value} value={value}>{displayMonth(value)}</option>)}
          </select>
        </label>
        <button type="button" className="secondary" disabled={loading || !!exporting || !data || !month} onClick={() => void exportReport('monthly')}><Download size={17} aria-hidden="true" />{exporting === 'monthly' ? 'Preparing monthly Excel…' : 'Export monthly Excel'}</button>
        <p className={styles.periodRange}>Includes closed reports and the in-progress report, when applicable.</p>
      </div>
      <p className={styles.exportNote}>Excel exports include all units, regardless of the search and status filters below. Report dates and times use UTC+3. Daily and monthly reports are grouped by the reporting period’s start date.</p>
      {exportError && <div className={styles.exportError} role="alert"><strong>Excel download failed.</strong> {exportError}</div>}
      {exporting && <span className={styles.exportProgress} role="status">Preparing your {exporting} Excel report. The download will begin when it is ready.</span>}
    </section>

    <div className={styles.filters}>
      <label className={styles.search}>Find a barcode or material
        <span><Search size={17} aria-hidden="true" /><input type="search" placeholder="Barcode, material, location…" value={query} onChange={event => setQuery(event.target.value)} /></span>
      </label>
      <label>Status
        <select value={status} onChange={event => setStatus(event.target.value as typeof status)}>
          <option value="ALL">All units</option>
          <option value="SCANNED">Scanned</option>
          <option value="NOT_SCANNED">Not scanned</option>
        </select>
      </label>
    </div>

    {error && <div className={styles.error} role="alert"><div><strong>Checklist could not be refreshed.</strong><p>{error}</p>{data && <small>Showing the last successful result from {displayDate(data.asOf)}. Statuses may have changed.</small>}</div><button type="button" className="secondary" disabled={loading} onClick={() => setRefreshKey(value => value + 1)}>Retry</button></div>}

    {!data && loading && <div className={styles.message} role="status"><ClipboardList size={30} aria-hidden="true" /><strong>Loading barcode checklist…</strong><p>Checking scan status for every unit.</p></div>}

    {data && <>
      <div className={styles.summary} aria-label="Checklist totals">
        <div><ClipboardList size={22} aria-hidden="true" /><span><small>Total units</small><strong>{total.toLocaleString()}</strong></span></div>
        <div className={styles.scannedSummary}><CheckCircle2 size={22} aria-hidden="true" /><span><small>Scanned</small><strong>{scanned.toLocaleString()}</strong></span></div>
        <div className={styles.pendingSummary}><Clock3 size={22} aria-hidden="true" /><span><small>Not scanned</small><strong>{(total - scanned).toLocaleString()}</strong></span></div>
      </div>
      <div className={styles.reportDetails}>
        <p><strong>{data.current ? 'Current status as of' : 'Closed snapshot at'}</strong> {displayDate(data.asOf)}</p>
        <p>{data.current ? <>Updates every 60 seconds · Next automatic report: <strong>{displayDate(data.nextReportAt)}</strong></> : 'Scan statuses and evidence reflect the snapshot time; material, user and location names use their current labels.'}</p>
      </div>
      <div className={styles.tablePanel} aria-busy={loading}>
        <div className={styles.tableHeading}><strong>{rows.length.toLocaleString()} of {total.toLocaleString()} units</strong><span id={tableHintId}>Scroll sideways to see all details</span></div>
        {total === 0 ? <div className={styles.message}><ClipboardList size={30} aria-hidden="true" /><strong>No eligible units in this {data.current ? 'checklist' : 'report'}.</strong><p>Equipment and sample units will appear here when they are available in inventory.</p></div> : rows.length === 0 ? <div className={styles.message}><Search size={30} aria-hidden="true" /><strong>No units match these filters.</strong><p>Try another barcode, material, or status.</p><button type="button" className="secondary" onClick={() => { setQuery(''); setStatus('ALL'); }}>Clear filters</button></div> : <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="Barcode scan checklist" aria-describedby={tableHintId}>
          <table className={styles.table}>
            <thead><tr><th scope="col">Material / barcode</th><th scope="col">Location</th><th scope="col">Scan status</th><th scope="col">Recorded scan</th><th scope="col">24-hour window</th><th scope="col">Photo evidence</th></tr></thead>
            <tbody>{rows.map(row => <tr key={row.id}>
              <td><span className={styles.itemType}>{row.inventory_type === 'SAMPLE' ? 'Display sample' : 'Tool / Equipment'}</span><strong>{row.name}</strong><code>{row.barcode}</code></td>
              <td>{row.location_name || 'Unassigned'}</td>
              <td><span className={`${styles.status} ${row.status === 'SCANNED' ? styles.scanned : styles.pending}`}>{row.status === 'SCANNED' ? <CheckCircle2 size={14} aria-hidden="true" /> : <Clock3 size={14} aria-hidden="true" />}{row.status === 'SCANNED' ? 'Scanned' : 'Not scanned'}</span></td>
              <td>{row.scanned_at ? <><strong>{displayDate(row.scanned_at)}</strong><small>{row.scanner_name || 'Scanner not recorded'}</small><small>Condition: {displayCondition(row.condition)}</small></> : <span className={styles.muted}>No scan recorded</span>}</td>
              <td>{row.window_started_at && row.window_expires_at ? <div className={styles.window}><small>Started {displayDate(row.window_started_at)}</small><strong>{row.status === 'SCANNED' ? 'Expires' : 'Expired'} {displayDate(row.window_expires_at)}</strong></div> : <span className={styles.muted}>Awaiting first scan</span>}</td>
              <td><ScanEvidence scanId={row.scan_id} photoCount={row.photo_count} api={api} /></td>
            </tr>)}</tbody>
          </table>
        </div>}
      </div>
    </>}
  </section>;
}
