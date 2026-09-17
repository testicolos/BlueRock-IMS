import type { NextRequest } from 'next/server';
import { z } from 'zod';

import { authFailure, requireAuth } from '@/lib/auth';
import { db } from '@/lib/db';
import { fail, ok, serverError } from '@/lib/http';
import { ensureInventorySchema } from '@/lib/inventory-schema';

const schema = z.object({
  barcode: z.string().trim().min(3).max(100),
  captureMethod: z.enum(['CAMERA', 'MANUAL']),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  locationAccuracy: z.number().nonnegative().max(100_000).optional(),
  capturedAt: z.string().datetime(),
  sessionId: z.string().uuid().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuth(request);
    await ensureInventorySchema();
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return fail('Invalid barcode scan attempt', 400, parsed.error.flatten());

    const data = parsed.data;
    const barcode = data.barcode.toUpperCase();
    const sql = db();
    const item = (await sql`
      select i.id,i.barcode,i.name,i.inventory_type,i.condition,i.status,i.current_location_id,
        l.name as location_name,m.image_url
      from ims_inventory_items i
      left join ims_locations l on l.id=i.current_location_id
      left join ims_materials m on m.id=i.material_id
      where i.barcode=${barcode} and i.archived=false
      limit 1
    `)[0];

    if (data.sessionId) {
      const session = await sql`
        select id from ims_scan_sessions
        where id=${data.sessionId} and status='OPEN'
          and (${item?.inventory_type ?? 'NONE'}='NONE' or inventory_type=${item?.inventory_type ?? 'NONE'})
        limit 1
      `;
      if (!session.length) return fail('This scan session is no longer active.', 409);
    }

    const attempt = (await sql`
      insert into ims_scan_attempts(
        scanner_user_id,inventory_item_id,barcode,matched,capture_method,
        latitude,longitude,location_accuracy,captured_at
      ) values(
        ${actor.id},${item?.id ?? null},${barcode},${Boolean(item)},${data.captureMethod},
        ${data.latitude},${data.longitude},${data.locationAccuracy ?? null},${data.capturedAt}
      ) returning id,created_at
    `)[0];

    return ok({
      matched: Boolean(item),
      attemptId: attempt.id,
      item: item ? {
        id: item.id,
        barcode: item.barcode,
        name: item.name,
        inventoryType: item.inventory_type,
        condition: item.condition,
        status: item.status,
        currentLocationId: item.current_location_id,
        locationName: item.location_name,
        imageUrl: item.image_url,
      } : null,
    });
  } catch (error) {
    const auth = authFailure(error);
    return auth ? fail(auth.message, auth.status) : serverError(error);
  }
}
