import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { authFailure, requireAuth } from '@/lib/auth';
import { db } from '@/lib/db';
import { fail, ok, serverError } from '@/lib/http';
import { ensureOfficeInventorySchema, officeBarcode } from '@/lib/office-inventory-schema';

const createSchema = z.object({
  name: z.string().trim().min(2).max(160),
  category: z.string().trim().min(2).max(120),
  manufacturer: z.string().trim().max(120).optional(),
  model: z.string().trim().max(120).optional(),
  serialNumber: z.string().trim().max(120).optional(),
  ownerName: z.string().trim().max(160).optional(),
  locationId: z.string().uuid().optional(),
  condition: z.enum(['GOOD','MINOR_ISSUE','DAMAGED','MISSING_PARTS','NEEDS_MAINTENANCE']).default('GOOD'),
  status: z.enum(['ACTIVE','INACTIVE','MAINTENANCE','LOST','RETIRED']).default('ACTIVE'),
  quantity: z.number().int().min(1).max(500).default(1),
});

export async function GET(request: NextRequest) {
  try {
    await requireAuth(request, ['ADMIN']);
    await ensureOfficeInventorySchema();
    const rows = await db()`
      select i.*, l.name as location_name,
        case when exists(
          select 1 from ims_office_validation_targets t
          join ims_office_validation_sessions s on s.id=t.session_id
          where t.inventory_item_id=i.id and s.status='OPEN' and t.validated_at is not null
        ) then 'VALIDATED' else 'PENDING' end as validation_status
      from ims_office_inventory_items i
      left join ims_locations l on l.id=i.current_location_id
      where i.archived=false
      order by i.created_at desc
    `;
    return ok(rows);
  } catch (error) {
    const auth = authFailure(error);
    return auth ? fail(auth.message, auth.status) : serverError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuth(request, ['ADMIN']);
    await ensureOfficeInventorySchema();
    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) return fail('Invalid office inventory item', 400, parsed.error.flatten());
    const data = parsed.data;
    const sql = db();
    const created = await sql.begin(async tx => {
      if (data.locationId) {
        const location = await tx`select id from ims_locations where id=${data.locationId} and active=true limit 1`;
        if (!location.length) throw new Error('LOCATION_NOT_FOUND');
      }
      const [counter] = await tx`
        select coalesce(max((regexp_match(barcode,'([0-9]+)$'))[1]::int),0)::int as value
        from ims_office_inventory_items
        where category=${data.category}
      `;
      const rows = [];
      for (let offset = 1; offset <= data.quantity; offset += 1) {
        const barcode = officeBarcode(data.category, Number(counter.value) + offset);
        const [item] = await tx`
          insert into ims_office_inventory_items(
            barcode,name,category,manufacturer,model,serial_number,owner_name,current_location_id,
            condition,status,created_by
          ) values(
            ${barcode},${data.name},${data.category},${data.manufacturer || null},${data.model || null},
            ${data.serialNumber || null},${data.ownerName || null},${data.locationId || null},
            ${data.condition},${data.status},${actor.id}
          ) returning *
        `;
        if (data.ownerName) {
          await tx`insert into ims_office_owner_history(inventory_item_id,previous_owner,new_owner,changed_by)
            values(${item.id},null,${data.ownerName},${actor.id})`;
        }
        rows.push(item);
      }
      return rows;
    });
    return ok(created, 201);
  } catch (error) {
    const auth = authFailure(error);
    if (auth) return fail(auth.message, auth.status);
    if (error instanceof Error && error.message === 'LOCATION_NOT_FOUND') return fail('Location not found or inactive', 404);
    return serverError(error);
  }
}
