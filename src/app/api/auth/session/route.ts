import type { NextRequest } from 'next/server';
import { authenticateRequest, authFailure } from '@/lib/auth';
import { db } from '@/lib/db';
import { fail, ok, serverError } from '@/lib/http';
import { traceStage, withRequestTrace } from '@/lib/request-trace';

export const dynamic = 'force-dynamic';
export const maxDuration = 10;
export const GET = withRequestTrace('auth.session', async (request: NextRequest) => {
  try {
    const session = await traceStage('token.verify', () => authenticateRequest(request));
    const rows = await traceStage('user.active', () => db().begin(async tx => {
      await tx`set local lock_timeout = '2s'`;
      await tx`set local statement_timeout = '4s'`;
      return tx`select username,full_name,role,active from ims_users where id=${session.user.id} limit 1`;
    }));
    const user = rows[0];
    // A role change must use a new signed token, never a role from localStorage.
    if (!user?.active || user.role !== session.user.role) return fail('Your account changed. Please sign in again.', 401);
    return ok({ user: { ...session.user, username: user.username, fullName: user.full_name }, expiresAt: session.expiresAt });
  } catch (error) {
    const auth = authFailure(error);
    return auth ? fail(auth.message, auth.status) : serverError(error);
  }
});
