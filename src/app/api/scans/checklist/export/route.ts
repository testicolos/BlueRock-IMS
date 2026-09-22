import type { NextRequest } from 'next/server';
import { errors as joseErrors } from 'jose';
import { authFailure, requireAuth } from '@/lib/auth';
import { fail, serverError } from '@/lib/http';
import { ensureInventorySchema } from '@/lib/inventory-schema';
import { scanChecklist, scanMonthlyReport } from '@/lib/scan-checklist';
import { buildDailyScanWorkbook, buildMonthlyScanWorkbook } from '@/lib/scan-report-xlsx';
import { reportInventoryType, reportScopeLabel } from '@/lib/scan-report-scope';
import { activeScanSession } from '@/lib/scan-sessions';

export const runtime = 'nodejs';
export const maxDuration = 60;

function exportFailure(message: string, status: number) {
  const response = fail(message, status);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

export async function GET(request: NextRequest) {
  try {
    await requireAuth(request, ['ADMIN']);
    const params = request.nextUrl.searchParams;
    const inventoryType = reportInventoryType(params);
    const scopeLabel = reportScopeLabel(inventoryType);
    if (params.getAll('period').length > 1 || params.getAll('month').length > 1 || (params.has('period') && params.has('month'))) {
      return exportFailure('Choose exactly one daily period or month', 400);
    }
    const month = params.get('month');
    const period = params.get('period');
    if (month !== null && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return exportFailure('Invalid report month', 400);
    if (period !== null && period !== 'current' && (!/^\d{4}-\d{2}-\d{2}T/.test(period) || !Number.isFinite(Date.parse(period)))) {
      return exportFailure('Invalid report period', 400);
    }
    await ensureInventorySchema();
    let workbook;
    let filename;
    if (month !== null) {
      workbook = buildMonthlyScanWorkbook(await scanMonthlyReport(month, undefined, inventoryType));
      filename = `BlueRock-${scopeLabel}-Monthly-${month}.xlsx`;
    } else {
      const isCurrent = !period || period === 'current';
      const session = isCurrent && inventoryType !== 'ALL' ? await activeScanSession(inventoryType) : null;
      const report = await scanChecklist(period, undefined, inventoryType, session?.id ?? null);
      workbook = buildDailyScanWorkbook(report);
      filename = `BlueRock-${scopeLabel}-Daily-${report.reportDate}${report.current ? '-provisional' : ''}.xlsx`;
    }
    const bytes = await workbook.xlsx.writeBuffer();
    return new Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    const auth = authFailure(error);
    if (auth) return exportFailure(auth.message, auth.status);
    if (error instanceof joseErrors.JOSEError) return exportFailure('Authentication required', 401);
    if (error instanceof Error) {
      if (error.message === 'INVALID_REPORT_INVENTORY_TYPE') return exportFailure('Choose one inventory type: TOOL or SAMPLE', 400);
      if (error.message === 'REPORT_EXPIRED') return exportFailure('Daily reports are available for the last 30 completed days. Use the monthly export for older results.', 410);
      if (error.message === 'INVALID_REPORT_PERIOD') return exportFailure('Invalid or future checklist period', 400);
      if (error.message === 'INVALID_REPORT_MONTH') return exportFailure('Invalid, future, or unavailable report month', 400);
    }
    const response = serverError(error);
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  }
}
