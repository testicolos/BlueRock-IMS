import type { NextRequest } from 'next/server';
import type { TransactionSql } from 'postgres';
import { authFailure, requireAuth } from '@/lib/auth';
import { db } from '@/lib/db';
import { fail, ok, serverError } from '@/lib/http';
import { ensureInventorySchema } from '@/lib/inventory-schema';
import { ensureScannerLocationSchema } from '@/lib/scanner-location-schema';
import { scanRecords } from '@/lib/scan-records';
import { activeScanSessions } from '@/lib/scan-sessions';
import { traceStage, withRequestTrace } from '@/lib/request-trace';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

async function boundedRead<T>(sql: ReturnType<typeof db>, work: (tx: TransactionSql) => Promise<T>) {
  return sql.begin('read only', async tx => {
    await tx\`set local lock_timeout = '3s'\`;
    await tx\`set local statement_timeout = '12s'\`;
    return work(tx);
  });
}

export const GET = withRequestTrace('app.load', async (request: NextRequest) => {
  try {
    const actor = await traceStage('token.verify', () => requireAuth(request));
    await traceStage('schema.inventory', () => ensureInventorySchema());
    const sql = db();

    const locationTask = traceStage('locations.read', () => boundedRead(sql, tx => tx\`
      select id,name,code,description,address,location_type,active,created_at,updated_at
      from ims_locations where active=true order by name
    \`));
    const sessionTask = traceStage('sessions.read', () => boundedRead(sql, tx => activeScanSessions(tx)));

    if (actor.role !== 'ADMIN') {
      const [locations, scanSessions] = await Promise.all([locationTask, sessionTask]);
      return ok({ locations, materials: [], users: [], scans: [], issues: [], scanSessions });
    }

    await traceStage('schema.scanner', () => ensureScannerLocationSchema());

    const materialTask = traceStage('materials.read', () => boundedRead(sql, tx => tx\`
      select m.*,coalesce(jsonb_agg(jsonb_build_object(
        'id',i.id,'barcode',i.barcode,'unit_number',i.unit_number,'name',i.name,
        'condition',i.condition,'status',i.status,'serial_number',i.serial_number,
        'location_id',i.current_location_id,'location_name',l.name,'last_scanned_at',i.last_scanned_at
      ) order by i.unit_number) filter (where i.id is not null),'[]'::jsonb) as units
      from ims_materials m
      left join ims_inventory_items i on i.material_id=m.id and i.archived=false
      left join ims_locations l on l.id=i.current_location_id
      where m.active=true group by m.id order by m.name
    \`));
    const userTask = traceStage('users.read', () => boundedRead(sql, tx => tx\`
      select u.id,u.username,u.full_name,u.role,u.active,u.assigned_location_id,
        assigned.name as assigned_location_name,u.last_login_at,u.created_at,u.updated_at
      from ims_users u left join ims_locations assigned on assigned.id=u.assigned_location_id order by u.full_name
    \`));
    const scanTask = traceStage('history.read', () => boundedRead(sql, tx => scanRecords(tx)));
    const issueTask = traceStage('issues.read', () => boundedRead(sql, tx => tx\`
      select x.*,i.barcode,i.name,i.inventory_type,m.image_url as material_image_url,
        l.name as location_name,u.full_name as reported_by_name
      from ims_issues x join ims_inventory_items i on i.id=x.inventory_item_id
      left join ims_materials m on m.id=i.material_id
      left join ims_locations l on l.id=i.current_location_id
      left join ims_users u on u.id=x.reported_by
      where x.archived=false order by x.reported_at desc
    \`));

    const [locations, scanSessions, materials, users, scans, issues] = await Promise.all([
      locationTask, sessionTask, materialTask, userTask, scanTask, issueTask,
    ]);
    return ok({ locations, materials, users, scans, issues, scanSessions });
  } catch (error) {
    const auth = authFailure(error);
    return auth ? fail(auth.message, auth.status) : serverError(error);
  }
});
