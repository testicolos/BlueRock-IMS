import { compare } from 'bcryptjs';
import { z } from 'zod';
import { db } from '@/lib/db';
import { createToken } from '@/lib/auth';
import { fail, ok, serverError } from '@/lib/http';

const schema = z.object({ username: z.string().min(2).max(80), password: z.string().min(8).max(200) });

export async function POST(request: Request) {
  try {
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return fail('Invalid login request', 400, parsed.error.flatten());
    const sql = db();
    const rows = await sql`
      select id,username,password_hash,full_name,role
      from ims_users
      where lower(username)=lower(${parsed.data.username}) and active=true
      limit 1
    `;
    const user = rows[0];
    if (!user || !(await compare(parsed.data.password, user.password_hash))) return fail('Invalid username or password', 401);
    await sql`update ims_users set last_login_at=now(), updated_at=now() where id=${user.id}`;
    const session = {
      id: user.id,
      username: user.username,
      fullName: user.full_name,
      role: user.role,
    };
    return ok({ token: await createToken(session), user: session });
  } catch (error) {
    return serverError(error);
  }
}
