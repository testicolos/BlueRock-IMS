import type { NextRequest } from 'next/server';
import ExcelJS from 'exceljs';
import { authFailure, requireAuth } from '@/lib/auth';
import { db } from '@/lib/db';
import { fail, serverError } from '@/lib/http';
import { ensureOfficeInventorySchema } from '@/lib/office-inventory-schema';

export async function GET(request: NextRequest) {
  try {
    await requireAuth(request, ['ADMIN']);
    await ensureOfficeInventorySchema();
    const sessionId = request.nextUrl.searchParams.get('sessionId');
    if (!sessionId) return fail('Validation request is required', 400);
    const sql = db();
    const session = (await sql`
      select s.id,s.status,s.started_at,s.closed_at,starter.full_name as started_by_name,closer.full_name as closed_by_name
      from ims_office_validation_sessions s
      left join ims_users starter on starter.id=s.started_by
      left join ims_users closer on closer.id=s.closed_by
      where s.id=${sessionId} limit 1
    `)[0];
    if (!session) return fail('Validation request not found', 404);
    const rows = await sql`
      select i.barcode,i.name,i.category,i.manufacturer,i.model,i.serial_number,i.owner_name,
        l.name as location_name,i.condition,i.status,t.validated_at,u.full_name as validated_by_name
      from ims_office_validation_targets t
      join ims_office_inventory_items i on i.id=t.inventory_item_id
      left join ims_locations l on l.id=i.current_location_id
      left join ims_users u on u.id=t.validated_by
      where t.session_id=${sessionId}
      order by i.name,i.barcode
    `;
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Office Inventory Validation');
    sheet.addRow(['BlueRock IMS - Office Inventory Validation']);
    sheet.addRow(['Started', session.started_at]);
    sheet.addRow(['Started by', session.started_by_name || 'Administrator']);
    sheet.addRow(['Status', session.status]);
    sheet.addRow(['Closed', session.closed_at || '']);
    sheet.addRow([]);
    sheet.addRow(['Barcode','Item','Category','Manufacturer','Model','Serial Number','Owner','Location','Condition','Asset Status','Validation Result','Validated By','Validated At']);
    for (const row of rows) {
      sheet.addRow([
        row.barcode,row.name,row.category,row.manufacturer || '',row.model || '',row.serial_number || '',
        row.owner_name || '',row.location_name || '',row.condition,row.status,row.validated_at ? 'VALIDATED' : 'NOT VALIDATED',
        row.validated_by_name || '',row.validated_at || '',
      ]);
    }
    sheet.getRow(1).font = { bold: true, size: 16 };
    sheet.getRow(7).font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: 7 }];
    sheet.columns.forEach(column => { column.width = Math.min(32, Math.max(12, ...(column.values || []).map(value => String(value || '').length + 2))); });
    const buffer = await workbook.xlsx.writeBuffer();
    const stamp = new Date(session.started_at).toISOString().slice(0,10);
    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="BlueRock-Office-Inventory-'+stamp+'.xlsx"',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const auth = authFailure(error);
    return auth ? fail(auth.message, auth.status) : serverError(error);
  }
}
