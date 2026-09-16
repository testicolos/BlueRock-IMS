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
- `GET/POST /api/issues`

The Android app will use the login, locations, inventory lookup and scans endpoints.
