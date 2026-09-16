import type { NextRequest } from 'next/server';

import { authFailure, requireAuth } from '@/lib/auth';
import { fail, ok, serverError } from '@/lib/http';
import { seedApprovedInventory } from '@/lib/seed-inventory';

export async function POST(request: NextRequest) {
  try {
    let actorId: string;
    const importToken = process.env.INVENTORY_IMPORT_TOKEN;
    if (importToken && request.headers.get('x-inventory-import-token') === importToken) {
      const { db } = await import('@/lib/db');
      const admin = (await db()`select id from ims_users where role='ADMIN' and active=true order by created_at limit 1`)[0];
      if (!admin) return fail('Create an administrator before importing inventory', 409);
      actorId = String(admin.id);
    } else {
      actorId = (await requireAuth(request, ['ADMIN'])).id;
    }
    return ok(await seedApprovedInventory(actorId));
  } catch (error) {
    const auth = authFailure(error);
    return auth ? fail(auth.message, auth.status) : serverError(error);
  }
}
