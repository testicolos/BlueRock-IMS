# ChatGPT project import: BlueRock-IMS

Imported from the user's personal ChatGPT project on 2026-09-16.

The ChatGPT project contained one design/build conversation and no uploaded project sources. The application source was imported separately from the GitHub repository `testicolos/BlueRock-IMS`.

Sensitive credentials and generated secrets that appeared in the source conversation were intentionally excluded. Rotate any previously shared secrets before relying on them.

## Original request

BlueRock needs an inventory management system split into two operational areas:

1. Tools and equipment tracking.
2. Display sample tracking.

An Android application should scan the barcode attached to a tool or sample. The scanner user selects a managed location, may add condition or issue notes, and submits a scan. Administrators manage locations and scanner users through the web backend. The scanner application requires username/password login.

## Product model

- One shared inventory and movement engine supports both `TOOL` and `SAMPLE` item types.
- Barcode patterns proposed in the design are `BLR-T-000001` and `BLR-S-000001`.
- The database guarantees barcode uniqueness.
- A scan records the item, previous location, new location, scanner identity, condition, notes, and timestamp.
- Scan history is immutable and forms the audit trail.
- Current location is selected from an administrator-managed list, not device GPS.
- Conditions include Good, Minor Issue, Damaged, Missing Parts, and Needs Maintenance.
- Status and condition remain distinct; proposed statuses include Active, Inactive, Maintenance, Lost, and Retired.

## Roles

### Administrator

Administrators manage inventory, locations, categories, users, barcode labels, issues, reports, imports/exports, and audit history.

### Scanner user

Scanner users log in, scan or manually enter barcodes, view item details, select locations and conditions, add notes or report issues, submit scans, and view their recent activity. Scanner users do not receive administrative access.

## Main workflow

1. An administrator creates or imports an item.
2. The system generates a barcode and label.
3. A scanner user logs into the Android application.
4. The user scans the item and receives the server-provided item details.
5. The user selects the new location and current condition, optionally adding an issue note.
6. The backend records an immutable scan, updates current state, creates movement history, and refreshes admin reporting.

## Architecture

- Web/admin and API: Next.js with TypeScript.
- Database: PostgreSQL hosted through Supabase.
- Authentication: username/password with hashed passwords and expiring JWTs.
- Android: Kotlin with Jetpack Compose and Google ML Kit barcode scanning.
- Deployment: Vercel for the web/API.
- Future object storage may hold issue photos.

The intended data flow is Android/browser client → Next.js API → privileged server-side PostgreSQL connection. Clients should not use Supabase anonymous credentials to access IMS tables directly.

## Security context

The imported conversation reports that row-level security was enabled for these tables and that direct access by Supabase `anon` and `authenticated` roles should remain revoked:

- `ims_users`
- `ims_locations`
- `ims_categories`
- `ims_inventory_items`
- `ims_scans`
- `ims_issues`
- `ims_audit_logs`

Verify this state in the live database before assuming it is still true.

## Reported implementation status

The historical conversation reported the following as deployed:

- GitHub/Vercel automatic deployment.
- Database-backed `/api/health` with a successful Supabase connection.
- JWT login.
- Responsive administrator dashboard and KPI cards.
- Tools/Samples filtering and inventory creation.
- Location creation and management.
- Scanner/admin user creation and management.
- Issue queue and resolution action.
- Scan history and movement audit trail.
- Initial administrator setup at `/setup`.

The production URL was reported as `https://bluerock-ims.vercel.app`.

## Planned work from the conversation

- Inventory edit/archive flows.
- Location edit/disable flows.
- User enable/disable flows.
- Category management.
- Barcode generation, bulk generation, and label printing.
- Item detail and complete movement history.
- Search and advanced filters.
- CSV/Excel import and export; PDF reporting.
- Android scanner application with manual entry, issue notes, and recent scans.
- Duplicate-scan protection.
- Offline queueing with idempotent synchronization.
- Optional issue-photo evidence.
- Future checkout/check-in and stock-audit modes.

## API surface described in the project

- `GET /api/health`
- `POST /api/auth/login`
- `POST /api/setup/bootstrap`
- `GET/POST /api/locations`
- `PATCH/DELETE /api/locations/:id`
- `GET/POST /api/users`
- `PATCH /api/users/:id`
- `GET/POST /api/inventory`
- `GET/PATCH/DELETE /api/inventory/:id`
- `GET/POST /api/scans`
- `GET/POST /api/issues`

Treat this list as imported context and verify it against the repository before implementing or documenting APIs.
