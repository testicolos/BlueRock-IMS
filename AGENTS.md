# BlueRock IMS project guidance

Read `docs/chatgpt-project-import.md` before making product or architecture changes.

## Core invariants

- BlueRock IMS has two inventory domains: Tools & Equipment and Display Samples.
- Both domains share one barcode, location, issue, and movement-history engine.
- Each item has one current barcode, location, condition, and status, with unlimited immutable historical movements.
- The backend is the source of truth for current location and movement history; clients must not construct history themselves.
- Locations are managed by administrators and loaded dynamically by scanner clients.
- Administrators and scanner users have separate permissions.
- Passwords must remain hashed. Credentials, database URLs, bootstrap secrets, and JWT secrets must never be committed.
- Browser and Android clients communicate through the Next.js API; they must not connect directly to Supabase tables.
- Preserve row-level security and deny direct `anon`/`authenticated` access to IMS tables unless a future architecture explicitly introduces reviewed policies.
- Historical scans, issue notes, and audit records must not be overwritten.

## Current delivery state

- Repository: `testicolos/BlueRock-IMS`
- Production: `https://bluerock-ims.vercel.app`
- Stack: Next.js 16, TypeScript, PostgreSQL/Supabase, JWT, Zod, Vercel
- Reported live: database-backed health check, authentication, responsive admin dashboard, inventory filters and creation, location and user management, issues, scan history, audit trail, and initial-admin setup.
- Planned depth includes inventory edit/archive, location edit/disable, user enable/disable, categories, barcode generation/printing, item history, stronger search/filtering, reports/import/export, Android scanner, and offline synchronization.

## Working practices

- Keep `.env*` secrets out of version control.
- Run type checking and a production build after application changes.
- Treat production claims in imported chat history as historical context; verify live behavior before relying on them.
