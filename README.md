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
- `GET /api/scans/:id/evidence` (admin only)
- `GET/POST /api/issues`

The Android app will use the login, locations, inventory lookup and scans endpoints.

## Rolling scan records and checklists

Each barcode's first accepted scan starts a fixed 24-hour window, using server time. Further scans in that window replace the entry shown in Scan History and the current checklist without moving the deadline. At the exact deadline the item becomes Not scanned; its next accepted scan starts a new window. Different barcodes reset independently, including across midnight.

Underlying scan events, locations, defects, GPS and photos remain immutable. Scan History shows the most recent 500 window records, while the per-item history retains individual movements. Admins can open all photos submitted up to the displayed scan in its window; scanners cannot access these reports or evidence endpoints. Image data is fetched only when opened, not included in scan list responses.

The current checklist includes every unarchived tool/sample unit, even units never scanned, and refreshes every 60 seconds. Closed checklist snapshots become available every 24 hours from the reporting anchor (the earliest existing scan at migration, or installation time if there are no scans). These report times do not reset barcode windows. Snapshots are computed on demand from immutable events and inventory creation/archive times, so no browser session or scheduled job is needed. The selector lists the latest 90 closed snapshots. Historical names reflect current names; pre-migration archive times use the previously recorded update timestamp.

Schema upgrades run transactionally via `ensureInventorySchema` with an advisory lock; `src/lib/scan-windows.ts` creates/backfills the window tables and protects them with RLS. Existing scans and issue references are preserved. New installations run `db/schema.sql` first, then the same application migration on the first inventory request.

### Verification

Run `npm run typecheck`, `npm run build`, and `npm run test:scan-access`. For database integration tests, set `TEST_DATABASE_URL` to a disposable PostgreSQL instance and run `npm run test:scans`. Tests create a uniquely named isolated schema, verify migration/backfill, exact boundaries, independent windows, concurrent retries, current/closed checklists and photo filtering, then remove only that test schema.
