import { compare } from 'bcryptjs';
import { z } from 'zod';
import { db } from '@/lib/db';
import { createToken } from '@/lib/auth';
import { fail, ok, serverError } from '@/lib/http';
import { traceFailure, traceStage, withRequestTrace } from '@/lib/request-trace';

export const maxDuration = 30;
const schema = z.object({ username: z.string().trim().min(2).max(80), password: z.string().min(8).max(200) });
export const POST = withRequestTrace('auth.login', async (request: Request) => {
  try {
    let body: unknown;
    try { body = await request.json(); } catch { return fail('Invalid login request', 400); }
    const parsed = schema.safeParse(body);
    if (!parsed.success) return fail('Invalid login request', 400);
    const sql = db();
    // No schema migrations on login. Bound database read locks and execution.
    const rows = await traceStage('user.lookup', () => sql.begin(async tx => {
      await tx`set local lock_timeout = '3s'`;
      await tx`set local statement_timeout = '6s'`;
      return tx`select id,username,password_hash,full_name,role from ims_users
        where lower(username)=lower(${parsed.data.username}) and active=true limit 1`;
    }));
    const user = rows[0];
    if (!user || !(await traceStage('password.verify', () => compare(parsed.data.password, user.password_hash)))) return fail('Invalid username or password', 401);
    const session = { id: user.id, username: user.username, fullName: user.full_name, role: user.role };
    const token = await traceStage('token.sign', () => createToken(session));
    // A nonessential timestamp write must not reject correct credentials.
    // Still await it (bounded); never leave unobserved background promises.
    await traceStage('login.timestamp', async () => {
      try {
        await sql.begin(async tx => {
          await tx`set local lock_timeout = '500ms'`;
          await tx`set local statement_timeout = '1s'`;
          await tx`update ims_users set last_login_at=now(),updated_at=now() where id=${user.id} and active=true`;
        });
      } catch (error) { traceFailure(error, 'warn', 'login.timestamp'); }
    });
    return ok({ token, user: session });
  } catch (error) { return serverError(error); }
});
