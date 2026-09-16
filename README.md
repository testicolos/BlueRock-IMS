# BlueRock IMS

Backend foundation for BlueRock's Inventory Management System.

## Inventory domains
- Tools & Equipment
- Display Samples

Both use one barcode/location movement engine and immutable scan history.

## Stack
- Next.js 16 / TypeScript
- PostgreSQL
- JWT authentication
- Zod validation
- Vercel deployment target

## Local setup
1. Copy `.env.example` to `.env.local`.
2. Create a PostgreSQL database and run `db/schema.sql`.
3. Set `DATABASE_URL`, `JWT_SECRET` and `AUTH_BOOTSTRAP_SECRET`.
4. `npm install`
5. `npm run dev`
6. Create the initial administrator with `POST /api/setup/bootstrap` using header `x-bootstrap-secret`.

## Main API
- `POST /api/auth/login`
- `GET/POST /api/locations`
- `PATCH/DELETE /api/locations/:id`
- `GET/POST /api/users`
- `PATCH /api/users/:id`
- `GET/POST /api/inventory`
- `GET/PATCH/DELETE /api/inventory/:id`
- `GET/POST /api/scans`
- `GET /api/scans/checklist?period=current` (admin only)
- `GET /api/scans/checklist/export?period=current` (admin-only daily Excel; a closed period's ISO end timestamp is also accepted)
- `GET /api/scans/checklist/export?month=YYYY-MM` (admin-only monthly Excel)
- `GET /api/scans/:id/evidence` (admin only)
- `GET/POST /api/issues`

The Android app will use the login, locations, inventory lookup and scans endpoints.

## Manual barcode entry and camera recovery

Scan Unit always exposes manual barcode entry, without requiring failed camera scans first. A typed barcode must match the backend inventory before submission. Manual entry then requires a fresh live-camera photo showing the material and barcode; there is no gallery/file chooser for manual proof. The app stamps the shutter time and captured GPS coordinates on the photo. Editing or rematching a barcode clears its previous validation and evidence. Camera-decoded scans keep optional photo attachment.

The backend rejects manual scans without inline JPEG/PNG/WebP image evidence and binds the submission's capture method to the validated attempt. It validates image format/presence; browser requests cannot cryptographically prove live-camera provenance. Camera sessions release hardware on cancellation and unmount, and late permission responses are discarded. The required-photo camera also pauses when the app is backgrounded and detects stalled previews.

The **Refresh page** button reloads the same Scan Unit page, including in the installed mobile web app. It warns before discarding unsaved barcode details, photos, or notes, and is disabled while a scan is being submitted. Submitted records are not removed. Camera startup timeouts allow retrying if permissions or a preview stall.

## Rolling scan records and checklists

Each barcode's first accepted scan starts a fixed 24-hour window, using server time. Further scans in that window replace the entry shown in Scan History and the current checklist without moving the deadline. At the exact deadline the item becomes Not scanned; its next accepted scan starts a new window. Different barcodes reset independently, including across midnight.

Underlying scan events, locations, defects, GPS and photos remain immutable. Scan History shows the most recent 500 window records, while the per-item history retains individual movements. Admins can open all photos submitted up to the displayed scan in its window; scanners cannot access these reports or evidence endpoints. Image data is fetched only when opened, not included in scan list responses.

The current checklist includes every unarchived tool/sample unit, even units never scanned, and refreshes every 60 seconds. Closed checklist snapshots become available every 24 hours from the reporting anchor (the earliest existing scan at migration, or installation time if there are no scans). These report times do not reset barcode windows. Snapshots are computed on demand from immutable events and inventory creation/archive times, so no browser session or scheduled job is needed. The selector retains the latest 30 closed reports, plus the current in-progress report. Older daily requests return HTTP 410; immutable scan history and photo evidence are not deleted. Historical names reflect current names; pre-migration archive times use the previously recorded update timestamp.

### Excel reports

Admins can export any available daily report or select a month from the reporting archive. All dates and times use Qatar/Saudi time (UTC+3). Reports belong to the date and month in which their 24-hour reporting period **starts**, not midnight-based calendar days. Monthly exports include all available periods in that month, even beyond the 30-day daily selector, and clearly mark an in-progress period. Periods before installation and future periods are not invented.

Daily Excel contains all eligible units, including never-scanned units. Monthly Excel contains daily totals, unit summaries, and unit-by-day detail. Scanned/not-scanned status is evaluated at each report cutoff using the barcode's rolling window; separate scan-submission and unique-scanned-unit counts describe activity within the period. Rescans count as submissions but do not duplicate a unit in the checklist. Exports include all units regardless of on-screen search/status filters. Barcode cells remain text, timestamps are labeled UTC+3, and scan metadata includes GPS and photo counts without embedding private image data. Downloads require admin authentication and are not cached publicly.

Schema upgrades run transactionally via `ensureInventorySchema` with an advisory lock; `src/lib/scan-windows.ts` creates/backfills the window tables and protects them with RLS. Existing scans and issue references are preserved. New installations run `db/schema.sql` first, then the same application migration on the first inventory request.

### Verification

Run `npm run typecheck`, `npm run build`, `npm run test:scan-access`, `npm run test:navigation`, `npx tsx scripts/test-report-periods.ts`, and `npm run test:report-xlsx`. For database integration tests, set `TEST_DATABASE_URL` to a disposable PostgreSQL instance and run `npm run test:scans`. Tests create a uniquely named isolated schema, verify migration/backfill, exact boundaries, independent windows, concurrent retries, current/closed checklists, photo filtering, report retention and monthly aggregation, then remove only that test schema. Excel tests round-trip generated workbooks to verify typed barcodes, UTC+3 timestamps, totals, sheets, and empty/partial reports.
