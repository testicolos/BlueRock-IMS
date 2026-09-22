import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { authFailure, requireAuth } from '@/lib/auth';
import { db } from '@/lib/db';
import { fail, ok, serverError } from '@/lib/http';
import { ensureOfficeInventorySchema } from '@/lib/office-inventory-schema';

const updateSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  category: z.string().trim().min(2).max(120).optional(),
  manufacturer: z.string().trim().max(120).nullable().optional(),
  model: z.string().trim().max(120).nullable().optional(),
  serialNumber: z.string().trim().max(120).nullable().optional(),
  ownerName: z.string().trim().max(160).nullable().optional(),
  locationId: z.string().uuid().nullable().optional(),
  condition: z.enum(['GOOD','MINOR_ISSUE','DAMAGED','MISSING_PARTS','NEEDS_MAINTENANCE']).optional(),
  status: z.enum(['ACTIVE','INACTIVE','MAINTENANCE','LOST','RETIRED']).optional(),
});

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth(request, ['ADMIN']);
    await ensureOfficeInventorySchema();
    const { id } = await context.params;
    const sql = db();
    const item = (await sql`
      select i.*,l.name as location_name from ims_office_inventory_items i
      left join ims_locations l on l.id=i.current_location_id
      where i.id=${id} and i.archived=false limit 1
    `)[0];
    if (!item) return fail('Office item not found', 404);
    const ownerHistory = await sql`
      select h.*,u.full_name as changed_by_name from ims_office_owner_history h
      left join ims_users u on u.id=h.changed_by
      where h.inventory_item_id=${id} order by h.changed_at desc
    `;
    return ok({ item, ownerHistory });
  } catch (error) {
    const auth = authFailure(error);
    return auth ? fail(auth.message, auth.status) : serverError(error);
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireAuth(request, ['ADMIN']);
    await ensureOfficeInventorySchema();
    const parsed = updateSchema.safeParse(await request.json());
    if (!parsed.success) return fail('Invalid office inventory update', 400, parsed.error.flatten());
    const { id } = await context.params;
    const data = parsed.data;
    const sql = db();
    const updated = await sql.begin(async tx => {
      const current = (await tx`select * from ims_office_inventory_items where id=${id} and archived=false limit 1 for update`)[0];
      if (!current) throw new Error('NOT_FOUND');
      if (data.locationId) {
        const location = await tx`select id from ims_locations where id=${data.locationId} and active=true limit 1`;
        if (!location.length) throw new Error('LOCATION_NOT_FOUND');
      }
      const nextOwner = data.ownerName === undefined ? current.owner_name : (data.ownerName || null);
      if (data.ownerName !== undefined && nextOwner !== current.owner_name) {
        await tx`insert into ims_office_owner_history(inventory_item_id,previous_owner,new_owner,changed_by)
          values(${id},${current.owner_name},${nextOwner},${actor.id})`;
      }
      const [row] = await tx`
        update ims_office_inventory_items set
          name=${data.name ?? current.name},
          category=${data.category ?? current.category},
          manufacturer=${data.manufacturer === undefined ? current.manufacturer : data.manufacturer},
          model=${data.model === undefined ? current.model : data.model},
          serial_number=${data.serialNumber === undefined ? current.serial_number : data.serialNumber},
          owner_name=${nextOwner},
          current_location_id=${data.locationId === undefined ? current.current_location_id : data.locationId},
          condition=${data.condition ?? current.condition},
          status=${data.status ?? current.status},
          updated_at=now()
        where id=${id}
        returning *
      `;
      return row;
    });
    return ok(updated);
  } catch (error) {
    const auth = authFailure(error);
    if (auth) return fail(auth.message, auth.status);
    if (error instanceof Error && error.message === 'NOT_FOUND') return fail('Office item not found', 404);
    if (error instanceof Error && error.message === 'LOCATION_NOT_FOUND') return fail('Location not found or inactive', 404);
    return serverError(error);
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth(request, ['ADMIN']);
    await ensureOfficeInventorySchema();
    const { id } = await context.params;
    const rows = await db()`update ims_office_inventory_items set archived=true,updated_at=now() where id=${id} and archived=false returning id`;
    return rows[0] ? ok(rows[0]) : fail('Office item not found', 404);
  } catch (error) {
    const auth = authFailure(error);
    return auth ? fail(auth.message, auth.status) : serverError(error);
  }
}
