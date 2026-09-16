import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth, authFailure } from '@/lib/auth';
import { db } from '@/lib/db';
import { fail, ok, serverError } from '@/lib/http';

const createSchema = z.object({ name: z.string().min(2).max(120), code: z.string().min(1).max(30), description: z.string().max(500).optional(), address: z.string().max(300).optional(), locationType: z.string().max(60).optional() });

export async function GET(request: NextRequest) {
  try {
    await requireAuth(request);
    const sql = db();
    const rows = await sql`select id,name,code,description,address,location_type,active,created_at,updated_at from ims_locations where active=true order by name`;
    return ok(rows);
  } catch (error) { const auth=authFailure(error); return auth ? fail(auth.message,auth.status) : serverError(error); }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuth(request, ['ADMIN']);
    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) return fail('Invalid location',400,parsed.error.flatten());
    const sql=db(); const d=parsed.data;
    const rows=await sql`insert into ims_locations (name,code,description,address,location_type,created_by) values (${d.name},${d.code.toUpperCase()},${d.description ?? null},${d.address ?? null},${d.locationType ?? null},${actor.id}) returning *`;
    return ok(rows[0],201);
  } catch (error) { const auth=authFailure(error); return auth ? fail(auth.message,auth.status) : serverError(error); }
}
