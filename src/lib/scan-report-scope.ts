export type ReportInventoryType = 'ALL' | 'TOOL' | 'SAMPLE';

export function reportInventoryType(params: URLSearchParams): ReportInventoryType {
  const values = params.getAll('inventoryType');
  if (!values.length) return 'ALL';
  if (values.length !== 1 || (values[0] !== 'TOOL' && values[0] !== 'SAMPLE')) {
    throw new Error('INVALID_REPORT_INVENTORY_TYPE');
  }
  return values[0];
}

export function reportScopeLabel(inventoryType: ReportInventoryType): string {
  return inventoryType === 'SAMPLE' ? 'Samples' : inventoryType === 'TOOL' ? 'Materials' : 'Scan';
}

export function scopedReportRows<T extends { inventory_type: string }>(rows: T[], inventoryType: ReportInventoryType): T[] {
  return inventoryType === 'ALL' ? rows : rows.filter(row => row.inventory_type === inventoryType);
}
