import { z } from 'zod';

const assignmentName = z.string().trim().max(160);
const allocationSchema = z.object({ locationId: z.string().uuid(), count: z.number().int().min(1).max(1000) });

export const createMaterialSchema = z.object({
  name: z.string().min(2).max(160),
  code: z.string().min(2).max(12).regex(/^[A-Za-z0-9]+$/),
  inventoryType: z.enum(['TOOL', 'SAMPLE']),
  imageUrl: z.string().max(3_500_000).optional(),
  imageSourceUrl: z.string().url().max(2000).optional().or(z.literal('')),
  description: z.string().max(2000).optional(),
  customerName: assignmentName.optional(),
  employeeName: assignmentName.optional(),
  quantity: z.number().int().min(1).max(1000).optional(),
  allocations: z.array(allocationSchema).max(50).default([]),
}).superRefine((data, ctx) => {
  if (data.inventoryType !== 'SAMPLE') return;
  if (!data.customerName && !data.employeeName) {
    ctx.addIssue({ code: 'custom', path: ['customerName'], message: 'Enter a customer or employee for this sample.' });
  }
  if (data.quantity === undefined) {
    ctx.addIssue({ code: 'custom', path: ['quantity'], message: 'Enter the sample quantity.' });
  }
  if (data.allocations.length) {
    ctx.addIssue({ code: 'custom', path: ['allocations'], message: 'Samples use a customer or employee, not location allocations.' });
  }
});

export const patchMaterialSchema = z.object({
  name: z.string().min(2).max(160).optional(),
  imageUrl: z.string().max(3_500_000).nullable().optional(),
  imageSourceUrl: z.string().url().max(2000).nullable().optional().or(z.literal('')),
  description: z.string().max(2000).nullable().optional(),
  customerName: assignmentName.nullable().optional(),
  employeeName: assignmentName.nullable().optional(),
});

export const generateMaterialUnitsSchema = z.object({
  locationId: z.string().uuid().nullable().optional(),
  quantity: z.number().int().min(1).max(1000),
});

type AssignmentInput = { customerName?: string | null; employeeName?: string | null };
type StoredAssignment = { customer_name?: string | null; employee_name?: string | null };

export function materialAssignment(inventoryType: string, input: AssignmentInput, current: StoredAssignment = {}) {
  if (inventoryType !== 'SAMPLE') return { customerName: null, employeeName: null };
  const customerName = (input.customerName === undefined ? current.customer_name : input.customerName)?.trim() || null;
  const employeeName = (input.employeeName === undefined ? current.employee_name : input.employeeName)?.trim() || null;
  if (!customerName && !employeeName) throw new Error('SAMPLE_ASSIGNMENT_REQUIRED');
  return { customerName, employeeName };
}

export function materialAllocations(data: z.infer<typeof createMaterialSchema>): { locationId: string | null; count: number }[] {
  if (data.inventoryType === 'SAMPLE') {
    // Creation always passes the validated schema, which requires this quantity.
    if (data.quantity === undefined) throw new Error('SAMPLE_QUANTITY_REQUIRED');
    return [{ locationId: null, count: data.quantity }];
  }
  return data.allocations;
}

export function materialUnitLocation(inventoryType: string, locationId?: string | null) {
  if (inventoryType === 'SAMPLE') {
    if (locationId) throw new Error('SAMPLE_LOCATION_NOT_ALLOWED');
    return null;
  }
  if (!locationId) throw new Error('TOOL_LOCATION_REQUIRED');
  return locationId;
}
