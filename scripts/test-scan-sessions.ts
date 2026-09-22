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
  const schemaName = `ims_session_test_${randomUUID().replaceAll('-', '')}`;
  const local = ['localhost', '127.0.0.1', '::1'].includes(new URL(url).hostname);
  const options = { ssl: local ? false as const : 'require' as const, prepare: false, onnotice: () => {} };
  const control = postgres(url, { ...options, max: 1 });
  const sql = postgres(url, { ...options, max: 5, connection: { search_path: schemaName } });
  process.env.JWT_SECRET = randomUUID() + randomUUID();
  try {
    await control`create schema ${control(schemaName)}`;
    const schema = (await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8')).replace(/^create extension[^\n]*\n/m, '');
    await sql.unsafe(schema);
    const [admin] = await sql`insert into ims_users(username,password_hash,full_name,role) values('session-admin','test','Session Admin','ADMIN') returning id`;
    const [scanner] = await sql`insert into ims_users(username,password_hash,full_name,role) values('session-scanner','test','Session Scanner','SCANNER') returning id`;
    const [location] = await sql`insert into ims_locations(name,code) values('Session location','SESSION') returning id`;
    const [tool] = await sql`insert into ims_inventory_items(barcode,inventory_type,name,current_location_id) values('TL-SESSION-0001','TOOL','Session tool',${location.id}) returning id,barcode,inventory_type`;
    const adminToken = await createToken({ id: admin.id, username: 'session-admin', fullName: 'Session Admin', role: 'ADMIN' });
    const scannerToken = await createToken({ id: scanner.id, username: 'session-scanner', fullName: 'Session Scanner', role: 'SCANNER' });
    mock.module(new URL('../src/lib/db.ts', import.meta.url).href, { namedExports: { db: () => sql } });
    const sessions = await import('../src/app/api/scan-sessions/route');
    const validate = await import('../src/app/api/scans/validate/route');
    const scans = await import('../src/app/api/scans/route');
    const issues = await import('../src/app/api/issues/route');
    const checklist = await import('../src/app/api/scans/checklist/route');
    const officeInventory = await import('../src/app/api/office-inventory/route');
    const officeSessions = await import('../src/app/api/office-validation-sessions/route');
    const officeValidate = await import('../src/app/api/office-validation/validate/route');
    const officeScan = await import('../src/app/api/office-validation/scan/route');
    const request = (method: string, body: unknown, token = adminToken, path = 'scan-sessions') => new NextRequest(`https://test.invalid/api/${path}`, {
      method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    assert.equal((await sessions.POST(request('POST', { inventoryType: 'TOOL' }, scannerToken))).status, 403);
    const started = await sessions.POST(request('POST', { inventoryType: 'TOOL' }));
    assert.equal(started.status, 201);
    const first = (await started.json()).data;
    assert.equal(first.session.inventory_type, 'TOOL');
    const again = await sessions.POST(request('POST', { inventoryType: 'TOOL' }));
    assert.equal(again.status, 200);
    assert.equal((await again.json()).data.session.id, first.session.id);
    assert.equal((await sessions.GET(request('GET', undefined, scannerToken))).status, 200);
    const scannerSessions = await sessions.GET(request('GET', undefined, scannerToken));
    assert.equal((await scannerSessions.json()).data.length, 1);
    console.log('PASS: only administrators can start sessions and repeated starts reuse the active checklist');

    const now = new Date().toISOString();
    const validation = await validate.POST(request('POST', { barcode: tool.barcode, sessionId: first.session.id, captureMethod: 'CAMERA', latitude: 25.1, longitude: 51.2, capturedAt: now }, scannerToken, 'scans/validate'));
    assert.equal(validation.status, 200);
    const attempt = (await validation.json()).data;
    assert.equal(attempt.matched, true);
    assert.equal((await checklist.GET(request('GET', undefined, adminToken, 'scans/checklist?inventoryType=TOOL'))).status, 200);

    const preservedConditionScan = await scans.POST(request('POST', {
      barcode: tool.barcode, locationId: location.id, condition: 'MISSING_PARTS', reportIssue: false,
      validationAttemptId: attempt.attemptId, captureMethod: 'CAMERA', sessionId: first.session.id,
      latitude: 25.1, longitude: 51.2, capturedAt: now,
    }, scannerToken, 'scans'));
    assert.equal(preservedConditionScan.status, 201);
    const [preservedItem] = await sql`select condition from ims_inventory_items where id=${tool.id}`;
    assert.equal(preservedItem.condition, 'GOOD');
    console.log('PASS: scanner-supplied condition is ignored for normal Materials / Samples scans');

    const defectBase = {
      barcode: tool.barcode, locationId: location.id, condition: 'GOOD', reportIssue: true,
      issueType: 'Cracked housing', notes: 'Visible crack reported during scan',
      validationAttemptId: attempt.attemptId, captureMethod: 'CAMERA' as const, sessionId: first.session.id,
      latitude: 25.1, longitude: 51.2, capturedAt: now,
    };
    const missingDefectPhoto = await scans.POST(request('POST', defectBase, scannerToken, 'scans'));
    assert.equal(missingDefectPhoto.status, 400);
    const issueImageUrl = 'data:image/jpeg;base64,AA==';
    const savedDefect = await scans.POST(request('POST', { ...defectBase, issueImageUrl }, scannerToken, 'scans'));
    assert.equal(savedDefect.status, 201);
    const savedDefectBody = await savedDefect.json();
    assert.ok(savedDefectBody.data.issue?.id);
    assert.equal(savedDefectBody.data.issue.status, 'OPEN');
    const issueList = await issues.GET(request('GET', undefined, adminToken, 'issues'));
    assert.equal(issueList.status, 200);
    const issueRows = (await issueList.json()).data;
    assert.equal(issueRows.length, 1);
    assert.equal(issueRows[0].id, savedDefectBody.data.issue.id);
    const [reportedIssue] = await sql`select issue_type,description,image_url,reported_by from ims_issues where inventory_item_id=${tool.id} order by reported_at desc limit 1`;
    assert.equal(reportedIssue.issue_type, 'Cracked housing');
    assert.equal(reportedIssue.description, 'Visible crack reported during scan');
    assert.equal(reportedIssue.image_url, issueImageUrl);
    assert.equal(reportedIssue.reported_by, scanner.id);
    const [damagedItem] = await sql`select condition from ims_inventory_items where id=${tool.id}`;
    assert.equal(damagedItem.condition,'DAMAGED');
    console.log('PASS: reporting a defect marks the item DAMAGED and persists its own defect photo');

    const closed = await sessions.PATCH(request('PATCH', { id: first.session.id, action: 'close' }));
    assert.equal(closed.status, 200);
    const noSessions = await sessions.GET(request('GET', undefined, scannerToken));
    assert.equal((await noSessions.json()).data.length, 0);
    assert.equal((await scans.POST(request('POST', {
      barcode: tool.barcode, locationId: location.id, condition: 'GOOD', reportIssue: false,
      validationAttemptId: attempt.attemptId, captureMethod: 'CAMERA', sessionId: first.session.id,
      latitude: 25.1, longitude: 51.2, capturedAt: now,
    }, scannerToken, 'scans'))).status, 409);
    const closedChecklist = await checklist.GET(request('GET', undefined, adminToken, 'scans/checklist?inventoryType=TOOL'));
    assert.equal(closedChecklist.status, 200);
    assert.equal((await closedChecklist.json()).data.scanSessionId, null);
    console.log('PASS: closing a session removes scanner access and prevents scans while reports remain viewable');

    const sample = await sessions.POST(request('POST', { inventoryType: 'SAMPLE' }));
    assert.equal(sample.status, 201);
    const sampleSession = (await sample.json()).data.session;
    assert.equal(sampleSession.inventory_type, 'SAMPLE');
    const sampleSessions = await sessions.GET(request('GET', undefined, scannerToken));
    assert.equal((await sampleSessions.json()).data.length, 1);
    console.log('PASS: equipment and sample sessions are independent and selectable');

    const officeCreate = await officeInventory.POST(request('POST', {
      name: 'Session laptop', category: 'Laptop', manufacturer: 'Test', model: 'Office',
      serialNumber: 'OFFICE-SESSION-1', ownerName: 'Session User', locationId: location.id,
      condition: 'GOOD', status: 'ACTIVE', quantity: 1,
    }, adminToken, 'office-inventory'));
    assert.equal(officeCreate.status, 201);
    const officeItem = (await officeCreate.json()).data[0];
    assert.match(officeItem.barcode, /^OI-LAP-/);

    const deniedOffice = await officeValidate.POST(request('POST', {
      barcode: officeItem.barcode,
    }, scannerToken, 'office-validation/validate'));
    assert.equal(deniedOffice.status, 403);
    console.log('PASS: Materials / Samples-only scanners cannot bypass Office Inventory access');

    await sql`update ims_users set scanner_access='OFFICE' where id=${scanner.id}`;
    const deniedMaterials = await validate.POST(request('POST', {
      barcode: tool.barcode, captureMethod: 'CAMERA', latitude: 25.1, longitude: 51.2, capturedAt: now,
    }, scannerToken, 'scans/validate'));
    assert.equal(deniedMaterials.status, 403);
    console.log('PASS: Office-only scanners cannot bypass Materials / Samples access');

    await sql`update ims_users set scanner_access='BOTH' where id=${scanner.id}`;
    const bothMaterials = await validate.POST(request('POST', {
      barcode: tool.barcode, captureMethod: 'CAMERA', latitude: 25.1, longitude: 51.2, capturedAt: now,
    }, scannerToken, 'scans/validate'));
    assert.equal(bothMaterials.status, 200);
    console.log('PASS: Both access permits normal Materials / Samples scanning');

    const adHocLookup = await officeValidate.POST(request('POST', {
      barcode: officeItem.barcode,
    }, scannerToken, 'office-validation/validate'));
    assert.equal(adHocLookup.status, 200);
    assert.equal((await adHocLookup.json()).data.requestActive, false);

    const adHocScan = await officeScan.POST(request('POST', {
      barcode: officeItem.barcode, condition: 'Good',
    }, scannerToken, 'office-validation/scan'));
    assert.equal(adHocScan.status, 201);
    const adHocBody = await adHocScan.json();
    assert.equal(adHocBody.data.requestActive, false);
    assert.equal(adHocBody.data.item.condition, 'GOOD');
    const [adHocStored] = await sql`
      select last_validated_at,last_validated_by from ims_office_inventory_items where id=${officeItem.id}
    `;
    assert.ok(adHocStored.last_validated_at);
    assert.equal(adHocStored.last_validated_by, scanner.id);
    const [adHocHistory] = await sql`
      select session_id,scanner_user_id from ims_office_validation_scans
      where inventory_item_id=${officeItem.id} order by scanned_at asc limit 1
    `;
    assert.equal(adHocHistory.session_id, null);
    assert.equal(adHocHistory.scanner_user_id, scanner.id);
    console.log('PASS: Office Inventory items can be scanned without an active validation request');

    const officeStarted = await officeSessions.POST(request('POST', {}, adminToken, 'office-validation-sessions'));
    assert.equal(officeStarted.status, 201);
    const officeSession = (await officeStarted.json()).data.session;

    const afterRequestCreate = await officeInventory.POST(request('POST', {
      name: 'Late monitor', category: 'Monitor', manufacturer: 'Test', model: 'Late',
      serialNumber: 'OFFICE-LATE-1', ownerName: 'Late User', locationId: location.id,
      condition: 'GOOD', status: 'ACTIVE', quantity: 1,
    }, adminToken, 'office-inventory'));
    assert.equal(afterRequestCreate.status, 201);
    const lateItem = (await afterRequestCreate.json()).data[0];

    const lateLookup = await officeValidate.POST(request('POST', {
      sessionId: officeSession.id, barcode: lateItem.barcode,
    }, scannerToken, 'office-validation/validate'));
    assert.equal(lateLookup.status, 200);
    const lateLookupBody = await lateLookup.json();
    assert.equal(lateLookupBody.data.requestActive, true);
    assert.equal(lateLookupBody.data.inRequest, false);

    const lateScan = await officeScan.POST(request('POST', {
      sessionId: officeSession.id, barcode: lateItem.barcode, condition: 'GOOD',
    }, scannerToken, 'office-validation/scan'));
    assert.equal(lateScan.status, 201);
    const lateScanBody = await lateScan.json();
    assert.equal(lateScanBody.data.requestActive, true);
    assert.equal(lateScanBody.data.requestCounted, false);
    const [lateHistory] = await sql`
      select session_id from ims_office_validation_scans
      where inventory_item_id=${lateItem.id} order by scanned_at desc limit 1
    `;
    assert.equal(lateHistory.session_id, null);
    console.log('PASS: Office items outside an active request still scan normally without changing request progress');

    const officeSaved = await officeScan.POST(request('POST', {
      sessionId: officeSession.id, barcode: officeItem.barcode, condition: 'Good',
    }, scannerToken, 'office-validation/scan'));
    assert.equal(officeSaved.status, 201);
    const officeSavedBody = await officeSaved.json();
    assert.equal(officeSavedBody.data.item.id, officeItem.id);
    assert.equal(officeSavedBody.data.duplicate, false);
    assert.equal(officeSavedBody.data.item.condition, 'GOOD');
    const [officeTarget] = await sql`
      select validated_at,validated_by from ims_office_validation_targets
      where session_id=${officeSession.id} and inventory_item_id=${officeItem.id}
    `;
    assert.ok(officeTarget.validated_at);
    assert.equal(officeTarget.validated_by, scanner.id);
    assert.equal(officeSavedBody.data.requestCounted, true);
    console.log('PASS: active Office Inventory requests still count scanner validations after ad-hoc scans');

    const officeClosed = await officeSessions.PATCH(request('PATCH', {
      id: officeSession.id, action: 'close',
    }, adminToken, 'office-validation-sessions'));
    assert.equal(officeClosed.status, 200);
    const staleSessionScan = await officeScan.POST(request('POST', {
      sessionId: officeSession.id, barcode: officeItem.barcode, condition: 'GOOD',
    }, scannerToken, 'office-validation/scan'));
    assert.equal(staleSessionScan.status, 201);
    const staleBody = await staleSessionScan.json();
    assert.equal(staleBody.data.requestActive, false);
    assert.equal(staleBody.data.requestCounted, false);
    console.log('PASS: a closed/stale validation request never blocks an Office Inventory scan');
  } finally {
    await sql.end();
    await control`drop schema if exists ${control(schemaName)} cascade`;
    await control.end();
  }
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
