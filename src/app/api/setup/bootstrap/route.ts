import { hash } from 'bcryptjs';
import { z } from 'zod';
import { db } from '@/lib/db';
import { fail, ok, serverError } from '@/lib/http';

const schema = z.object({ username: z.string().min(3).max(80), password: z.string().min(12).max(200), fullName: z.string().min(2).max(120) });

export async function POST(request: Request) {
  try {
    const expected = process.env.AUTH_BOOTSTRAP_SECRET;
    if (!expected || request.headers.get('x-bootstrap-secret') !== expected) return fail('Forbidden', 403);
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return fail('Invalid request', 400, parsed.error.flatten());
    const sql = db();
    const count = await sql`select count(*)::int as count from ims_users`;
    if (count[0].count > 0) return fail('Bootstrap already completed', 409);
    const passwordHash = await hash(parsed.data.password, 12);
    const rows = await sql`insert into ims_users (username,password_hash,full_name,role) values (${parsed.data.username},${passwordHash},${parsed.data.fullName},'ADMIN') returning id,username,full_name,role,active,created_at`;
    return ok(rows[0], 201);
  } catch (error) {
    return serverError(error);
  }
}
