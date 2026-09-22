import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { authFailure, requireAuth } from '@/lib/auth';
import { db } from '@/lib/db';
import { fail, ok, serverError } from '@/lib/http';
import { ensureOfficeInventorySchema } from '@/lib/office-inventory-schema';
import { requireScannerAccess } from '@/lib/scanner-access';

const schema = z.object({ sessionId: z.string().uuid().optional(), barcode: z.string().trim().min(3).max(100) });

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuth(request);
    await requireScannerAccess(actor,'OFFICE');
    await ensureOfficeInventorySchema();
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return fail('Invalid Office Inventory barcode', 400, parsed.error.flatten());
    const data = parsed.data;
    const sql = db();
    const item = (await sql`
      select i.id,i.barcode,i.name,i.category,i.manufacturer,i.model,i.serial_number,i.owner_name,
        i.condition,i.status,l.name as location_name
      from ims_office_inventory_items i
      left join ims_locations l on l.id=i.current_location_id
      where i.barcode=${data.barcode.toUpperCase()} and i.archived=false limit 1
    `)[0];
    if (!item) return fail('Barcode not found in Office Inventory', 404);

    let requestActive = false;
    let inRequest = false;
    let alreadyValidated = false;
    if (data.sessionId) {
      const session = (await sql`
        select id from ims_office_validation_sessions
        where id=${data.sessionId} and status='OPEN' limit 1
      `)[0];
      requestActive = Boolean(session);
      if (session) {
        const target = (await sql`
          select validated_at from ims_office_validation_targets
          where session_id=${session.id} and inventory_item_id=${item.id} limit 1
        `)[0];
        inRequest = Boolean(target);
        alreadyValidated = Boolean(target?.validated_at);
      }
    }

    return ok({
      id:item.id,barcode:item.barcode,name:item.name,category:item.category,manufacturer:item.manufacturer,model:item.model,
      serialNumber:item.serial_number,ownerName:item.owner_name,locationName:item.location_name,condition:item.condition,
      status:item.status,alreadyValidated,requestActive,inRequest,
    });
  } catch (error) {
    const auth = authFailure(error);
    if (auth) return fail(auth.message, auth.status);
    if (error instanceof Error && error.message === 'SCAN_ACCESS_DENIED') return fail('This scanner is not allowed to scan Office Inventory.',403);
    if (error instanceof Error && error.message === 'SCANNER_ACCOUNT_NOT_FOUND') return fail('Scanner account not found or inactive',403);
    return serverError(error);
  }
}
