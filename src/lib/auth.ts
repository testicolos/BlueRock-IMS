import { SignJWT, jwtVerify, errors } from 'jose';
import type { NextRequest } from 'next/server';

export type Role = 'ADMIN' | 'SCANNER';
export type SessionUser = { id: string; username: string; fullName: string; role: Role };

function secret() {
  const value = process.env.JWT_SECRET;
  if (!value || value.length < 32) throw new Error('JWT_SECRET must be configured with at least 32 characters');
  return new TextEncoder().encode(value);
}

export async function createToken(user: SessionUser) {
  return new SignJWT({ username: user.username, fullName: user.fullName, role: user.role })
    .setProtectedHeader({ alg: 'HS256' }).setSubject(user.id).setIssuedAt().setExpirationTime('12h').sign(secret());
}

export async function authenticateRequest(request: NextRequest, allowed: Role[] = ['ADMIN', 'SCANNER']) {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) throw new Error('UNAUTHORIZED');
  // Configuration failures must stay server errors, not sign everybody out.
  const key = secret();
  let payload;
  try {
    ({ payload } = await jwtVerify(header.slice(7), key, { algorithms: ['HS256'], requiredClaims: ['sub', 'exp'] }));
  } catch (error) {
    if (error instanceof errors.JWTExpired) throw new Error('SESSION_EXPIRED');
    if (error instanceof errors.JOSEError) throw new Error('UNAUTHORIZED');
    throw error;
  }
  if (typeof payload.sub !== 'string' || !payload.sub || typeof payload.username !== 'string' || !payload.username ||
      typeof payload.fullName !== 'string' || !payload.fullName || typeof payload.exp !== 'number' ||
      (payload.role !== 'ADMIN' && payload.role !== 'SCANNER')) throw new Error('UNAUTHORIZED');
  const role: Role = payload.role;
  if (!allowed.includes(role)) throw new Error('FORBIDDEN');
  const user: SessionUser = { id: payload.sub, username: payload.username, fullName: payload.fullName, role };
  return { user, expiresAt: new Date(payload.exp * 1000).toISOString() };
}

export async function requireAuth(request: NextRequest, allowed: Role[] = ['ADMIN', 'SCANNER']): Promise<SessionUser> {
  return (await authenticateRequest(request, allowed)).user;
}

export function authFailure(error: unknown) {
  if (error instanceof Error && error.message === 'SESSION_EXPIRED') return { status: 401, message: 'Your session expired. Please sign in again.' };
  if (error instanceof Error && error.message === 'UNAUTHORIZED') return { status: 401, message: 'Authentication required' };
  if (error instanceof Error && error.message === 'FORBIDDEN') return { status: 403, message: 'Insufficient permissions' };
  return null;
}
