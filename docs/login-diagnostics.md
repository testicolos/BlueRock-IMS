# Login/session diagnostics

## Confirmed regression

The pre-fix `authFailure` recognized only literal UNAUTHORIZED/FORBIDDEN errors. jose's JWTExpired and signature/format failures therefore fell through to serverError (HTTP 500). Browser localStorage restored the invalid token without checking it. Regression test `scripts/test-auth-expiry.ts` reproduced 500 instead of 401 against commit 3e0d74fcf727bf7b82934e933724b29c92b57215.

This is a reproduced code defect, not proof of every reported production login failure. Production runtime logs were not available when investigating. Do not reset account passwords or change JWT_SECRET as a workaround.

## Recovery

- Invalid or expired signed credentials return 401; insufficient permissions remain 403. Missing server secrets remain server failures.
- SessionGate verifies the stored token and current account before mounting protected screens. Invalid saved JSON is repaired from the server. Disabled accounts or changed roles require signing in again.
- Validation runs at startup, after session changes, on expiry, and on resume (throttled), not in a polling loop.
- A network/database failure offers Retry without deleting the valid saved token.
- The dedicated /login page does not import camera/barcode/report components.
- Login does not migrate schema. Its lookup has transaction-local lock and query limits. Failure to update the nonessential last-login timestamp is logged as a warning rather than rejecting valid credentials.
- Scanner Setup loads /api/scanner-setup (only scanners + locations), not the full dashboard payload; saves update one row without reloading all inventory.

## Developer logs

Server traces go to structured console output collected by Vercel Runtime Logs. No new database logging table or public log-reading endpoint is added, so tracing does not depend on the database that may be failing. Access to server logs uses Vercel project permissions.

Search the BlueRock IMS project's Logs for the reference ID shown in an error, or the `x-request-id` response header. When a browser request times out before response headers, use its client reference ID: this matches `clientRequestId` on the server's request.started record.

Traced operations: auth.login, auth.session, app.load, scanner.setup. Other routes' serverError calls emit a safe error reference/category (operation unwrapped_api), but do not have complete per-stage timing until wrapped. Do not claim full-site distributed tracing.

Stages distinguish token.verify, user.lookup, password.verify, token.sign, login.timestamp, schema.inventory, schema.scanner, and each dashboard query. Started records identify a stage interrupted by platform termination. Completed records include HTTP status, total duration and stage durations. Set IMS_TRACE_LEVEL=debug for individual stage completion records; omit it for the default compact completion summaries. The core tracing is enabled by default.

Only safe categories are recorded: expired/invalid session, denied access, database lock/query/connect timeout, unavailable/limited connections, missing schema, permissions, configuration, or unexpected error. Passwords, hashes, tokens, cookies, headers, usernames, full names, database URLs, SQL/parameters, payloads and raw Error stacks/messages are not recorded. Raw server exceptions are not returned in development mode either.

Browser diagnostics store at most 100 sanitized request metadata entries in sessionStorage, with no credentials or form values. The login error screen offers Copy diagnostic log. The diagnostic list contains time, named operation, method, status, duration, reference ID and a coarse category. It is per browser tab, not a server-wide audit history. It is not automatically uploaded to another service.

## Verification

- `node --import tsx scripts/test-auth-expiry.ts`
- `node --experimental-test-module-mocks --import tsx scripts/test-login-tracing.ts` with disposable TEST_DATABASE_URL
- CI installs a pinned Playwright as test-only tooling, starts the production build against a unique loopback test database and runs `node scripts/test-login-browser.mjs`.
- Browser checks cover admin login/dashboard, scanner assignment, admin and scanner logout, My Site, expired tokens, corrupted profiles, failed session service/retry, invalid credentials and diagnostics redaction.
- Existing configured build/type/security/session/workflow/material/sample/report suites continue to run. The already-excluded legacy test:scans suite is NOT counted as passing.

Never run the browser fixture against production: it requires loopback PostgreSQL, creates its own uniquely named database, uses synthetic users, then drops only that database.

## Remaining performance work

Full dashboard pagination, lazy loading of admin modules, targeted refresh for the legacy root screens, query profiling in production and verifying Vercel/database regions remain separate work. Trace timings provide the evidence for prioritizing them after login stability is confirmed.
