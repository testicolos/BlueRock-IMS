import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { authFailure, requireAuth } from '@/lib/auth';
import { db } from '@/lib/db';
import { fail, ok, serverError } from '@/lib/http';
import { ensureInventorySchema } from '@/lib/inventory-schema';
import { activeScanSessions } from '@/lib/scan-sessions';

const typeSchema = z.object({ inventoryType: z.enum(['TOOL','SAMPLE']) });
const closeSchema = z.object({ id: z.string().uuid(), action: z.literal('close') });

export async function GET(request: NextRequest) {
  try {
    await requireAuth(request);
    await ensureInventorySchema();
    const sessions = await activeScanSessions();
    return ok(sessions);
  } catch (error) {
    const auth = authFailure(error);
    return auth ? fail(auth.message, auth.status) : serverError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuth(request, ['ADMIN']);
    await ensureInventorySchema();
    const parsed = typeSchema.safeParse(await request.json());
    if (!parsed.success) return fail('Choose equipment or sample scanning', 400, parsed.error.flatten());
    const sql = db();
    const result = await sql.begin(async tx => {
      const existing = (await tx`
        select s.id,s.inventory_type,s.status,s.started_by,u.full_name as started_by_name,
          s.started_at,s.closed_by,s.closed_at
        from ims_scan_sessions s left join ims_users u on u.id=s.started_by
        where s.inventory_type=${parsed.data.inventoryType} and s.status='OPEN'
        order by s.started_at desc limit 1 for update of s
      `)[0];
      if (existing) return { session: existing, created: false };
      const [session] = await tx`
        insert into ims_scan_sessions(inventory_type,status,started_by)
        values(${parsed.data.inventoryType},'OPEN',${actor.id})
        returning id,inventory_type,status,started_by,started_at,closed_by,closed_at
      `;
      return { session: { ...session, started_by_name: actor.fullName }, created: true };
    });
    return ok(result, result.created ? 201 : 200);
  } catch (error) {
    const auth = authFailure(error);
    if (auth) return fail(auth.message, auth.status);
    if (error instanceof Error && /unique/i.test(error.message)) return fail('A scan session for this inventory type is already active.', 409);
    return serverError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const actor = await requireAuth(request, ['ADMIN']);
    await ensureInventorySchema();
    const parsed = closeSchema.safeParse(await request.json());
    if (!parsed.success) return fail('Invalid scan session', 400, parsed.error.flatten());
    const rows = await db()`
      update ims_scan_sessions set status='CLOSED',closed_by=${actor.id},closed_at=now()
      where id=${parsed.data.id} and status='OPEN'
      returning id,inventory_type,status,started_by,started_at,closed_by,closed_at
    `;
    return rows[0] ? ok(rows[0]) : fail('Active scan session not found', 404);
  } catch (error) {
    const auth = authFailure(error);
    return auth ? fail(auth.message, auth.status) : serverError(error);
  }
}
