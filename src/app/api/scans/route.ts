import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { z } from 'zod';

import { authFailure, requireAuth } from '@/lib/auth';
import { db } from '@/lib/db';
import { fail, ok, serverError } from '@/lib/http';
import { ensureInventorySchema } from '@/lib/inventory-schema';

const schema = z.object({
  barcode: z.string().trim().min(3).max(100),
  locationId: z.string().uuid(),
  condition: z.enum(['GOOD', 'MINOR_ISSUE', 'DAMAGED', 'MISSING_PARTS', 'NEEDS_MAINTENANCE']).default('GOOD'),
  notes: z.string().max(2000).optional(),
  reportIssue: z.boolean().default(false),
  issueType: z.string().max(120).optional(),
  evidenceImageUrl: z.string().max(3_500_000).optional(),
  validationAttemptId: z.string().uuid(),
  captureMethod: z.enum(['CAMERA', 'MANUAL']),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  locationAccuracy: z.number().nonnegative().max(100_000).optional(),
  capturedAt: z.string().datetime(),
  clientTransactionId: z.string().uuid().optional(),
});

export async function GET(request: NextRequest) {
  try {
    await requireAuth(request, ['ADMIN']);
    await ensureInventorySchema();
    const rows = await db()`
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
    return ok(rows);
  } catch (error) {
    const auth = authFailure(error);
    return auth ? fail(auth.message, auth.status) : serverError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuth(request);
    await ensureInventorySchema();
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return fail('Invalid scan', 400, parsed.error.flatten());
    const data = parsed.data;
    const barcode = data.barcode.toUpperCase();
    if (data.captureMethod === 'MANUAL' && !data.evidenceImageUrl) {
      return fail('A timestamped barcode photo is required for manual entry', 400);
    }

    const transactionId = data.clientTransactionId ?? randomUUID();
    const sql = db();
    const result = await sql.begin(async (tx) => {
      const existing = (await tx`select id from ims_scans where client_transaction_id=${transactionId} limit 1`)[0];
      if (existing) return { duplicate: true, scanId: existing.id };

      const attempt = (await tx`
        select id,inventory_item_id,barcode,matched,capture_method
        from ims_scan_attempts
        where id=${data.validationAttemptId}
          and scanner_user_id=${actor.id}
          and created_at > now() - interval '15 minutes'
        limit 1
        for update
      `)[0];
      if (!attempt || !attempt.matched || attempt.barcode !== barcode || attempt.capture_method !== data.captureMethod) {
        throw new Error('INVALID_VALIDATION');
      }

      const item = (await tx`
        select * from ims_inventory_items
        where id=${attempt.inventory_item_id} and barcode=${barcode} and archived=false
        limit 1 for update
      `)[0];
      if (!item) throw new Error('ITEM_NOT_FOUND');
      const location = (await tx`
        select id,name from ims_locations where id=${data.locationId} and active=true limit 1
      `)[0];
      if (!location) throw new Error('LOCATION_NOT_FOUND');

      const scans = await tx`
        insert into ims_scans(
          inventory_item_id,barcode,previous_location_id,new_location_id,scanner_user_id,
          condition,notes,client_transaction_id,validation_attempt_id,capture_method,
          latitude,longitude,location_accuracy,captured_at,evidence_image_url
        ) values(
          ${item.id},${item.barcode},${item.current_location_id},${location.id},${actor.id},
          ${data.condition},${data.notes ?? null},${transactionId},${attempt.id},${data.captureMethod},
          ${data.latitude},${data.longitude},${data.locationAccuracy ?? null},${data.capturedAt},${data.evidenceImageUrl ?? null}
        ) returning *
      `;
      await tx`
        update ims_inventory_items
        set current_location_id=${location.id},condition=${data.condition},last_scanned_at=now(),
          last_scanned_by=${actor.id},updated_at=now()
        where id=${item.id}
      `;
      if (data.reportIssue) {
        await tx`
          insert into ims_issues(inventory_item_id,scan_id,reported_by,issue_type,description,image_url)
          values(
            ${item.id},${scans[0].id},${actor.id},${data.issueType ?? 'GENERAL'},
            ${data.notes ?? 'Issue reported during scan'},${data.evidenceImageUrl ?? null}
          )
        `;
      }
      return {
        duplicate: false,
        scan: scans[0],
        item: { id: item.id, barcode: item.barcode, name: item.name },
        previousLocationId: item.current_location_id,
        newLocation: { id: location.id, name: location.name },
      };
    });
    return ok(result, result.duplicate ? 200 : 201);
  } catch (error) {
    const auth = authFailure(error);
    if (auth) return fail(auth.message, auth.status);
    if (error instanceof Error && error.message === 'INVALID_VALIDATION') return fail('Scan validation expired or does not match', 409);
    if (error instanceof Error && error.message === 'ITEM_NOT_FOUND') return fail('Item not found', 404);
    if (error instanceof Error && error.message === 'LOCATION_NOT_FOUND') return fail('Location not found or inactive', 404);
    return serverError(error);
  }
}
