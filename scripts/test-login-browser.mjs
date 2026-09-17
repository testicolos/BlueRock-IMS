import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import postgres from 'postgres';
import { hash } from 'bcryptjs';
import { SignJWT } from 'jose';
import { chromium } from 'playwright';

const source = process.env.TEST_DATABASE_URL;
if (!source || !['localhost','127.0.0.1','[::1]'].includes(new URL(source).hostname)) throw new Error('Browser tests require a disposable LOOPBACK PostgreSQL database');
const name = `ims_browser_${randomUUID().replaceAll('-', '')}`;
const dbUrl = new URL(source); dbUrl.pathname = `/${name}`;
const control = postgres(source, { ssl: false, prepare: false, max: 1, onnotice: () => {} });
let sql; let server; let browser; let created = false;
const output = [];
const secret = randomUUID() + randomUUID();
const password = randomUUID();
const origin = 'http://127.0.0.1:3100';
try {
  await control`create database ${control(name)}`; created = true;
  sql = postgres(dbUrl.toString(), { ssl: false, prepare: false, max: 1, onnotice: () => {} });
  await sql.unsafe(await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8'));
  const passwordHash = await hash(password, 4);
  const [admin] = await sql`insert into ims_users(username,password_hash,full_name,role) values('qa-admin',${passwordHash},'QA Administrator','ADMIN') returning id`;
  const [scanner] = await sql`insert into ims_users(username,password_hash,full_name,role) values('qa-scanner',${passwordHash},'QA Scanner','SCANNER') returning id`;
  const [site] = await sql`insert into ims_locations(name,code) values('QA Site','QA') returning id`;
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3100'], {
    env: { ...process.env, DATABASE_URL: dbUrl.toString(), JWT_SECRET: secret, NODE_ENV: 'production', IMS_TRACE_LEVEL: 'debug' }, stdio: ['ignore','pipe','pipe'],
  });
  for (const stream of [server.stdout, server.stderr]) stream.on('data', chunk => { output.push(String(chunk)); if (output.length > 300) output.shift(); });
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (server.exitCode !== null) throw new Error('Test server stopped before readiness');
    try { if ((await fetch(`${origin}/login`)).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(ready, 'Production-build server must start');
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  async function signIn(username) {
    await page.getByLabel('Username', { exact: true }).fill(username);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  }
  async function tokenFor(role, expired = false) {
    return new SignJWT({ username: role === 'ADMIN' ? 'qa-admin' : 'qa-scanner', fullName: role === 'ADMIN' ? 'QA Administrator' : 'QA Scanner', role })
      .setProtectedHeader({ alg: 'HS256' }).setSubject(role === 'ADMIN' ? admin.id : scanner.id).setIssuedAt()
      .setExpirationTime(expired ? Math.floor(Date.now()/1000)-60 : Math.floor(Date.now()/1000)+3600)
      .sign(new TextEncoder().encode(secret));
  }
  async function savedSession(token, profile = '{broken-json') {
    await page.evaluate(({token,profile}) => { localStorage.setItem('br_token',token); localStorage.setItem('br_user',profile); }, { token, profile });
  }
  await page.goto(`${origin}/`);
  await page.waitForURL('**/login');
  await signIn('qa-admin');
  await page.waitForURL('**/?view=dashboard');
  await page.getByRole('heading', { name: 'Start a scan session' }).waitFor();
  console.log('PASS browser: real admin login reaches the loaded dashboard');

  await page.getByRole('link', { name: 'Scanner Setup' }).click();
  await page.waitForURL('**/scanner-config');
  await page.getByText('QA Scanner', { exact: true }).waitFor();
  await page.getByLabel('Assigned location').selectOption(site.id);
  await page.getByText('Scanner location saved.', { exact: true }).waitFor();
  assert.equal((await sql`select assigned_location_id from ims_users where id=${scanner.id}`)[0].assigned_location_id, site.id);
  await page.getByRole('link', { name: 'Back to Admin' }).click();
  await page.getByTitle('Sign out', { exact: true }).click();
  await page.waitForURL('**/login');
  assert.equal(await page.evaluate(() => localStorage.getItem('br_token')), null);
  console.log('PASS browser: Scanner Setup assignment and legacy admin logout');

  await signIn('qa-scanner');
  await page.waitForURL('**/scan');
  await page.getByRole('link', { name: 'My Site', exact: true }).click();
  await page.waitForURL('**/site');
  await page.getByRole('heading', { name: 'QA Site', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Logout', exact: true }).click();
  await page.waitForURL('**/login');
  assert.equal(await page.evaluate(() => localStorage.getItem('br_token')), null);
  console.log('PASS browser: scanner login, My Site and logout');

  await savedSession(await tokenFor('ADMIN', true));
  await page.goto(`${origin}/`);
  await page.waitForURL('**/login');
  assert.equal(await page.evaluate(() => localStorage.getItem('br_token')), null);
  console.log('PASS browser: expired session recovers to login rather than a 500/loading loop');

  const valid = await tokenFor('ADMIN');
  await savedSession(valid);
  await page.goto(`${origin}/`);
  await page.getByRole('heading', { name: 'Start a scan session' }).waitFor();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('br_user')).role), 'ADMIN');
  console.log('PASS browser: malformed stored profile is repaired from a verified server session');

  await page.route('**/api/auth/session', route => route.fulfill({ status: 503, contentType: 'application/json',
    body: JSON.stringify({ success: false, error: { message: 'Database temporarily busy' } }) }));
  await page.reload();
  await page.getByRole('heading', { name: 'Unable to verify your session' }).waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('br_token')), valid, '503 must preserve the token for retry');
  await page.unroute('**/api/auth/session');
  await page.getByRole('button', { name: 'Retry connection' }).click();
  await page.getByRole('heading', { name: 'Start a scan session' }).waitFor();
  console.log('PASS browser: service failure is distinct from expired credentials and Retry recovers');

  await page.getByTitle('Sign out', { exact: true }).click();
  await page.waitForURL('**/login');
  await page.getByLabel('Username', { exact: true }).fill('qa-admin');
  await page.getByLabel('Password', { exact: true }).fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Invalid username or password' }).waitFor();
  await page.getByRole('button', { name: 'Copy diagnostic log' }).waitFor();
  const diagnostics = await page.evaluate(() => sessionStorage.getItem('br_request_diagnostics'));
  for (const sensitive of [valid, secret, password, passwordHash, 'wrong-password', 'qa-admin']) assert.ok(!diagnostics.includes(sensitive));
  assert.ok(JSON.parse(diagnostics).some(row => row.operation === 'auth.login' && row.status === 401 && row.requestId));
  assert.deepEqual(pageErrors, [], 'No uncaught browser errors');
  assert.ok(output.join('').includes('request.completed'), 'Server emits correlated structured logs');
  console.log('PASS browser: failed login exposes safe reference IDs and copyable diagnostics, without secrets or uncaught errors');
} catch (error) {
  // Only synthetic test accounts are used. Do not print captured server output,
  // environment variables, stored sessions or response bodies on failure.
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (server && server.exitCode === null) { const stopped = once(server, 'exit'); server.kill('SIGTERM'); await stopped; }
  await sql?.end();
  if (created) await control`drop database ${control(name)} with (force)`;
  await control.end();
}
