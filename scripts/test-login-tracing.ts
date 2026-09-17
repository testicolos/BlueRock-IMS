import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { mock } from 'node:test';
import { hash } from 'bcryptjs';
import postgres from 'postgres';
import { NextRequest } from 'next/server';
import { createToken } from '../src/lib/auth';

async function main() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL must point to a disposable database');
  const schemaName = `ims_login_test_${randomUUID().replaceAll('-', '')}`;
  const local = ['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname);
  const options = { ssl: local ? false as const : 'require' as const, prepare: false, onnotice: () => {} };
  const control = postgres(url, { ...options, max: 1 });
  const sql = postgres(url, { ...options, max: 5, connection: { search_path: schemaName } });
  const blocker = postgres(url, { ...options, max: 1, connection: { search_path: schemaName } });
  const password = ` ${randomUUID()} `;
  const secret = randomUUID() + randomUUID();
  process.env.JWT_SECRET = secret;
  const entries: string[] = [];
  const original = { info: console.info, warn: console.warn, error: console.error };
  console.info = console.warn = console.error = (...args: unknown[]) => { entries.push(args.map(String).join(' ')); };
  try {
    await control`create schema ${control(schemaName)}`;
    await sql`create table ims_users(id uuid primary key default gen_random_uuid(),username text unique not null,
      password_hash text not null,full_name text not null,role text not null,active boolean not null default true,
      last_login_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now())`;
    const passwordHash = await hash(password, 4);
    const [admin] = await sql`insert into ims_users(username,password_hash,full_name,role) values('qa-admin',${passwordHash},'QA Administrator','ADMIN') returning id`;
    const [scanner] = await sql`insert into ims_users(username,password_hash,full_name,role) values('qa-scanner',${passwordHash},'QA Scanner','SCANNER') returning id`;
    mock.module(new URL('../src/lib/db.ts', import.meta.url).href, { namedExports: { db: () => sql } });
    const login = await import('../src/app/api/auth/login/route');
    const session = await import('../src/app/api/auth/session/route');
    const setup = await import('../src/app/api/scanner-setup/route');
    const { serverError } = await import('../src/lib/http');
    const { withRequestTrace, traceStage } = await import('../src/lib/request-trace');
    const request = (body: unknown = { username: ' QA-ADMIN ', password }) => new Request('https://test.invalid/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-client-request-id': randomUUID() }, body: JSON.stringify(body),
    });
    const response = await login.POST(request());
    assert.equal(response.status, 200);
    const signedIn = (await response.json()).data;
    const token = signedIn.token as string;
    assert.equal(signedIn.user.role, 'ADMIN');
    assert.ok(response.headers.get('x-request-id'));
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal((await sql`select to_regclass('ims_schema_migrations') as registry`)[0].registry, null, 'Login must not run optional migrations');
    assert.equal((await login.POST(request({ username: 'qa-admin', password: 'wrong-password' }))).status, 401);
    assert.equal((await login.POST(new Request('https://test.invalid/api/auth/login', { method: 'POST', body: '{' }))).status, 400);
    const authRequest = (value = token) => new NextRequest('https://test.invalid/api/auth/session', { headers: { authorization: `Bearer ${value}` } });
    assert.equal((await session.GET(authRequest())).status, 200);
    await sql`update ims_users set active=false where id=${admin.id}`;
    assert.equal((await session.GET(authRequest())).status, 401);
    await sql`update ims_users set active=true where id=${admin.id}`;

    async function withLock(kind: 'row'|'table', work: () => Promise<void>) {
      let ready!: () => void; let release!: () => void;
      const acquired = new Promise<void>(resolve => { ready = resolve; });
      const held = new Promise<void>(resolve => { release = resolve; });
      const locking = blocker.begin(async tx => {
        if (kind === 'row') await tx`select id from ims_users where id=${admin.id} for update`;
        else await tx`lock table ims_users in access exclusive mode`;
        ready(); await held;
      });
      // Ensure lock acquisition failures do not leave the test waiting forever.
      await Promise.race([acquired, locking.then(() => { throw new Error('Lock ended before acquisition'); })]);
      try { await work(); } finally { release(); await locking; }
    }
    await withLock('row', async () => {
      const started = Date.now();
      assert.equal((await login.POST(request())).status, 200, 'A locked last-login timestamp must not reject a correct password');
      assert.ok(Date.now() - started < 3500);
    });
    await withLock('table', async () => {
      const started = Date.now();
      const busy = await login.POST(request());
      assert.equal(busy.status, 503);
      const failure = (await busy.json()).error;
      assert.equal(failure.code, 'DATABASE_LOCK_TIMEOUT');
      assert.equal(failure.requestId, busy.headers.get('x-request-id'));
      assert.ok(Date.now() - started < 6000, 'A blocked read must not hang indefinitely');
    });
    assert.equal((await login.POST(request())).status, 200, 'Login recovers after contention ends');

    const schema = (await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8')).replace(/^create extension[^\n]*\n/m, '');
    await sql.unsafe(schema);
    await sql`insert into ims_locations(name,code) values('QA Site','QA')`;
    const scannerToken = await createToken({ id: scanner.id, username: 'qa-scanner', fullName: 'QA Scanner', role: 'SCANNER' });
    assert.equal((await setup.GET(authRequest(scannerToken))).status, 403);
    const setupResponse = await setup.GET(authRequest());
    assert.equal(setupResponse.status, 200);
    const setupData = (await setupResponse.json()).data;
    assert.deepEqual(Object.keys(setupData).sort(), ['locations', 'users']);
    assert.equal(setupData.users.length, 1);
    assert.equal(setupData.users[0].id, scanner.id);

    const poisoned = Object.assign(new Error(`secret=${secret} password=${password}`), { code: '42703', query: 'SELECT secret FROM users', parameters: [password], token });
    const handler = withRequestTrace('test.redaction', async () => {
      try { return await traceStage('database.lookup', async () => { throw poisoned; }); }
      catch (error) { return serverError(error); }
    });
    const failures = await Promise.all([handler(), handler()]);
    assert.notEqual(failures[0].headers.get('x-request-id'), failures[1].headers.get('x-request-id'));
    const failureBodies = await Promise.all(failures.map(item => item.text()));
    const serialized = entries.join('\n') + failureBodies.join('\n');
    for (const sensitive of [secret, password, token, passwordHash, url, 'SELECT secret FROM users', 'QA Administrator', 'qa-admin']) {
      assert.ok(!serialized.includes(sensitive), 'Developer logs and public errors must exclude sensitive data');
    }
    const records = entries.filter(line => line.startsWith('{')).map(line => JSON.parse(line));
    assert.ok(records.some(entry => entry.stage === 'login.timestamp' && entry.code === 'DATABASE_LOCK_TIMEOUT'));
    assert.ok(records.some(entry => entry.stage === 'user.lookup' && entry.code === 'DATABASE_LOCK_TIMEOUT'));
    assert.ok(records.some(entry => entry.operation === 'auth.login' && entry.event === 'request.completed' && entry.status === 200));
  } finally {
    console.info = original.info; console.warn = original.warn; console.error = original.error;
    await blocker.end(); await sql.end();
    await control`drop schema if exists ${control(schemaName)} cascade`;
    await control.end();
  }
  console.log('PASS: login without optional schema, trimmed username, unchanged password, invalid credentials, malformed JSON, disabled accounts');
  console.log('PASS: locked timestamp does not reject login; blocked reads time out and recover; scanner setup loads only its own data');
  console.log('PASS: request IDs and stage traces are isolated and exclude passwords, hashes, tokens, SQL, database URLs and user identities');
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
