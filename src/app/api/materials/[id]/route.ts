import type { NextRequest } from 'next/server';

import { authFailure, requireAuth } from '@/lib/auth';
import { db } from '@/lib/db';
import { fail, ok, serverError } from '@/lib/http';
import { ensureInventorySchema } from '@/lib/inventory-schema';
import { materialAssignment, patchMaterialSchema } from '@/lib/material-validation';

export async function PATCH(request:NextRequest,{params}:{params:Promise<{id:string}>}) {
  try {
    await requireAuth(request,['ADMIN']); await ensureInventorySchema();
    const {id}=await params; const parsed=patchMaterialSchema.safeParse(await request.json());
    if(!parsed.success)return fail('Invalid material update',400,parsed.error.flatten());
    const data=parsed.data;
    const result=await db().begin(async sql=>{
      // The merged assignment must be checked while locked, otherwise two
      // simultaneous edits could each remove the last remaining assignee.
      const current=(await sql`select * from ims_materials where id=${id} limit 1 for update`)[0];
      if(!current)return null;
      const assignment=materialAssignment(current.inventory_type,data,current);
      const rows=await sql`update ims_materials set
        name=${data.name??current.name},image_url=${data.imageUrl===undefined?current.image_url:data.imageUrl},
        image_source_url=${data.imageSourceUrl===undefined?current.image_source_url:(data.imageSourceUrl||null)},
        description=${data.description===undefined?current.description:data.description},
        customer_name=${assignment.customerName},employee_name=${assignment.employeeName},updated_at=now()
        where id=${id} returning *`;
      if(data.name) await sql`update ims_inventory_items set name=${data.name},updated_at=now() where material_id=${id}`;
      return rows[0];
    });
    return result?ok(result):fail('Material not found',404);
  } catch(error){
    const auth=authFailure(error);
    if(auth)return fail(auth.message,auth.status);
    if(error instanceof Error&&error.message==='SAMPLE_ASSIGNMENT_REQUIRED')return fail('Enter a customer or employee for this sample.',400);
    return serverError(error);
  }
}

export async function DELETE(request:NextRequest,{params}:{params:Promise<{id:string}>}) {
  try {
    await requireAuth(request,['ADMIN']); await ensureInventorySchema(); const {id}=await params;
    const result=await db().begin(async tx=>{
      const rows=await tx`update ims_materials set active=false,updated_at=now() where id=${id} returning id,name`;
      if(!rows[0])return null;
      await tx`update ims_inventory_items set archived=true,status='RETIRED',updated_at=now() where material_id=${id}`;
      return rows[0];
    });
    return result?ok(result):fail('Material not found',404);
  } catch(error){const auth=authFailure(error);return auth?fail(auth.message,auth.status):serverError(error)}
}
