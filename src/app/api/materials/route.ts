import type { NextRequest } from 'next/server';
import { z } from 'zod';

import { authFailure, requireAuth } from '@/lib/auth';
import { db } from '@/lib/db';
import { fail, ok, serverError } from '@/lib/http';
import { ensureInventorySchema } from '@/lib/inventory-schema';

const allocationSchema = z.object({ locationId: z.string().uuid(), count: z.number().int().min(1).max(1000) });
const createSchema = z.object({
  name: z.string().min(2).max(160),
  code: z.string().min(2).max(12).regex(/^[A-Za-z0-9]+$/),
  inventoryType: z.enum(['TOOL','SAMPLE']),
  imageUrl: z.string().max(3_500_000).optional(),
  imageSourceUrl: z.string().url().max(2000).optional().or(z.literal('')),
  description: z.string().max(2000).optional(),
  allocations: z.array(allocationSchema).max(50).default([]),
});

export async function GET(request: NextRequest) {
  try {
    await requireAuth(request);
    await ensureInventorySchema();
    const rows = await db()`select m.*,
      coalesce(jsonb_agg(jsonb_build_object(
        'id',i.id,'barcode',i.barcode,'unit_number',i.unit_number,'name',i.name,
        'condition',i.condition,'status',i.status,'serial_number',i.serial_number,
        'location_id',i.current_location_id,'location_name',l.name,'last_scanned_at',i.last_scanned_at
      ) order by i.unit_number) filter (where i.id is not null),'[]'::jsonb) as units
      from ims_materials m
      left join ims_inventory_items i on i.material_id=m.id and i.archived=false
      left join ims_locations l on l.id=i.current_location_id
      where m.active=true
      group by m.id
      order by m.name`;
    return ok(rows);
  } catch (error) {
    const auth = authFailure(error);
    return auth ? fail(auth.message, auth.status) : serverError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuth(request,['ADMIN']);
    await ensureInventorySchema();
    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) return fail('Invalid material',400,parsed.error.flatten());
    const data = parsed.data;
    const code = data.code.toUpperCase();
    const prefix = data.inventoryType === 'TOOL' ? 'TL' : 'SP';
    const result = await db().begin(async (tx) => {
      const materialRows = await tx`insert into ims_materials(inventory_type,name,code,image_url,image_source_url,description,created_by)
        values(${data.inventoryType},${data.name},${code},${data.imageUrl || null},${data.imageSourceUrl || null},${data.description || null},${actor.id}) returning *`;
      const material = materialRows[0];
      let unitNumber = 1;
      for (const allocation of data.allocations) {
        for (let index=0; index<allocation.count; index+=1) {
          const barcode = `${prefix}-${code}-${String(unitNumber).padStart(4,'0')}`;
          await tx`insert into ims_inventory_items(barcode,inventory_type,name,material_id,unit_number,current_location_id,condition,status,created_by)
            values(${barcode},${data.inventoryType},${data.name},${material.id},${unitNumber},${allocation.locationId},'GOOD','ACTIVE',${actor.id})`;
          unitNumber += 1;
        }
      }
      return {...material,unitsCreated:unitNumber-1};
    });
    return ok(result,201);
  } catch (error) {
    const auth=authFailure(error);
    if (auth) return fail(auth.message,auth.status);
    if (error instanceof Error && /unique/i.test(error.message)) return fail('That material code already exists',409);
    return serverError(error);
  }
}
