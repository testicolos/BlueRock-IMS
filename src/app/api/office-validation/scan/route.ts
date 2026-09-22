import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { authFailure, requireAuth } from '@/lib/auth';
import { db } from '@/lib/db';
import { fail, ok, serverError } from '@/lib/http';
import { ensureOfficeInventorySchema } from '@/lib/office-inventory-schema';

const conditionSchema = z.preprocess(value => typeof value === 'string' ? value.trim().toUpperCase().replace(/[\s-]+/g, '_') : value,
  z.enum(['GOOD','MINOR_ISSUE','DAMAGED','MISSING_PARTS','NEEDS_MAINTENANCE']));

const schema = z.object({
  sessionId: z.string().uuid(),
  barcode: z.string().trim().min(3).max(100),
  condition: conditionSchema.default('GOOD'),
});

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuth(request);
    await ensureOfficeInventorySchema();
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return fail('Invalid Office Inventory scan', 400, parsed.error.flatten());
    const data = parsed.data;
    const barcode = data.barcode.toUpperCase();
    const sql = db();
    const result = await sql.begin(async tx => {
      const session = (await tx`select id from ims_office_validation_sessions where id=${data.sessionId} and status='OPEN' limit 1 for update`)[0];
      if (!session) throw new Error('SESSION_NOT_FOUND');
      const item = (await tx`
        select i.*,l.name as location_name from ims_office_inventory_items i
        left join ims_locations l on l.id=i.current_location_id
        where i.barcode=${barcode} and i.archived=false limit 1 for update of i
      `)[0];
      if (!item) throw new Error('ITEM_NOT_FOUND');
      const target = (await tx`
        select * from ims_office_validation_targets
        where session_id=${data.sessionId} and inventory_item_id=${item.id}
        limit 1 for update
      `)[0];
      if (!target) throw new Error('NOT_IN_REQUEST');
      const [scan] = await tx`
        insert into ims_office_validation_scans(session_id,inventory_item_id,barcode,scanner_user_id,condition)
        values(${data.sessionId},${item.id},${item.barcode},${actor.id},${data.condition})
        returning id,scanned_at
      `;
      if (!target.validated_at) {
        await tx`
          update ims_office_validation_targets set validated_at=${scan.scanned_at},validated_by=${actor.id}
          where session_id=${data.sessionId} and inventory_item_id=${item.id}
        `;
      }
      await tx`
        update ims_office_inventory_items set condition=${data.condition},last_validated_at=${scan.scanned_at},
          last_validated_by=${actor.id},updated_at=${scan.scanned_at}
        where id=${item.id}
      `;
      return {
        duplicate: Boolean(target.validated_at),
        item: {
          id: item.id, barcode: item.barcode, name: item.name, category: item.category,
          manufacturer: item.manufacturer, model: item.model, serialNumber: item.serial_number,
          ownerName: item.owner_name, locationName: item.location_name, condition: data.condition, status: item.status,
        },
        scannedAt: scan.scanned_at,
      };
    });
    return ok(result, result.duplicate ? 200 : 201);
  } catch (error) {
    const auth = authFailure(error);
    if (auth) return fail(auth.message, auth.status);
    if (error instanceof Error && error.message === 'SESSION_NOT_FOUND') return fail('This Office Inventory validation request is no longer active.', 409);
    if (error instanceof Error && error.message === 'ITEM_NOT_FOUND') return fail('Barcode not found in Office Inventory', 404);
    if (error instanceof Error && error.message === 'NOT_IN_REQUEST') return fail('This item is not part of the active Office Inventory validation request', 409);
    return serverError(error);
  }
}
