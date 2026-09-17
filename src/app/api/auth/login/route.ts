import { compare } from 'bcryptjs';
import { z } from 'zod';
import { db } from '@/lib/db';
import { createToken } from '@/lib/auth';
import { fail, ok, serverError } from '@/lib/http';
import { ensureScannerLocationSchema } from '@/lib/scanner-location-schema';

const schema = z.object({ username: z.string().min(2).max(80), password: z.string().min(8).max(200) });

export async function POST(request: Request) {
  try {
    await ensureScannerLocationSchema();
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return fail('Invalid login request', 400, parsed.error.flatten());
    const sql = db();
    const rows = await sql`
      select u.id,u.username,u.password_hash,u.full_name,u.role,u.assigned_location_id,
        l.name as assigned_location_name,l.code as assigned_location_code
      from ims_users u
      left join ims_locations l on l.id=u.assigned_location_id and l.active=true
      where lower(u.username)=lower(${parsed.data.username}) and u.active=true
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
      assignedLocationId: user.assigned_location_id ?? null,
      assignedLocationName: user.assigned_location_name ?? null,
      assignedLocationCode: user.assigned_location_code ?? null,
    };
    return ok({ token: await createToken(session), user: session });
  } catch (error) {
    return serverError(error);
  }
}
