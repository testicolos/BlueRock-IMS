import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { z } from 'zod';

import { authFailure, requireAuth } from '@/lib/auth';
import { db } from '@/lib/db';
import { fail, ok, serverError } from '@/lib/http';
import { ensureInventorySchema } from '@/lib/inventory-schema';
import { scanRecords } from '@/lib/scan-records';
import { recordScan } from '@/lib/record-scan';
import { assertScanEvidence } from '@/lib/scan-evidence-policy';

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
  sessionId: z.string().uuid(),
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
    if (!parsed.success) {
      const oversizedEvidence = parsed.error.issues.some(issue => issue.path[0] === 'evidenceImageUrl' && issue.code === 'too_big');
      if (oversizedEvidence) return fail('Attached image is too large. Retake the photo closer to the barcode or choose a smaller image.', 413, parsed.error.flatten());
      return fail('Invalid scan', 400, parsed.error.flatten());
    }
    const data = parsed.data;
    assertScanEvidence(data);

    const transactionId = data.clientTransactionId ?? randomUUID();
    const sql = db();
    const result = await sql.begin(tx => recordScan(tx, actor.id, data, transactionId));
    return ok(result, result.duplicate ? 200 : 201);
  } catch (error) {
    const auth = authFailure(error);
    if (auth) return fail(auth.message, auth.status);
    if (error instanceof Error && error.message === 'MANUAL_PHOTO_REQUIRED') return fail('Take a new photo showing the material and its barcode before submitting manual entry', 400);
    if (error instanceof Error && error.message === 'TRANSACTION_CONFLICT') return fail('Scan request identifier is already in use', 409);
    if (error instanceof Error && error.message === 'INVALID_VALIDATION') return fail('Scan validation expired or does not match', 409);
    if (error instanceof Error && error.message === 'ITEM_NOT_FOUND') return fail('Item not found', 404);
    if (error instanceof Error && error.message === 'LOCATION_NOT_FOUND') return fail('Location not found or inactive', 404);
    if (error instanceof Error && error.message === 'SCAN_SESSION_REQUIRED') return fail('This scan session is no longer active. Ask an administrator to start a new session.', 409);
    return serverError(error);
  }
}
