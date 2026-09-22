import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { authFailure, requireAuth } from '@/lib/auth';
import { db } from '@/lib/db';
import { fail, ok, serverError } from '@/lib/http';
import { ensureOfficeInventorySchema } from '@/lib/office-inventory-schema';

const schema = z.object({ sessionId: z.string().uuid(), barcode: z.string().trim().min(3).max(100) });

export async function POST(request: NextRequest) {
  try {
    await requireAuth(request);
    await ensureOfficeInventorySchema();
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return fail('Invalid Office Inventory barcode', 400, parsed.error.flatten());
    const data = parsed.data;
    const sql = db();
    const session = (await sql`select id from ims_office_validation_sessions where id=${data.sessionId} and status='OPEN' limit 1`)[0];
    if (!session) return fail('This Office Inventory validation request is no longer active.', 409);
    const item = (await sql`
      select i.id,i.barcode,i.name,i.category,i.manufacturer,i.model,i.serial_number,i.owner_name,
        i.condition,i.status,l.name as location_name,t.validated_at
      from ims_office_inventory_items i
      left join ims_locations l on l.id=i.current_location_id
      left join ims_office_validation_targets t on t.inventory_item_id=i.id and t.session_id=${data.sessionId}
      where i.barcode=${data.barcode.toUpperCase()} and i.archived=false limit 1
    `)[0];
    if (!item) return fail('Barcode not found in Office Inventory', 404);
    if (!item.validated_at && !(await sql`select 1 from ims_office_validation_targets where session_id=${data.sessionId} and inventory_item_id=${item.id} limit 1`).length) {
      return fail('This item is not part of the active Office Inventory validation request', 409);
    }
    return ok({
      id:item.id,barcode:item.barcode,name:item.name,category:item.category,manufacturer:item.manufacturer,model:item.model,
      serialNumber:item.serial_number,ownerName:item.owner_name,locationName:item.location_name,condition:item.condition,
      status:item.status,alreadyValidated:Boolean(item.validated_at),
    });
  } catch (error) {
    const auth = authFailure(error);
    return auth ? fail(auth.message, auth.status) : serverError(error);
  }
}
