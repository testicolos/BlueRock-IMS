import type { NextRequest } from 'next/server';
import { authFailure, requireAuth } from '@/lib/auth';
import { fail, ok, serverError } from '@/lib/http';
import { ensureInventorySchema } from '@/lib/inventory-schema';
import { scanChecklist } from '@/lib/scan-checklist';
import { reportInventoryType } from '@/lib/scan-report-scope';
import { activeScanSession } from '@/lib/scan-sessions';

export async function GET(request: NextRequest) {
  try {
    await requireAuth(request, ['ADMIN']);
    const inventoryType = reportInventoryType(request.nextUrl.searchParams);
    await ensureInventorySchema();
    const period = request.nextUrl.searchParams.get('period');
    const isCurrent = !period || period === 'current';
    const session = isCurrent && inventoryType !== 'ALL' ? await activeScanSession(inventoryType) : null;
    if (isCurrent && inventoryType !== 'ALL' && !session) return fail('An administrator must start a scan session before opening this checklist.', 409);
    const response = ok(await scanChecklist(period, undefined, inventoryType, session?.id ?? null));
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch (error) {
    const auth = authFailure(error);
    if (auth) return fail(auth.message, auth.status);
    if (error instanceof Error && error.message === 'INVALID_REPORT_INVENTORY_TYPE') return fail('Choose one inventory type: TOOL or SAMPLE', 400);
    if (error instanceof Error && error.message === 'REPORT_EXPIRED') return fail('Daily reports are available for the last 30 completed days. Use a monthly Excel export for older results.', 410);
    if (error instanceof Error && error.message === 'INVALID_REPORT_PERIOD') return fail('Invalid or future checklist period', 400);
    return serverError(error);
  }
}
