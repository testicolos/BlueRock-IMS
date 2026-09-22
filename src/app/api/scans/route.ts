import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { z } from 'zod';

import { authFailure, requireAuth } from '@/lib/auth';
import { db } from '@/lib/db';
import { fail, ok, serverError } from '@/lib/http';
import { ensureInventorySchema } from '@/lib/inventory-schema';
import { ensureScannerLocationSchema } from '@/lib/scanner-location-schema';
import { scanRecords } from '@/lib/scan-records';
import { recordScan } from '@/lib/record-scan';
import { assertScanEvidence } from '@/lib/scan-evidence-policy';
import { requireScannerAccess } from '@/lib/scanner-access';

const schema = z.object({
  barcode: z.string().trim().min(3).max(100),
  locationId: z.string().uuid().optional(),
  condition: z.enum(['GOOD', 'MINOR_ISSUE', 'DAMAGED', 'MISSING_PARTS', 'NEEDS_MAINTENANCE']).optional(),
  notes: z.string().max(2000).optional(),
  reportIssue: z.boolean().default(false),
  issueType: z.string().max(120).optional(),
  evidenceImageUrl: z.string().max(3_500_000).optional(),
  issueImageUrl: z.string().max(3_500_000).optional(),
  validationAttemptId: z.string().uuid(),
  captureMethod: z.enum(['CAMERA', 'MANUAL']),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  locationAccuracy: z.number().nonnegative().max(100_000).optional(),
  capturedAt: z.string().datetime(),
  clientTransactionId: z.string().uuid().optional(),
  sessionId: z.string().uuid().optional(),
});

export async function GET(request: NextRequest) {
  try {
    await requireAuth(request, ['ADMIN']);
    await ensureInventorySchema();
    await ensureScannerLocationSchema();
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
    await requireScannerAccess(actor,'MATERIALS');
    await ensureInventorySchema();
    await ensureScannerLocationSchema();
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      const oversizedEvidence = parsed.error.issues.some(issue => ['evidenceImageUrl','issueImageUrl'].includes(String(issue.path[0])) && issue.code === 'too_big');
      if (oversizedEvidence) return fail('Attached image is too large. Retake the photo closer to the barcode or choose a smaller image.', 413, parsed.error.flatten());
      return fail('Invalid scan', 400, parsed.error.flatten());
    }
    const data = actor.role==='SCANNER'
      ? { ...parsed.data, condition: parsed.data.reportIssue ? 'DAMAGED' as const : undefined }
      : parsed.data;
    if (data.reportIssue && !data.issueImageUrl) return fail('Take a defect photo before submitting a reported defect.', 400);
    assertScanEvidence(data);

    const transactionId = data.clientTransactionId ?? randomUUID();
    const sql = db();
    const result = await sql.begin(tx => recordScan(tx, actor.id, data, transactionId));
    return ok(result, result.duplicate ? 200 : 201);
  } catch (error) {
    const auth = authFailure(error);
    if (auth) return fail(auth.message, auth.status);
    if (error instanceof Error && error.message === 'SCAN_ACCESS_DENIED') return fail('This scanner is not allowed to scan Materials / Samples.',403);
    if (error instanceof Error && error.message === 'SCANNER_ACCOUNT_NOT_FOUND') return fail('Scanner account not found or inactive',403);
    if (error instanceof Error && error.message === 'MANUAL_PHOTO_REQUIRED') return fail('Take a new photo showing the material and its barcode before submitting manual entry', 400);
    if (error instanceof Error && error.message === 'TRANSACTION_CONFLICT') return fail('Scan request identifier is already in use', 409);
    if (error instanceof Error && error.message === 'INVALID_VALIDATION') return fail('Scan validation expired or does not match', 409);
    if (error instanceof Error && error.message === 'ITEM_NOT_FOUND') return fail('Item not found', 404);
    if (error instanceof Error && error.message === 'LOCATION_NOT_FOUND') return fail('Location not found or inactive', 404);
    if (error instanceof Error && error.message === 'SCAN_SESSION_REQUIRED') return fail('This scan session is no longer active.', 409);
    if (error instanceof Error && error.message === 'TRANSFER_ALREADY_PENDING') return fail('This item already has a pending location transfer', 409);
    return serverError(error);
  }
}
