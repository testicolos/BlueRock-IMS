import type { NextRequest } from 'next/server';

import { authFailure, requireAuth } from '@/lib/auth';
import { db } from '@/lib/db';
import { fail, ok, serverError } from '@/lib/http';
import { ensureInventorySchema } from '@/lib/inventory-schema';
import { generateMaterialUnitsSchema, materialAssignment, materialUnitLocation } from '@/lib/material-validation';

export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}) {
  try {
    const actor=await requireAuth(request,['ADMIN']); await ensureInventorySchema();
    const {id}=await params; const parsed=generateMaterialUnitsSchema.safeParse(await request.json());
    if(!parsed.success)return fail('Invalid unit request',400,parsed.error.flatten());
    const result=await db().begin(async tx=>{
      const material=(await tx`select * from ims_materials where id=${id} and active=true limit 1 for update`)[0];
      if(!material)throw new Error('MATERIAL_NOT_FOUND');
      materialAssignment(material.inventory_type,{},material);
      const locationId=materialUnitLocation(material.inventory_type,parsed.data.locationId);
      if(locationId){
        const location=(await tx`select id from ims_locations where id=${locationId} and active=true limit 1`)[0];
        if(!location)throw new Error('LOCATION_NOT_FOUND');
      }
      const maximum=(await tx`select coalesce(max(unit_number),0)::int as value from ims_inventory_items where material_id=${id}`)[0].value as number;
      const prefix=material.inventory_type==='TOOL'?'TL':'SP'; const barcodes:string[]=[];
      for(let offset=1;offset<=parsed.data.quantity;offset+=1){
        const unitNumber=maximum+offset; const barcode=`${prefix}-${material.code}-${String(unitNumber).padStart(4,'0')}`;
        await tx`insert into ims_inventory_items(barcode,inventory_type,name,material_id,unit_number,current_location_id,condition,status,created_by)
          values(${barcode},${material.inventory_type},${material.name},${id},${unitNumber},${locationId},'GOOD','ACTIVE',${actor.id})`;
        barcodes.push(barcode);
      }
      return {barcodes};
    });
    return ok(result,201);
  }catch(error){
    const auth=authFailure(error);if(auth)return fail(auth.message,auth.status);
    if(error instanceof Error){
      if(error.message==='MATERIAL_NOT_FOUND')return fail('Material not found',404);
      if(error.message==='LOCATION_NOT_FOUND')return fail('Location not found',404);
      if(error.message==='TOOL_LOCATION_REQUIRED')return fail('Select a location for these material units.',400);
      if(error.message==='SAMPLE_LOCATION_NOT_ALLOWED')return fail('Samples use a customer or employee, not a location.',400);
      if(error.message==='SAMPLE_ASSIGNMENT_REQUIRED')return fail('Edit this sample and enter a customer or employee before adding units.',400);
    }
    return serverError(error);
  }
}
