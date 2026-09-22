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
    const checklist = await import('../src/app/api/scans/checklist/route');
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

    const defectBase = {
      barcode: tool.barcode, locationId: location.id, condition: 'DAMAGED', reportIssue: true,
      issueType: 'Cracked housing', notes: 'Visible crack reported during scan',
      validationAttemptId: attempt.attemptId, captureMethod: 'CAMERA' as const, sessionId: first.session.id,
      latitude: 25.1, longitude: 51.2, capturedAt: now,
    };
    const missingDefectPhoto = await scans.POST(request('POST', defectBase, scannerToken, 'scans'));
    assert.equal(missingDefectPhoto.status, 400);
    const issueImageUrl = 'data:image/jpeg;base64,AA==';
    const savedDefect = await scans.POST(request('POST', { ...defectBase, issueImageUrl }, scannerToken, 'scans'));
    assert.equal(savedDefect.status, 201);
    const [reportedIssue] = await sql`select issue_type,description,image_url,reported_by from ims_issues where inventory_item_id=${tool.id} order by reported_at desc limit 1`;
    assert.equal(reportedIssue.issue_type, 'Cracked housing');
    assert.equal(reportedIssue.description, 'Visible crack reported during scan');
    assert.equal(reportedIssue.image_url, issueImageUrl);
    assert.equal(reportedIssue.reported_by, scanner.id);
    console.log('PASS: scan defect reports require and persist their own defect photo');

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
  } finally {
    await sql.end();
    await control`drop schema if exists ${control(schemaName)} cascade`;
    await control.end();
  }
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
