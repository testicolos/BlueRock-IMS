import type { NextRequest } from 'next/server';
import { authFailure, requireAuth } from '@/lib/auth';
import { fail, ok, serverError } from '@/lib/http';
import { ensureInventorySchema } from '@/lib/inventory-schema';
import { scanChecklist } from '@/lib/scan-checklist';

export async function GET(request: NextRequest) {
  try {
    await requireAuth(request, ['ADMIN']);
    await ensureInventorySchema();
    const response = ok(await scanChecklist(request.nextUrl.searchParams.get('period')));
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch (error) {
    const auth = authFailure(error);
    if (auth) return fail(auth.message, auth.status);
    if (error instanceof Error && error.message === 'REPORT_EXPIRED') return fail('Daily reports are available for the last 30 completed days. Use a monthly Excel export for older results.', 410);
    if (error instanceof Error && error.message === 'INVALID_REPORT_PERIOD') return fail('Invalid or future checklist period', 400);
    return serverError(error);
  }
}
