import { SignJWT, jwtVerify } from 'jose';
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
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime('12h')
    .sign(secret());
}

export async function requireAuth(request: NextRequest, allowed: Role[] = ['ADMIN', 'SCANNER']): Promise<SessionUser> {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) throw new Error('UNAUTHORIZED');
  const { payload } = await jwtVerify(header.slice(7), secret());
  const role = payload.role as Role;
  if (!payload.sub || !payload.username || !payload.fullName || !allowed.includes(role)) throw new Error('FORBIDDEN');
  return { id: payload.sub, username: String(payload.username), fullName: String(payload.fullName), role };
}

export function authFailure(error: unknown) {
  if (error instanceof Error && error.message === 'UNAUTHORIZED') return { status: 401, message: 'Authentication required' };
  if (error instanceof Error && error.message === 'FORBIDDEN') return { status: 403, message: 'Insufficient permissions' };
  return null;
}
