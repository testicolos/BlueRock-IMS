import type { NextRequest } from 'next/server';
import { z } from 'zod';

import { authFailure, requireAuth } from '@/lib/auth';
import { db } from '@/lib/db';
import { fail, ok, serverError } from '@/lib/http';
import { ensureInventorySchema } from '@/lib/inventory-schema';
import { ensureScannerLocationSchema } from '@/lib/scanner-location-schema';

const schema = z.object({
  action: z.enum(['APPROVE','REJECT']),
  note: z.string().trim().max(1000).optional(),
});

export async function POST(request: NextRequest,{params}:{params:Promise<{id:string}>}) {
  try {
    const actor = await requireAuth(request);
    await ensureInventorySchema();
    await ensureScannerLocationSchema();
    const { id } = await params;
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return fail('Invalid transfer decision',400,parsed.error.flatten());
    const sql = db();
    const result = await sql.begin(async tx => {
      const transfer = (await tx`
        select t.*,i.current_location_id
        from ims_location_transfers t
        join ims_inventory_items i on i.id=t.inventory_item_id
        where t.id=${id}
        limit 1 for update
      `)[0];
      if (!transfer) throw new Error('TRANSFER_NOT_FOUND');
      if (transfer.status !== 'PENDING') throw new Error('TRANSFER_ALREADY_DECIDED');

      if (actor.role !== 'ADMIN') {
        const user = (await tx`select assigned_location_id from ims_users where id=${actor.id} and active=true limit 1`)[0];
        if (!user?.assigned_location_id || user.assigned_location_id !== transfer.destination_location_id) throw new Error('TRANSFER_FORBIDDEN');
      }

      if (parsed.data.action === 'APPROVE') {
        if (transfer.current_location_id !== transfer.from_location_id) throw new Error('LOCATION_CHANGED');
        await tx`
          update ims_inventory_items
          set current_location_id=${transfer.destination_location_id},updated_at=now()
          where id=${transfer.inventory_item_id}
        `;
      }
      const rows = await tx`
        update ims_location_transfers
        set status=${parsed.data.action==='APPROVE'?'APPROVED':'REJECTED'},
          decided_by=${actor.id},decided_at=now(),decision_note=${parsed.data.note??null}
        where id=${id}
        returning id,status,decided_at,decision_note
      `;
      return rows[0];
    });
    return ok(result);
  } catch (error) {
    const auth = authFailure(error);
    if (auth) return fail(auth.message,auth.status);
    if (error instanceof Error && error.message==='TRANSFER_NOT_FOUND') return fail('Transfer not found',404);
    if (error instanceof Error && error.message==='TRANSFER_ALREADY_DECIDED') return fail('Transfer was already approved or rejected',409);
    if (error instanceof Error && error.message==='TRANSFER_FORBIDDEN') return fail('Only the scanner assigned to the destination location can decide this transfer',403);
    if (error instanceof Error && error.message==='LOCATION_CHANGED') return fail('The item location changed after this request was created. Reject this request and scan the item again.',409);
    return serverError(error);
  }
}
