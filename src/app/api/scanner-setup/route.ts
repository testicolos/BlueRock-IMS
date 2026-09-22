import type { NextRequest } from 'next/server';
import { authFailure, requireAuth } from '@/lib/auth';
import { db } from '@/lib/db';
import { fail, ok, serverError } from '@/lib/http';
import { ensureScannerLocationSchema } from '@/lib/scanner-location-schema';
import { ensureScannerAccessSchema } from '@/lib/scanner-access';
import { traceStage, withRequestTrace } from '@/lib/request-trace';

export const dynamic = 'force-dynamic';
export const GET = withRequestTrace('scanner.setup', async (request: NextRequest) => {
  try {
    await traceStage('token.verify', () => requireAuth(request, ['ADMIN']));
    await traceStage('schema.scanner', () => ensureScannerLocationSchema());
    await traceStage('schema.scannerAccess', () => ensureScannerAccessSchema());
    const sql = db();
    const users = await traceStage('scanners.read', () => sql`
      select u.id,u.username,u.full_name,u.role,u.active,u.assigned_location_id,u.scanner_access,l.name as assigned_location_name
      from ims_users u left join ims_locations l on l.id=u.assigned_location_id
      where u.role='SCANNER' and u.active=true order by u.full_name
    `);
    const locations = await traceStage('locations.read', () => sql`
      select id,name,code from ims_locations where active=true order by name
    `);
    return ok({ users, locations });
  } catch (error) {
    const auth = authFailure(error);
    return auth ? fail(auth.message, auth.status) : serverError(error);
  }
});
