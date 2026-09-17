import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { authFailure, createToken, requireAuth } from '../src/lib/auth';

async function main() {
  process.env.JWT_SECRET = randomUUID() + randomUUID();
  const key = new TextEncoder().encode(process.env.JWT_SECRET);
  const user = { id: randomUUID(), username: 'test-admin', fullName: 'Test Admin', role: 'ADMIN' as const };
  const request = (token?: string) => new NextRequest('https://test.invalid/api/users', {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  const expired = await new SignJWT({ username: user.username, fullName: user.fullName, role: user.role })
    .setProtectedHeader({ alg: 'HS256' }).setSubject(user.id).setIssuedAt().setExpirationTime('0s').sign(key);
  const wrongSignature = await new SignJWT({ username: user.username, fullName: user.fullName, role: user.role })
    .setProtectedHeader({ alg: 'HS256' }).setSubject(user.id).setExpirationTime('1h')
    .sign(new TextEncoder().encode(randomUUID() + randomUUID()));
  for (const [label, token] of [['expired', expired], ['malformed', 'not-a-jwt'], ['wrong signature', wrongSignature], ['missing', undefined]] as const) {
    let error: unknown;
    try { await requireAuth(request(token)); } catch (caught) { error = caught; }
    assert.ok(error, `${label} credentials must be rejected`);
    assert.equal(authFailure(error)?.status ?? 500, 401, `${label} credentials must produce 401, not a recurring 500`);
    console.log(`PASS: ${label} session returns 401`);
  }
  assert.deepEqual(await requireAuth(request(await createToken(user))), user);
  const scanner = { ...user, role: 'SCANNER' as const };
  let forbidden: unknown;
  try { await requireAuth(request(await createToken(scanner)), ['ADMIN']); } catch (error) { forbidden = error; }
  assert.equal(authFailure(forbidden)?.status, 403);
  delete process.env.JWT_SECRET;
  let configError: unknown;
  try { await requireAuth(request(expired)); } catch (error) { configError = error; }
  assert.equal(authFailure(configError), null, 'Server configuration errors must not masquerade as expired sessions');
  console.log('PASS: valid sessions, role restrictions and configuration failures stay distinct');
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
