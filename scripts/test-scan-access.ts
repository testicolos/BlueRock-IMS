import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { createToken } from '../src/lib/auth';
import { GET as checklist } from '../src/app/api/scans/checklist/route';
import { GET as evidence } from '../src/app/api/scans/[id]/evidence/route';
import { GET as history } from '../src/app/api/scans/route';

async function main() {
  // No database connection: access must be rejected before schema/data access.
  process.env.JWT_SECRET = randomUUID() + randomUUID();
  delete process.env.DATABASE_URL;
  const token = await createToken({ id: randomUUID(), username:'test-scanner',fullName:'Test scanner',role:'SCANNER' });
  const id = randomUUID();
  const routes = [
    (request: NextRequest) => checklist(request),
    (request: NextRequest) => history(request),
    (request: NextRequest) => evidence(request, {params:Promise.resolve({id})}),
  ];
  for (const route of routes) {
    assert.equal((await route(new NextRequest('http://localhost/api/scans'))).status,401);
    const response = await route(new NextRequest('http://localhost/api/scans',{headers:{Authorization:`Bearer ${token}`}}));
    assert.equal(response.status,403);
    const body = await response.json();
    assert.equal(body.success,false);
    assert.equal(body.data,undefined);
  }
  console.log('PASS: scan history, checklist and photo endpoints reject anonymous and scanner users before database access.');
}
void main().catch(error => { console.error(error); process.exitCode=1; });
