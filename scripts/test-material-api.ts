import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { mock } from 'node:test';
import { NextRequest } from 'next/server';
import postgres from 'postgres';

import { createToken } from '../src/lib/auth';

// Run with: node --experimental-test-module-mocks --import tsx scripts/test-material-api.ts
// The database connector alone is replaced with an isolated test-schema client.
// Actual route handlers, authentication, validation, migrations and SQL are used.
async function main() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('Set TEST_DATABASE_URL to a disposable PostgreSQL test database');
  const schemaName = `ims_material_api_test_${randomUUID().replaceAll('-', '')}`;
  const local = ['localhost', '127.0.0.1', '::1'].includes(new URL(url).hostname);
  const options = { ssl: local ? false as const : 'require' as const, prepare: false, onnotice: () => {} };
  const control = postgres(url, { ...options, max: 1 });
  const sql = postgres(url, { ...options, max: 5, connection: { search_path: schemaName } });
  const originalSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = randomUUID() + randomUUID();

  try {
    await control`create schema ${control(schemaName)}`;
    assert.equal((await sql`select current_schema() as name`)[0].name, schemaName);
    const baseSchema = (await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8')).replace(/^create extension[^\n]*\n/m, '');
    await sql.unsafe(baseSchema);
    const [actor] = await sql`insert into ims_users(username,password_hash,full_name,role) values('admin','test-only','Test Admin','ADMIN') returning id`;
    const [scanner] = await sql`insert into ims_users(username,password_hash,full_name,role) values('scanner','test-only','Test Scanner','SCANNER') returning id`;
    const [location] = await sql`insert into ims_locations(name,code) values('Test location','TEST') returning id`;
    const token = await createToken({ id: actor.id, username: 'admin', fullName: 'Test Admin', role: 'ADMIN' });
    const scannerToken = await createToken({ id: scanner.id, username: 'scanner', fullName: 'Test Scanner', role: 'SCANNER' });

    mock.module(new URL('../src/lib/db.ts', import.meta.url).href, { namedExports: { db: () => sql } });
    const materials = await import('../src/app/api/materials/route');
    const material = await import('../src/app/api/materials/[id]/route');
    const units = await import('../src/app/api/materials/[id]/units/route');

    function request(method: string, body: unknown, auth: string | null = token) {
      return new NextRequest('https://test.invalid/api/materials', {
        method, headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    }
    function params(id: string) { return { params: Promise.resolve({ id }) }; }
    const sample = { name: 'Stone sample', code: 'STONE', inventoryType: 'SAMPLE', quantity: 2 };

    assert.equal((await materials.POST(request('POST', { ...sample, customerName: 'Acme' }, null))).status, 401);
    assert.equal((await materials.POST(request('POST', { ...sample, customerName: 'Acme' }, scannerToken))).status, 403);
    for (const body of [sample, { ...sample, customerName: ' ', employeeName: ' ' }, { ...sample, customerName: 'Acme', allocations: [{ locationId: location.id, count: 2 }] }]) {
      assert.equal((await materials.POST(request('POST', body))).status, 400);
    }
    assert.equal((await sql`select count(*)::int as count from ims_materials`)[0].count, 0);
    console.log('PASS: actual create API rejects unauthenticated/scanner callers and invalid sample assignments without writes');

    const response = await materials.POST(request('POST', { ...sample, customerName: ' Acme ' }));
    assert.equal(response.status, 201);
    const created = (await response.json()).data;
    assert.equal(created.customer_name, 'Acme');
    assert.equal(created.employee_name, null);
    assert.equal(created.unitsCreated, 2);
    assert.deepEqual((await sql`select barcode,current_location_id from ims_inventory_items where material_id=${created.id} order by unit_number`).map(row => ({ ...row })), [
      { barcode: 'SP-STONE-0001', current_location_id: null }, { barcode: 'SP-STONE-0002', current_location_id: null },
    ]);
    const employeeResponse = await materials.POST(request('POST', { ...sample, code: 'EMPLOYEE', employeeName: ' Sara ' }));
    assert.equal(employeeResponse.status, 201);
    const bothResponse = await materials.POST(request('POST', { ...sample, code: 'BOTH', employeeName: 'Sara', customerName: 'Acme' }));
    assert.equal(bothResponse.status, 201);
    console.log('PASS: actual create API persists customer-only, employee-only and both, with unique SP barcodes and null locations');

    assert.equal((await material.PATCH(request('PATCH', { customerName: ' ' }), params(created.id))).status, 400);
    assert.equal((await material.PATCH(request('PATCH', { employeeName: ' Sara ' }), params(created.id))).status, 200);
    assert.equal((await material.PATCH(request('PATCH', { customerName: null }), params(created.id))).status, 200);
    assert.equal((await material.PATCH(request('PATCH', { employeeName: null }), params(created.id))).status, 400);
    assert.equal((await material.PATCH(request('PATCH', { name: 'Renamed stone sample' }), params(created.id))).status, 200);
    const [edited] = await sql`select customer_name,employee_name from ims_materials where id=${created.id}`;
    assert.equal(edited.customer_name, null);
    assert.equal(edited.employee_name, 'Sara');
    assert.equal((await sql`select count(*)::int as count from ims_inventory_items where material_id=${created.id} and name='Renamed stone sample'`)[0].count, 2);
    console.log('PASS: actual edit API merges assignments, updates unit names and prevents clearing the last assignee');

    assert.equal((await units.POST(request('POST', { quantity: 1, locationId: location.id }), params(created.id))).status, 400);
    const generated = await units.POST(request('POST', { quantity: 2 }), params(created.id));
    assert.equal(generated.status, 201);
    assert.deepEqual((await generated.json()).data.barcodes, ['SP-STONE-0003', 'SP-STONE-0004']);
    assert.equal((await sql`select count(*)::int as count from ims_inventory_items where material_id=${created.id} and current_location_id is not null`)[0].count, 0);
    const [legacy] = await sql`insert into ims_materials(inventory_type,name,code) values('SAMPLE','Legacy unassigned','LEGACY') returning id`;
    assert.equal((await units.POST(request('POST', { quantity: 1 }), params(legacy.id))).status, 400);
    console.log('PASS: actual generate API uses the sample assignment and next SP sequence, rejects locations and unassigned legacy samples');

    const toolResponse = await materials.POST(request('POST', { name: 'Ladder', code: 'LAD', inventoryType: 'TOOL', customerName: 'Do not persist', allocations: [{ locationId: location.id, count: 2 }] }));
    assert.equal(toolResponse.status, 201);
    const tool = (await toolResponse.json()).data;
    assert.equal(tool.customer_name, null);
    assert.equal(tool.employee_name, null);
    assert.equal((await units.POST(request('POST', { quantity: 1 }), params(tool.id))).status, 400);
    assert.equal((await units.POST(request('POST', { quantity: 1, locationId: location.id }), params(tool.id))).status, 201);
    assert.equal((await sql`select count(*)::int as count from ims_inventory_items where material_id=${tool.id} and current_location_id=${location.id}`)[0].count, 3);
    assert.equal((await material.PATCH(request('PATCH', { customerName: 'Not persisted', employeeName: 'Not persisted' }), params(tool.id))).status, 200);
    assert.equal((await sql`select customer_name from ims_materials where id=${tool.id}`)[0].customer_name, null);
    console.log('PASS: actual tool APIs retain location-based creation/generation and ignore sample-only assignments');

    const both = (await bothResponse.json()).data;
    const concurrent = await Promise.all([
      material.PATCH(request('PATCH', { customerName: null }), params(both.id)),
      material.PATCH(request('PATCH', { employeeName: null }), params(both.id)),
    ]);
    assert.deepEqual(concurrent.map(result => result.status).sort(), [200, 400]);
    const concurrentUnits = await Promise.all([
      units.POST(request('POST', { quantity: 2 }), params(created.id)),
      units.POST(request('POST', { quantity: 2 }), params(created.id)),
    ]);
    assert.deepEqual(concurrentUnits.map(result => result.status), [201, 201]);
    assert.equal((await sql`select count(distinct barcode)::int as count from ims_inventory_items where material_id=${created.id}`)[0].count, 8);
    console.log('PASS: concurrent edits cannot remove both assignees and concurrent unit batches keep unique sequential barcodes');

    const list = await materials.GET(request('GET', undefined));
    assert.equal(list.status, 200);
    assert.equal((await list.json()).data.find((row: { id: string }) => row.id === created.id).employee_name, 'Sara');
    assert.equal((await units.POST(request('POST', { quantity: 1 }, scannerToken), params(created.id))).status, 403);
    assert.equal((await material.PATCH(request('PATCH', { employeeName: 'Other' }, scannerToken), params(created.id))).status, 403);
    console.log('PASS: admin list exposes assignments and scanner users cannot edit or generate sample units');
  } finally {
    mock.restoreAll();
    if (originalSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = originalSecret;
    await sql.end();
    await control`drop schema if exists ${control(schemaName)} cascade`;
    await control.end();
  }
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
