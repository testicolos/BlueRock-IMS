import type { NextRequest } from 'next/server';
import { z } from 'zod';

import { authFailure, requireAuth } from '@/lib/auth';
import { db } from '@/lib/db';
import { fail, ok, serverError } from '@/lib/http';
import { ensureInventorySchema } from '@/lib/inventory-schema';

const patchSchema=z.object({
  name:z.string().min(2).max(160).optional(),
  imageUrl:z.string().max(3_500_000).nullable().optional(),
  imageSourceUrl:z.string().url().max(2000).nullable().optional().or(z.literal('')),
  description:z.string().max(2000).nullable().optional(),
});

export async function PATCH(request:NextRequest,{params}:{params:Promise<{id:string}>}) {
  try {
    await requireAuth(request,['ADMIN']); await ensureInventorySchema();
    const {id}=await params; const parsed=patchSchema.safeParse(await request.json());
    if(!parsed.success)return fail('Invalid material update',400,parsed.error.flatten());
    const sql=db(); const current=(await sql`select * from ims_materials where id=${id} limit 1`)[0];
    if(!current)return fail('Material not found',404); const data=parsed.data;
    const rows=await sql`update ims_materials set
      name=${data.name??current.name},image_url=${data.imageUrl===undefined?current.image_url:data.imageUrl},
      image_source_url=${data.imageSourceUrl===undefined?current.image_source_url:(data.imageSourceUrl||null)},
      description=${data.description===undefined?current.description:data.description},updated_at=now()
      where id=${id} returning *`;
    if(data.name) await sql`update ims_inventory_items set name=${data.name},updated_at=now() where material_id=${id}`;
    return ok(rows[0]);
  } catch(error){const auth=authFailure(error);return auth?fail(auth.message,auth.status):serverError(error)}
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
