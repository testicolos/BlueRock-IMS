import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';

import { migrateInventorySchema } from '../src/lib/inventory-schema';
import {
  createMaterialSchema, generateMaterialUnitsSchema, materialAllocations,
  materialAssignment, materialUnitLocation, patchMaterialSchema,
} from '../src/lib/material-validation';
import { scanWindowMigration } from '../src/lib/scan-windows';

async function main() {
  const locationId = randomUUID();
  const sample = { name: 'Stone sample', code: 'STONE', inventoryType: 'SAMPLE', quantity: 2 };
  for (const assignment of [{ customerName: ' Acme ' }, { employeeName: ' Sara ' }, { customerName: 'Acme', employeeName: 'Sara' }]) {
    const parsed = createMaterialSchema.parse({ ...sample, ...assignment });
    const resolved = materialAssignment(parsed.inventoryType, parsed);
    assert.ok(resolved.customerName || resolved.employeeName);
    assert.equal(resolved.customerName, assignment.customerName?.trim() || null);
    assert.equal(resolved.employeeName, assignment.employeeName?.trim() || null);
    assert.deepEqual(materialAllocations(parsed), [{ locationId: null, count: 2 }]);
  }
  console.log('PASS: samples accept customer-only, employee-only, or both, trim names and create location-free quantities');

  for (const assignment of [{}, { customerName: '', employeeName: '' }, { customerName: ' \t\n', employeeName: ' ' }]) {
    assert.equal(createMaterialSchema.safeParse({ ...sample, ...assignment }).success, false);
  }
  assert.equal(createMaterialSchema.safeParse({ ...sample, customerName: 'X'.repeat(161) }).success, false);
  assert.equal(createMaterialSchema.safeParse({ ...sample, employeeName: 'X'.repeat(161) }).success, false);
  assert.equal(createMaterialSchema.safeParse({ ...sample, customerName: 'Acme', allocations: [{ locationId, count: 2 }] }).success, false);
  for (const quantity of [undefined, 0, -1, 1001, 1.5, '2']) {
    assert.equal(createMaterialSchema.safeParse({ ...sample, customerName: 'Acme', quantity }).success, false);
  }
  console.log('PASS: missing/blank assignments, oversized names, location allocations and invalid quantities are rejected');

  const current = { customer_name: 'Acme', employee_name: 'Sara' };
  assert.deepEqual(materialAssignment('SAMPLE', patchMaterialSchema.parse({ customerName: ' ' }), current), { customerName: null, employeeName: 'Sara' });
  assert.deepEqual(materialAssignment('SAMPLE', patchMaterialSchema.parse({ employeeName: null }), current), { customerName: 'Acme', employeeName: null });
  assert.deepEqual(materialAssignment('SAMPLE', patchMaterialSchema.parse({ name: 'Renamed' }), current), { customerName: 'Acme', employeeName: 'Sara' });
  assert.throws(() => materialAssignment('SAMPLE', { customerName: '', employeeName: null }, current), /SAMPLE_ASSIGNMENT_REQUIRED/);
  assert.throws(() => materialAssignment('SAMPLE', { customerName: null }, { customer_name: 'Acme' }), /SAMPLE_ASSIGNMENT_REQUIRED/);
  assert.throws(() => materialAssignment('SAMPLE', {}, {}), /SAMPLE_ASSIGNMENT_REQUIRED/);
  assert.deepEqual(materialAssignment('SAMPLE', { employeeName: ' Sara ' }, {}), { customerName: null, employeeName: 'Sara' });
  console.log('PASS: partial sample edits preserve untouched assignments and cannot clear the last assignee');

  const tool = createMaterialSchema.parse({ name: 'Ladder', code: 'LAD', inventoryType: 'TOOL', customerName: 'Not persisted', allocations: [{ locationId, count: 3 }] });
  assert.deepEqual(materialAllocations(tool), [{ locationId, count: 3 }]);
  assert.deepEqual(materialAssignment('TOOL', tool), { customerName: null, employeeName: null });
  assert.deepEqual(materialAssignment('TOOL', {}, current), { customerName: null, employeeName: null });
  assert.equal(createMaterialSchema.safeParse({ name: 'Ladder', code: 'LAD', inventoryType: 'TOOL' }).success, true);
  console.log('PASS: material location allocations remain unchanged and customer/employee fields cannot persist for tools');

  assert.deepEqual(generateMaterialUnitsSchema.parse({ quantity: 3 }), { quantity: 3 });
  assert.equal(materialUnitLocation('SAMPLE'), null);
  assert.equal(materialUnitLocation('SAMPLE', null), null);
  assert.throws(() => materialUnitLocation('SAMPLE', locationId), /SAMPLE_LOCATION_NOT_ALLOWED/);
  assert.equal(materialUnitLocation('TOOL', locationId), locationId);
  assert.throws(() => materialUnitLocation('TOOL'), /TOOL_LOCATION_REQUIRED/);
  for (const quantity of [0, -1, 1001, 1.5]) assert.equal(generateMaterialUnitsSchema.safeParse({ quantity }).success, false);
  console.log('PASS: generated sample units have no location; generated tool units still require a location');

  if (process.env.TEST_DATABASE_URL) await testMigration(process.env.TEST_DATABASE_URL);
  else console.log('NOTE: set TEST_DATABASE_URL for the disposable-schema migration regression test');
}

