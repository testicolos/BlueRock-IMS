import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { z } from 'zod';

import { authFailure, requireAuth } from '@/lib/auth';
import { db } from '@/lib/db';
import { fail, ok, serverError } from '@/lib/http';
import { ensureInventorySchema } from '@/lib/inventory-schema';
import { scanRecords } from '@/lib/scan-records';
import { recordScan } from '@/lib/record-scan';

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
    const rows = await scanRecords();
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
    if (data.captureMethod === 'MANUAL' && !data.evidenceImageUrl) {
      return fail('A timestamped barcode photo is required for manual entry', 400);
    }

    const transactionId = data.clientTransactionId ?? randomUUID();
    const sql = db();
    const result = await sql.begin(tx => recordScan(tx, actor.id, data, transactionId));
    return ok(result, result.duplicate ? 200 : 201);
  } catch (error) {
    const auth = authFailure(error);
    if (auth) return fail(auth.message, auth.status);
    if (error instanceof Error && error.message === 'TRANSACTION_CONFLICT') return fail('Scan request identifier is already in use', 409);
    if (error instanceof Error && error.message === 'INVALID_VALIDATION') return fail('Scan validation expired or does not match', 409);
    if (error instanceof Error && error.message === 'ITEM_NOT_FOUND') return fail('Item not found', 404);
    if (error instanceof Error && error.message === 'LOCATION_NOT_FOUND') return fail('Location not found or inactive', 404);
    return serverError(error);
  }
}
