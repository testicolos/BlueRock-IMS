import type { NextRequest } from 'next/server';
import { authFailure, requireAuth } from '@/lib/auth';
import { fail, ok, serverError } from '@/lib/http';
import { scannerAccessAllows, scannerAccessForUser } from '@/lib/scanner-access';

export async function GET(request: NextRequest) {
  try {
    const actor = await requireAuth(request);
    const scanAccess = await scannerAccessForUser(actor);
    return ok({
      scanAccess,
      materials: scannerAccessAllows(scanAccess, 'MATERIALS'),
      office: scannerAccessAllows(scanAccess, 'OFFICE'),
    });
  } catch (error) {
    const auth = authFailure(error);
    if (auth) return fail(auth.message, auth.status);
    if (error instanceof Error && error.message === 'SCANNER_ACCOUNT_NOT_FOUND') return fail('Scanner account not found or inactive', 403);
    return serverError(error);
  }
}