async function testMigration(url: string) {
  // Every object and destructive cleanup statement is confined to this fresh
  // schema. Never use the application's DATABASE_URL for this test.
  const schemaName = `ims_sample_test_${randomUUID().replaceAll('-', '')}`;
  const local = ['localhost', '127.0.0.1', '::1'].includes(new URL(url).hostname);
  const options = { ssl: local ? false as const : 'require' as const, prepare: false, onnotice: () => {} };
  const control = postgres(url, { ...options, max: 1 });
  const statements: string[] = [];
  const sql = postgres(url, { ...options, max: 1, connection: { search_path: schemaName }, debug: (_connection, statement) => { statements.push(statement); } });
  const blocker = postgres(url, { ...options, max: 1, connection: { search_path: schemaName } });
  const freshSchemaName = `ims_sample_fresh_test_${randomUUID().replaceAll('-', '')}`;
  const fresh = postgres(url, { ...options, max: 1, connection: { search_path: freshSchemaName } });
  try {
    await control`create schema ${control(schemaName)}`;
    assert.equal((await sql`select current_schema() as name`)[0].name, schemaName);
    const oldSchema = (await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8'))
      .replace(/^create extension[^\n]*\n/m, '')
      .replace(/^  (customer_name|employee_name) varchar\(160\),\r?\n/gm, '');
    await sql.unsafe(oldSchema);
    const [actor] = await sql`insert into ims_users(username,password_hash,full_name,role) values('admin','test-only','Test Admin','ADMIN') returning id`;
    const [location] = await sql`insert into ims_locations(name,code) values('Old location','OLD') returning id`;
    const [material] = await sql`insert into ims_materials(inventory_type,name,code) values('SAMPLE','Existing sample','LEGACY') returning id`;
    const [unit] = await sql`insert into ims_inventory_items(barcode,inventory_type,name,material_id,unit_number,current_location_id)
      values('SP-LEGACY-0001','SAMPLE','Existing sample',${material.id},1,${location.id}) returning *`;
    const [scan] = await sql`insert into ims_scans(inventory_item_id,barcode,new_location_id,scanner_user_id,condition,client_transaction_id)
      values(${unit.id},${unit.barcode},${location.id},${actor.id},'GOOD',${randomUUID()}) returning *`;
    await sql.begin(tx => tx.unsafe(scanWindowMigration));
    await sql`create table ims_schema_migrations (version text primary key,applied_at timestamptz not null default now())`;
    await sql`insert into ims_schema_migrations(version) values('2026-09-17-rolling-scans-v1')`;
    const before = (await sql`select * from ims_scans where id=${scan.id}`)[0];

    await migrateInventorySchema(sql);
    await migrateInventorySchema(sql);
    const columns = await sql`select column_name from information_schema.columns where table_schema=${schemaName} and table_name='ims_materials' and column_name in ('customer_name','employee_name') order by column_name`;
    assert.deepEqual(columns.map(row => row.column_name), ['customer_name', 'employee_name']);
    const [unchanged] = await sql`select customer_name,employee_name from ims_materials where id=${material.id}`;
    assert.equal(unchanged.customer_name, null);
    assert.equal(unchanged.employee_name, null);
    assert.deepEqual((await sql`select * from ims_scans where id=${scan.id}`)[0], before);
    assert.equal((await sql`select current_location_id from ims_inventory_items where id=${unit.id}`)[0].current_location_id, location.id);
    assert.equal((await sql`select count(*)::int as count from ims_schema_migrations where version='2026-09-17-sample-assignments-v1'`)[0].count, 1);
    assert.equal((await sql`select relrowsecurity from pg_class where oid='ims_materials'::regclass`)[0].relrowsecurity, true);
    console.log('PASS: migration upgrades an already-migrated database exactly once, preserves legacy sample history/locations and enforces material RLS');

    await blocker.begin(async tx => {
      // Read locks conflict with ALTER TABLE's exclusive lock, but not the new
      // fast-path SELECT. A held advisory lock must not affect applied schemas.
      await tx`lock table ims_schema_migrations in access share mode`;
      await tx`select pg_advisory_xact_lock(78243190)`;
      const start = Date.now();
      const startIndex = statements.length;
      await migrateInventorySchema(sql);
      assert.ok(Date.now() - start < 3000, 'An applied schema should not wait for migration locks');
      const fastPath = statements.slice(startIndex).map(statement => statement.trim().toLowerCase());
      assert.ok(fastPath.length >= 2);
      assert.ok(fastPath.every(statement => /^(select|set local|begin read only|commit)/.test(statement)), 'Applied fast path must use a bounded read-only transaction without DDL');
    });
    console.log('PASS: applied-schema fast path is read-only and bypasses both exclusive metadata DDL and migration advisory locks');

    await blocker.begin(async tx => {
      await tx`lock table ims_schema_migrations in access exclusive mode`;
      const start = Date.now();
      await assert.rejects(migrateInventorySchema(sql), (error: unknown) => error instanceof postgres.PostgresError && error.code === '55P03');
      assert.ok(Date.now() - start < 10_000, 'Even the marker read must fail after its 5-second lock timeout');
    });
    console.log('PASS: read-only preflight also times out safely behind an exclusive registry lock');

    await sql`delete from ims_schema_migrations where version='2026-09-17-sample-assignments-v1'`;
    await blocker.begin(async tx => {
      await tx`lock table ims_materials in access share mode`;
      const start = Date.now();
      await assert.rejects(migrateInventorySchema(sql), (error: unknown) => error instanceof postgres.PostgresError && error.code === '55P03');
      assert.ok(Date.now() - start < 10_000, 'Contended migration should fail after its 5-second lock timeout');
    });
    assert.equal((await sql`select count(*)::int as count from ims_schema_migrations where version='2026-09-17-sample-assignments-v1'`)[0].count, 0);
    assert.equal((await sql`show lock_timeout`)[0].lock_timeout, '0');
    assert.equal((await sql`show statement_timeout`)[0].statement_timeout, '0');
    assert.equal((await sql`show idle_in_transaction_session_timeout`)[0].idle_in_transaction_session_timeout, '0');
    await migrateInventorySchema(sql);
    assert.equal((await sql`select count(*)::int as count from ims_schema_migrations`)[0].count, 3);
    assert.deepEqual((await sql`select * from ims_scans where id=${scan.id}`)[0], before);
    console.log('PASS: contended DDL rolls back within the lock timeout, leaves no session settings, and safely retries after release');

    await control`create schema ${control(freshSchemaName)}`;
    await fresh.unsafe(oldSchema);
    assert.equal((await fresh`select current_schema() as name`)[0].name, freshSchemaName);
    assert.equal((await fresh`select to_regclass('ims_schema_migrations') as registry`)[0].registry, null);
    await migrateInventorySchema(fresh);
    assert.equal((await fresh`select count(*)::int as count from ims_schema_migrations`)[0].count, 3);
    assert.equal((await fresh`select count(*)::int as count from information_schema.columns where table_schema=${freshSchemaName} and table_name='ims_materials' and column_name in ('customer_name','employee_name')`)[0].count, 2);
    assert.equal((await fresh`select relrowsecurity from pg_class where oid='ims_schema_migrations'::regclass`)[0].relrowsecurity, true);
    console.log('PASS: missing-registry fresh schema migrates both versions using its own search_path, without relying on public');
  } finally {
    await blocker.end();
    await fresh.end();
    await sql.end();
    await control`drop schema if exists ${control(freshSchemaName)} cascade`;
    await control`drop schema if exists ${control(schemaName)} cascade`;
    await control.end();
  }
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
