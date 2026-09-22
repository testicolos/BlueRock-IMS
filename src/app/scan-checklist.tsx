'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, CheckCircle2, ClipboardList, Clock3, Download, RefreshCw, Search } from 'lucide-react';

import ScanEvidence from './scan-evidence';
import styles from './scan-checklist.module.css';

type ChecklistRow = {
  id: string;
  barcode: string;
  name: string;
  inventory_type: string;
  location_name: string | null;
  customer_name: string | null;
  employee_name: string | null;
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
  inventoryType: 'TOOL' | 'SAMPLE';
  asOf: string;
  current: boolean;
  startsAt: string;
  endsAt: string;
  reportDate: string;
  retentionDays: number;
  months: string[];
  nextReportAt: string;
  scanSessionId: string | null;
  periods: ReportPeriod[];
  rows: ChecklistRow[];
};
type Api = <T>(url: string, options?: RequestInit) => Promise<T>;
type SortKey = 'ITEM' | 'LOCATION' | 'CUSTOMER' | 'EMPLOYEE' | 'STATUS' | 'SCANNED_AT' | 'WINDOW' | 'PHOTOS';
type SortDirection = 'ASC' | 'DESC';

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

export default function ScanChecklist({ api, download, inventoryType }: { api: Api; download: (url: string) => Promise<void>; inventoryType: 'TOOL' | 'SAMPLE' }) {
  const isSample = inventoryType === 'SAMPLE';
  const reportTitle = isSample ? 'Samples report' : 'Materials scan checklist';
  const apiRef = useRef(api);
  const [period, setPeriod] = useState('current');
  const [periods, setPeriods] = useState<ReportPeriod[]>([]);
  const [data, setData] = useState<ChecklistResponse | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'ALL' | ChecklistRow['status']>('ALL');
  const [location, setLocation] = useState('ALL');
  const [sortKey, setSortKey] = useState<SortKey>('ITEM');
  const [sortDirection, setSortDirection] = useState<SortDirection>('ASC');
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
          `/api/scans/checklist?inventoryType=${inventoryType}&period=${encodeURIComponent(period)}`,
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
  }, [inventoryType, period, refreshKey]);

  useEffect(() => {
    if (period !== 'current') return;
    const timer = window.setInterval(() => setRefreshKey(value => value + 1), 60_000);
    return () => window.clearInterval(timer);
  }, [period]);

  const scopedRows = useMemo(() => (data?.rows || []).filter(row => row.inventory_type === inventoryType), [data, inventoryType]);
  const locations = useMemo(() => Array.from(new Set(scopedRows.map(row => row.location_name || 'Unassigned'))).sort((left, right) => left.localeCompare(right)), [scopedRows]);
  useEffect(() => {
    if (!isSample && location !== 'ALL' && !locations.includes(location)) setLocation('ALL');
  }, [isSample, location, locations]);
  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    const filtered = scopedRows.filter(row =>
      (status === 'ALL' || row.status === status) &&
      (isSample || location === 'ALL' || (row.location_name || 'Unassigned') === location) &&
      (!term || `${row.barcode} ${row.name} ${isSample ? `${row.customer_name || ''} ${row.employee_name || ''}` : row.location_name || ''} ${isSample ? 'display sample' : 'tool equipment'} ${row.scanner_name || ''}`.toLowerCase().includes(term)),
    );
    const text = (value: string | null | undefined) => (value || '').toLocaleLowerCase();
    const time = (value: string | null | undefined) => value ? new Date(value).getTime() : 0;
    const compare = (left: ChecklistRow, right: ChecklistRow) => {
      switch (sortKey) {
        case 'ITEM': return text(left.name).localeCompare(text(right.name)) || text(left.barcode).localeCompare(text(right.barcode));
        case 'LOCATION': return text(left.location_name || 'Unassigned').localeCompare(text(right.location_name || 'Unassigned'));
        case 'CUSTOMER': return text(left.customer_name).localeCompare(text(right.customer_name));
        case 'EMPLOYEE': return text(left.employee_name).localeCompare(text(right.employee_name));
        case 'STATUS': return left.status.localeCompare(right.status);
        case 'SCANNED_AT': return time(left.scanned_at) - time(right.scanned_at);
        case 'WINDOW': return time(left.window_expires_at) - time(right.window_expires_at);
        case 'PHOTOS': return left.photo_count - right.photo_count;
      }
    };
    return [...filtered].sort((left, right) => {
      const result = compare(left, right);
      return sortDirection === 'ASC' ? result : -result;
    });
  }, [scopedRows, isSample, location, query, status, sortDirection, sortKey]);
  const total = scopedRows.length;
  const scanned = scopedRows.filter(row => row.status === 'SCANNED').length;

  function sortBy(next: SortKey) {
    if (next === sortKey) {
      setSortDirection(current => current === 'ASC' ? 'DESC' : 'ASC');
      return;
    }
    setSortKey(next);
    setSortDirection(['SCANNED_AT','WINDOW','PHOTOS'].includes(next) ? 'DESC' : 'ASC');
  }

  function sortHeader(label: string, key: SortKey) {
    const active = sortKey === key;
    const Icon = active ? (sortDirection === 'ASC' ? ArrowUp : ArrowDown) : ArrowUpDown;
    return <button type="button" className={`${styles.sortButton} ${active ? styles.sortActive : ''}`} onClick={() => sortBy(key)} aria-label={`Sort by ${label}${active ? `, currently ${sortDirection === 'ASC' ? 'ascending' : 'descending'}` : ''}`}><span>{label}</span><Icon size={14} aria-hidden="true" /></button>;
  }

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
      await download(`/api/scans/checklist/export?inventoryType=${inventoryType}&${selection}`);
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
        <h2 id={titleId}>{reportTitle}</h2>
        <p>{isSample ? 'Track display sample barcodes by customer and employee, including units that still need a scan.' : 'Track tools and equipment barcodes, including units that still need a scan. Display samples have their own report.'}</p>
      </div>
      <button type="button" className={`secondary ${styles.refresh}`} disabled={loading || !!exporting} onClick={() => setRefreshKey(value => value + 1)}>
        <RefreshCw size={17} aria-hidden="true" />{loading ? 'Refreshing…' : 'Refresh'}
      </button>
    </header>

    <div className={styles.explanation}>
      <Clock3 size={21} aria-hidden="true" />
      <div><strong>Each barcode has its own 24-hour scan window.</strong><p>The first scan starts its window. Further scans do not extend it. After 24 hours, that barcode needs a new scan. Daily report history is available for {data?.retentionDays || 30} days, with a report created automatically every 24 hours.</p></div>
    </div>
    {data?.current && !data.scanSessionId && <div className={styles.sessionNotice} role="status"><strong>No active {isSample ? 'sample' : 'equipment'} scan session.</strong><span>The report remains available, but scanners cannot submit new scans until an administrator starts a session from Overview.</span></div>}

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
      <p className={styles.exportNote}>Excel exports include all {isSample ? 'sample' : 'tool and equipment'} units, regardless of the search and status filters below. Report dates and times use UTC+3. Daily and monthly reports are grouped by the reporting period’s start date.</p>
      {exportError && <div className={styles.exportError} role="alert"><strong>Excel download failed.</strong> {exportError}</div>}
      {exporting && <span className={styles.exportProgress} role="status">Preparing your {exporting} Excel report. The download will begin when it is ready.</span>}
    </section>

    <div className={`${styles.filters} ${isSample ? styles.sampleFilters : ''} `}>
      <label className={styles.search}>{isSample ? 'Find a sample, customer or employee' : 'Find a barcode or material'}
        <span><Search size={17} aria-hidden="true" /><input type="search" placeholder={isSample ? 'Barcode, sample, customer, employee…' : 'Barcode, material, location…'} value={query} onChange={event => setQuery(event.target.value)} /></span>
      </label>
      <label>Status
        <select value={status} onChange={event => setStatus(event.target.value as typeof status)}>
          <option value="ALL">All units</option>
          <option value="SCANNED">Scanned</option>
          <option value="NOT_SCANNED">Not scanned</option>
        </select>
      </label>
      {!isSample && <label>Location
        <select value={location} onChange={event => setLocation(event.target.value)}>
          <option value="ALL">All locations</option>
          {locations.map(value => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>}
    </div>

    {error && <div className={styles.error} role="alert"><div><strong>{error.toLowerCase().includes('start a scan session') ? 'No active scan session.' : 'Checklist could not be refreshed.'}</strong><p>{error}</p>{data && <small>Showing the last successful result from {displayDate(data.asOf)}. Statuses may have changed.</small>}</div><button type="button" className="secondary" disabled={loading} onClick={() => setRefreshKey(value => value + 1)}>Retry</button></div>}

    {!data && loading && <div className={styles.message} role="status"><ClipboardList size={30} aria-hidden="true" /><strong>Loading barcode checklist…</strong><p>Checking scan status for every unit.</p></div>}

    {data && <>
      <div className={styles.summary} aria-label="Checklist totals">
        <div><ClipboardList size={22} aria-hidden="true" /><span><small>Total units</small><strong>{total.toLocaleString()}</strong></span></div>
        <div className={styles.scannedSummary}><CheckCircle2 size={22} aria-hidden="true" /><span><small>Scanned</small><strong>{scanned.toLocaleString()}</strong></span></div>
        <div className={styles.pendingSummary}><Clock3 size={22} aria-hidden="true" /><span><small>Not scanned</small><strong>{(total - scanned).toLocaleString()}</strong></span></div>
      </div>
      <div className={styles.reportDetails}>
        <p><strong>{data.current ? 'Current status as of' : 'Closed snapshot at'}</strong> {displayDate(data.asOf)}</p>
        <p>{data.current ? <>Updates every 60 seconds · Next automatic report: <strong>{displayDate(data.nextReportAt)}</strong></> : isSample ? 'Scan statuses and evidence reflect the snapshot time; sample, user, customer and employee names use their current labels.' : 'Scan statuses and evidence reflect the snapshot time; material, user and location names use their current labels.'}</p>
      </div>
      <div className={styles.tablePanel} aria-busy={loading}>
        <div className={styles.tableHeading}><strong>{rows.length.toLocaleString()} of {total.toLocaleString()} units</strong><span id={tableHintId}>Scroll sideways to see all details</span></div>
        {total === 0 ? <div className={styles.message}><ClipboardList size={30} aria-hidden="true" /><strong>No eligible units in this {data.current ? 'checklist' : 'report'}.</strong><p>{isSample ? 'Sample units will appear here when they are available in inventory.' : 'Tool and equipment units will appear here when they are available in inventory.'}</p></div> : rows.length === 0 ? <div className={styles.message}><Search size={30} aria-hidden="true" /><strong>No units match these filters.</strong><p>{isSample ? 'Try another barcode, sample, customer, employee, or status.' : 'Try another barcode, material, or status.'}</p><button type="button" className="secondary" onClick={() => { setQuery(''); setStatus('ALL'); setLocation('ALL'); }}>Clear filters</button></div> : <div className={styles.tableScroll} tabIndex={0} role="region" aria-label={reportTitle} aria-describedby={tableHintId}>
          <table className={`${styles.table}${isSample ? ` ${styles.sampleTable}` : ''}`}>
            <thead><tr>
              <th scope="col" aria-sort={sortKey === 'ITEM' ? (sortDirection === 'ASC' ? 'ascending' : 'descending') : 'none'}>{sortHeader(isSample ? 'Sample / barcode' : 'Material / barcode','ITEM')}</th>
              {isSample ? <>
                <th scope="col" aria-sort={sortKey === 'CUSTOMER' ? (sortDirection === 'ASC' ? 'ascending' : 'descending') : 'none'}>{sortHeader('Customer','CUSTOMER')}</th>
                <th scope="col" aria-sort={sortKey === 'EMPLOYEE' ? (sortDirection === 'ASC' ? 'ascending' : 'descending') : 'none'}>{sortHeader('Employee','EMPLOYEE')}</th>
              </> : <th scope="col" aria-sort={sortKey === 'LOCATION' ? (sortDirection === 'ASC' ? 'ascending' : 'descending') : 'none'}>{sortHeader('Location','LOCATION')}</th>}
              <th scope="col" aria-sort={sortKey === 'STATUS' ? (sortDirection === 'ASC' ? 'ascending' : 'descending') : 'none'}>{sortHeader('Scan status','STATUS')}</th>
              <th scope="col" aria-sort={sortKey === 'SCANNED_AT' ? (sortDirection === 'ASC' ? 'ascending' : 'descending') : 'none'}>{sortHeader('Recorded scan','SCANNED_AT')}</th>
              <th scope="col" aria-sort={sortKey === 'WINDOW' ? (sortDirection === 'ASC' ? 'ascending' : 'descending') : 'none'}>{sortHeader('24-hour window','WINDOW')}</th>
              <th scope="col" aria-sort={sortKey === 'PHOTOS' ? (sortDirection === 'ASC' ? 'ascending' : 'descending') : 'none'}>{sortHeader('Photo evidence','PHOTOS')}</th>
            </tr></thead>
            <tbody>{rows.map(row => <tr key={row.id}>
              <td><span className={styles.itemType}>{row.inventory_type === 'SAMPLE' ? 'Display sample' : 'Tool / Equipment'}</span><strong>{row.name}</strong><code>{row.barcode}</code></td>
              {isSample ? <><td>{row.customer_name || <span className={styles.muted}>Not specified</span>}</td><td>{row.employee_name || <span className={styles.muted}>Not specified</span>}</td></> : <td>{row.location_name || 'Unassigned'}</td>}
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
