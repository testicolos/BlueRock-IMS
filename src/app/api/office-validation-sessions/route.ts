import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { authFailure, requireAuth } from '@/lib/auth';
import { db } from '@/lib/db';
import { fail, ok, serverError } from '@/lib/http';
import { ensureOfficeInventorySchema } from '@/lib/office-inventory-schema';

export const maxDuration = 15;

const closeSchema = z.object({ id: z.string().uuid(), action: z.literal('close') });

async function sessionRows(sql = db()) {
  return sql`
    select s.id,s.status,s.started_by,s.started_at,s.closed_by,s.closed_at,
      starter.full_name as started_by_name,closer.full_name as closed_by_name,
      count(t.inventory_item_id)::int as total,
      count(t.validated_at)::int as validated
    from ims_office_validation_sessions s
    left join ims_users starter on starter.id=s.started_by
    left join ims_users closer on closer.id=s.closed_by
    left join ims_office_validation_targets t on t.session_id=s.id
    group by s.id,starter.full_name,closer.full_name
    order by s.started_at desc limit 50
  `;
}

export async function GET(request: NextRequest) {
  try {
    await requireAuth(request);
    await ensureOfficeInventorySchema();
    const summaryOnly = request.nextUrl.searchParams.get('summary') === '1';
    const requestedSessionId = request.nextUrl.searchParams.get('sessionId');
    const result = await db().begin('read only', async tx => {
      await tx`set local lock_timeout = '2s'`;
      await tx`set local statement_timeout = '8s'`;
      const sessions = await sessionRows(tx);
      const sessionId = requestedSessionId || sessions.find((row: any) => row.status === 'OPEN')?.id;
      let targets: any[] = [];
      if (!summaryOnly && sessionId) {
        targets = await tx`
          select t.session_id,t.validated_at,t.validated_by,i.id,i.barcode,i.name,i.category,i.manufacturer,i.model,
            i.serial_number,i.owner_name,i.condition,i.status,l.name as location_name,u.full_name as validated_by_name
          from ims_office_validation_targets t
          join ims_office_inventory_items i on i.id=t.inventory_item_id
          left join ims_locations l on l.id=i.current_location_id
          left join ims_users u on u.id=t.validated_by
          where t.session_id=${sessionId}
          order by case when t.validated_at is null then 0 else 1 end,i.name,i.barcode
        `;
      }
      return { sessions, sessionId: sessionId || null, targets };
    });
    return ok(result);
  } catch (error) {
    const auth = authFailure(error);
    return auth ? fail(auth.message, auth.status) : serverError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuth(request, ['ADMIN']);
    await ensureOfficeInventorySchema();
    const sql = db();
    const result = await sql.begin(async tx => {
      const existing = (await tx`select id,status,started_by,started_at from ims_office_validation_sessions where status='OPEN' limit 1 for update`)[0];
      if (existing) return { session: existing, created: false };
      const [session] = await tx`insert into ims_office_validation_sessions(started_by) values(${actor.id}) returning *`;
      await tx`
        insert into ims_office_validation_targets(session_id,inventory_item_id)
        select ${session.id},id from ims_office_inventory_items where archived=false and status<>'RETIRED'
      `;
      return { session, created: true };
    });
    return ok(result, result.created ? 201 : 200);
  } catch (error) {
    const auth = authFailure(error);
    if (auth) return fail(auth.message, auth.status);
    if (error instanceof Error && /unique/i.test(error.message)) return fail('An Office Inventory validation request is already active.', 409);
    return serverError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const actor = await requireAuth(request, ['ADMIN']);
    await ensureOfficeInventorySchema();
    const parsed = closeSchema.safeParse(await request.json());
    if (!parsed.success) return fail('Invalid validation request', 400, parsed.error.flatten());
    const rows = await db()`
      update ims_office_validation_sessions set status='CLOSED',closed_by=${actor.id},closed_at=now()
      where id=${parsed.data.id} and status='OPEN'
      returning *
    `;
    return rows[0] ? ok(rows[0]) : fail('Active validation request not found', 404);
  } catch (error) {
    const auth = authFailure(error);
    return auth ? fail(auth.message, auth.status) : serverError(error);
  }
}
