import type { NextRequest } from 'next/server';

import { authFailure, requireAuth } from '@/lib/auth';
import { db } from '@/lib/db';
import { fail, ok, serverError } from '@/lib/http';
import { ensureInventorySchema } from '@/lib/inventory-schema';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const actor = await requireAuth(request);
    await ensureInventorySchema();
    const sql = db();

    // Keep the initial application load on one database connection. The previous
    // client made several simultaneous serverless requests, which could leave the
    // dashboard showing zeroes while a pooled connection waited to become free.
    const locations = await sql`
      select id,name,code,description,address,location_type,active,created_at,updated_at
      from ims_locations
      where active=true
      order by name
    `;

    if (actor.role !== 'ADMIN') {
      return ok({ locations, materials: [], users: [], scans: [], issues: [] });
    }

    const materials = await sql`
      select m.*,
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
      order by m.name
    `;

    const users = await sql`
      select id,username,full_name,role,active,last_login_at,created_at,updated_at
      from ims_users
      order by full_name
    `;
    const scans = await sql`
      select s.*,i.barcode,i.name,i.inventory_type,
        pl.name as previous_location_name,nl.name as new_location_name,u.full_name as scanner_name
      from ims_scans s
      join ims_inventory_items i on i.id=s.inventory_item_id
      left join ims_locations pl on pl.id=s.previous_location_id
      left join ims_locations nl on nl.id=s.new_location_id
      left join ims_users u on u.id=s.scanner_user_id
      order by s.scanned_at desc
      limit 500
    `;
    const issues = await sql`
      select x.*,i.barcode,i.name,i.inventory_type,m.image_url as material_image_url,
        l.name as location_name,u.full_name as reported_by_name
      from ims_issues x
      join ims_inventory_items i on i.id=x.inventory_item_id
      left join ims_materials m on m.id=i.material_id
      left join ims_locations l on l.id=i.current_location_id
      left join ims_users u on u.id=x.reported_by
      where x.archived=false
      order by x.reported_at desc
    `;

    return ok({ locations, materials, users, scans, issues });
  } catch (error) {
    const auth = authFailure(error);
    return auth ? fail(auth.message, auth.status) : serverError(error);
  }
}
