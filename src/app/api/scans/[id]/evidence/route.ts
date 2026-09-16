import type { NextRequest } from 'next/server';
import { z } from 'zod';

import { authFailure, requireAuth } from '@/lib/auth';
import { db } from '@/lib/db';
import { fail, ok, serverError } from '@/lib/http';
import { ensureInventorySchema } from '@/lib/inventory-schema';
import { scanEvidenceRows } from '@/lib/scan-evidence';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth(request, ['ADMIN']);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return fail('Invalid scan ID', 400);
    const photoId = request.nextUrl.searchParams.get('photo') || null;
    if (photoId && !z.string().uuid().safeParse(photoId).success) return fail('Invalid photo ID', 400);
    await ensureInventorySchema();

    const rows = await scanEvidenceRows(db(), id, photoId);
    if (!rows.length) return fail('Scan not found', 404);
    const photos = rows.filter(row => row.has_evidence).map(row => ({
      id: row.id,
      barcode: row.barcode,
      name: row.name,
      // Fetch one image body at a time to stay below serverless response limits.
      imageUrl: photoId ? row.evidence_image_url : undefined,
      capturedAt: row.captured_at,
      scannedAt: row.scanned_at,
      scannerName: row.scanner_name,
      latitude: row.latitude,
      longitude: row.longitude,
      locationAccuracy: row.location_accuracy,
      captureMethod: row.capture_method,
      locationName: row.location_name,
      previousLocationName: row.previous_location_name,
    }));
    const response = ok({ photos });
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch (error) {
    const auth = authFailure(error);
    return auth ? fail(auth.message, auth.status) : serverError(error);
  }
}
