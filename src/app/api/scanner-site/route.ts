import type { NextRequest } from 'next/server';

import { authFailure, requireAuth } from '@/lib/auth';
import { db } from '@/lib/db';
import { fail, ok, serverError } from '@/lib/http';
import { ensureInventorySchema } from '@/lib/inventory-schema';
import { ensureScannerLocationSchema } from '@/lib/scanner-location-schema';

export async function GET(request: NextRequest) {
  try {
    const actor = await requireAuth(request);
    await ensureInventorySchema();
    await ensureScannerLocationSchema();
    const sql = db();
    const user = (await sql`
      select u.assigned_location_id,l.name as assigned_location_name,l.code as assigned_location_code
      from ims_users u
      left join ims_locations l on l.id=u.assigned_location_id and l.active=true
      where u.id=${actor.id} and u.active=true
      limit 1
    `)[0];
    if (!user?.assigned_location_id) {
      return ok({ assignedLocation: null, materials: [], incomingTransfers: [] });
    }

    const materials = await sql`
      select i.id,i.barcode,i.name,i.inventory_type,i.condition,i.status,i.serial_number,
        i.last_scanned_at,m.image_url
      from ims_inventory_items i
      left join ims_materials m on m.id=i.material_id
      where i.current_location_id=${user.assigned_location_id} and i.archived=false
      order by i.name,i.barcode
    `;
    const incomingTransfers = await sql`
      select t.id,t.inventory_item_id,t.from_location_id,t.destination_location_id,t.status,t.requested_at,
        i.barcode,i.name,i.inventory_type,i.condition,
        fl.name as from_location_name,dl.name as destination_location_name,
        requester.full_name as requested_by_name
      from ims_location_transfers t
      join ims_inventory_items i on i.id=t.inventory_item_id
      left join ims_locations fl on fl.id=t.from_location_id
      join ims_locations dl on dl.id=t.destination_location_id
      join ims_users requester on requester.id=t.requested_by
      where t.destination_location_id=${user.assigned_location_id} and t.status='PENDING'
      order by t.requested_at asc
    `;
    return ok({
      assignedLocation: { id: user.assigned_location_id, name: user.assigned_location_name, code: user.assigned_location_code },
      materials,
      incomingTransfers,
    });
  } catch (error) {
    const auth = authFailure(error);
    return auth ? fail(auth.message, auth.status) : serverError(error);
  }
}
