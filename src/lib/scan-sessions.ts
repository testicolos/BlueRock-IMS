import { db } from '@/lib/db';

export type ScanSessionInventoryType = 'TOOL' | 'SAMPLE';
export type ScanSession = {
  id: string;
  inventory_type: ScanSessionInventoryType;
  status: 'OPEN' | 'CLOSED';
  started_by: string;
  started_by_name: string | null;
  started_at: string;
  closed_by: string | null;
  closed_at: string | null;
};

export async function activeScanSessions(sql = db()): Promise<ScanSession[]> {
  return sql<ScanSession[]>`
    select s.id,s.inventory_type,s.status,s.started_by,u.full_name as started_by_name,
      s.started_at,s.closed_by,s.closed_at
    from ims_scan_sessions s
    left join ims_users u on u.id=s.started_by
    where s.status='OPEN'
    order by s.inventory_type,s.started_at desc
  `;
}

export async function activeScanSession(inventoryType: ScanSessionInventoryType, sql = db()): Promise<ScanSession | null> {
  return (await sql<ScanSession[]>`
    select s.id,s.inventory_type,s.status,s.started_by,u.full_name as started_by_name,
      s.started_at,s.closed_by,s.closed_at
    from ims_scan_sessions s
    left join ims_users u on u.id=s.started_by
    where s.status='OPEN' and s.inventory_type=${inventoryType}
    order by s.started_at desc limit 1
  `)[0] ?? null;
}
