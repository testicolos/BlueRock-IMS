# Display sample assignments and reports

In **Materials & Units → Add material**, selecting **Display Sample** replaces
location allocations with **Customer**, **Employee**, and **Quantity**. At least
one trimmed customer or employee name is required; both are allowed. Each unit
receives a unique `SP-<CODE>-<NUMBER>` barcode and no initial managed location.
Tools and equipment continue using quantities by location.

Assignments belong to the sample material group and apply to every unit in it.
They can be changed in **Edit sample**. Additional barcode units inherit the
group assignment. Existing samples without an assignment remain visible; add a
customer or employee when editing them or before generating additional units.
Existing locations, barcodes, scans, and movement history are not rewritten.
The shared Scan Unit workflow and its managed-location capture remain unchanged.

Administrators have separate **Materials Report** and **Samples Report** pages.
Both use the same per-barcode rolling 24-hour windows, 30 completed days of daily
history, photo evidence, and daily/monthly Excel exports. Samples reports include
Customer and Employee instead of Location. Dates and times use Qatar/Saudi time
(UTC+3). Historical scan status and evidence use the report cutoff; customer,
employee, and other names use their current labels, not assignment snapshots.

The checklist and export APIs accept `inventoryType=TOOL` or `inventoryType=SAMPLE`.
Omitting the selector preserves the previous combined API response. Invalid or
duplicate selectors return 400. Both reports and exports remain admin-only.

## Verification

Run `npm run test:sample-assignments` for validation tests. With
`TEST_DATABASE_URL` pointed at a disposable PostgreSQL database, this command
also verifies migration from an existing installation and preservation of its
history. `npm run test:material-api` exercises the actual API handlers against
isolated schemas in that database, including concurrent updates and generation.
Never use the production `DATABASE_URL` for these tests.

`npm run test:scans`, `npm run test:report-xlsx`, and `npm run test:navigation`
cover sample/material report separation, scan-window parity, export formatting,
access control, and refresh/navigation restoration.
