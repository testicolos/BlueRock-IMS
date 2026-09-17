import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { mock } from 'node:test';
import postgres from 'postgres';
import { NextRequest } from 'next/server';
import { createToken } from '../src/lib/auth';

async function main() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('Set TEST_DATABASE_URL to a disposable PostgreSQL test database');
  const schemaName = `ims_scanner_test_${randomUUID().replaceAll('-', '')}`;
  const local = ['localhost', '127.0.0.1', '::1'].includes(new URL(url).hostname);
  const options = { ssl: local ? false as const : 'require' as const, prepare: false, onnotice: () => {} };
  const control = postgres(url, { ...options, max: 1 });
  const sql = postgres(url, { ...options, max: 5, connection: { search_path: schemaName } });
  process.env.JWT_SECRET = randomUUID() + randomUUID();
  try {
    await control`create schema ${control(schemaName)}`;
    const schema = (await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8')).replace(/^create extension[^\n]*\n/m, '');
    await sql.unsafe(schema);

    const [admin] = await sql`insert into ims_users(username,password_hash,full_name,role) values('scanner-admin','test','Scanner Admin','ADMIN') returning id`;
    const [scanner] = await sql`insert into ims_users(username,password_hash,full_name,role) values('scanner-one','test','Scanner One','SCANNER') returning id`;
    const [otherScanner] = await sql`insert into ims_users(username,password_hash,full_name,role) values('scanner-two','test','Scanner Two','SCANNER') returning id`;
    const [source] = await sql`insert into ims_locations(name,code) values('Source Site','SOURCE') returning id`;
    const [destination] = await sql`insert into ims_locations(name,code) values('Destination Site','DEST') returning id`;
    const [item] = await sql`insert into ims_inventory_items(barcode,inventory_type,name,current_location_id) values('TL-SCANNER-0001','TOOL','Scanner test tool',${source.id}) returning id,barcode`;

    const adminToken = await createToken({ id: admin.id, username: 'scanner-admin', fullName: 'Scanner Admin', role: 'ADMIN' });
    const scannerToken = await createToken({ id: scanner.id, username: 'scanner-one', fullName: 'Scanner One', role: 'SCANNER' });
    const otherToken = await createToken({ id: otherScanner.id, username: 'scanner-two', fullName: 'Scanner Two', role: 'SCANNER' });

    mock.module(new URL('../src/lib/db.ts', import.meta.url).href, { namedExports: { db: () => sql } });
    const users = await import('../src/app/api/users/route');
    const user = await import('../src/app/api/users/[id]/route');
    const site = await import('../src/app/api/scanner-site/route');
    const transfers = await import('../src/app/api/location-transfers/[id]/route');

    const request = (method: string, body: unknown, token: string, path: string) => new NextRequest(`https://test.invalid/api/${path}`, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    assert.equal((await users.GET(request('GET', undefined, scannerToken, 'users'))).status, 403);
    const adminUsers = await users.GET(request('GET', undefined, adminToken, 'users'));
    assert.equal(adminUsers.status, 200);
    assert.ok((await adminUsers.json()).data.some((row: { id: string }) => row.id === scanner.id));
    console.log('PASS: Scanner Setup user list is admin-only and loads scanners');

    const assigned = await user.PATCH(request('PATCH', { assignedLocationId: destination.id }, adminToken, `users/${scanner.id}`), { params: Promise.resolve({ id: scanner.id }) });
    assert.equal(assigned.status, 200);
    assert.equal((await assigned.json()).data.assigned_location_id, destination.id);
    console.log('PASS: administrator can bind a scanner to an active location');

    const initialSite = await site.GET(request('GET', undefined, scannerToken, 'scanner-site'));
    assert.equal(initialSite.status, 200);
    const initialSiteData = (await initialSite.json()).data;
    assert.equal(initialSiteData.assignedLocation.id, destination.id);
    assert.equal(initialSiteData.materials.length, 0);
    console.log('PASS: My Site resolves the scanner assignment');

    const [transfer] = await sql`
      insert into ims_location_transfers(inventory_item_id,from_location_id,destination_location_id,requested_by)
      values(${item.id},${source.id},${destination.id},${scanner.id}) returning id
    `;
    const siteWithTransfer = await site.GET(request('GET', undefined, scannerToken, 'scanner-site'));
    const siteWithTransferData = (await siteWithTransfer.json()).data;
    assert.equal(siteWithTransferData.incomingTransfers.length, 1);
    assert.equal(siteWithTransferData.incomingTransfers[0].id, transfer.id);
    console.log('PASS: destination scanner sees incoming transfer requests');

    const forbidden = await transfers.POST(request('POST', { action: 'APPROVE' }, otherToken, `location-transfers/${transfer.id}`), { params: Promise.resolve({ id: transfer.id }) });
    assert.equal(forbidden.status, 403);
    const approved = await transfers.POST(request('POST', { action: 'APPROVE' }, scannerToken, `location-transfers/${transfer.id}`), { params: Promise.resolve({ id: transfer.id }) });
    assert.equal(approved.status, 200);
    assert.equal((await approved.json()).data.status, 'APPROVED');

    const [moved] = await sql`select current_location_id from ims_inventory_items where id=${item.id}`;
    assert.equal(moved.current_location_id, destination.id);
    const finalSite = await site.GET(request('GET', undefined, scannerToken, 'scanner-site'));
    const finalSiteData = (await finalSite.json()).data;
    assert.equal(finalSiteData.incomingTransfers.length, 0);
    assert.ok(finalSiteData.materials.some((row: { id: string }) => row.id === item.id));
    console.log('PASS: only the destination scanner can approve and approval moves the item onto My Site');

    const markers = await sql`select version from ims_schema_migrations where version='2026-09-17-scanner-location-transfers-v1'`;
    assert.equal(markers.length, 1);
    console.log('PASS: scanner schema migration is recorded and does not need repeated DDL');
  } finally {
    await sql.end();
    await control`drop schema if exists ${control(schemaName)} cascade`;
    await control.end();
  }
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
