import type { NextRequest } from 'next/server';
import { hash } from 'bcryptjs';
import { z } from 'zod';
import { requireAuth,authFailure } from '@/lib/auth';
import { db } from '@/lib/db';
import { fail,ok,serverError } from '@/lib/http';
import { ensureScannerLocationSchema } from '@/lib/scanner-location-schema';

const schema=z.object({
  fullName:z.string().min(2).max(120).optional(),
  role:z.enum(['ADMIN','SCANNER']).optional(),
  active:z.boolean().optional(),
  password:z.string().min(12).max(200).optional(),
  assignedLocationId:z.string().uuid().nullable().optional(),
});

export async function PATCH(request:NextRequest,{params}:{params:Promise<{id:string}>}){
  try{
    const actor=await requireAuth(request,['ADMIN']);
    await ensureScannerLocationSchema();
    const {id}=await params;
    const p=schema.safeParse(await request.json());
    if(!p.success)return fail('Invalid user update',400,p.error.flatten());
    const sql=db();
    const current=(await sql`select * from ims_users where id=${id} limit 1`)[0];
    if(!current)return fail('User not found',404);
    if(actor.id===id&&p.data.active===false)return fail('You cannot disable your own account',409);
    const nextRole=p.data.role??current.role;
    const requestedLocation=p.data.assignedLocationId===undefined?current.assigned_location_id:p.data.assignedLocationId;
    const assignedLocationId=nextRole==='SCANNER'?(requestedLocation??null):null;
    if(assignedLocationId){
      const location=(await sql`select id from ims_locations where id=${assignedLocationId} and active=true limit 1`)[0];
      if(!location)return fail('Assigned location not found or inactive',404);
    }
    const passwordHash=p.data.password?await hash(p.data.password,12):current.password_hash;
    const rows=await sql`
      update ims_users set
        full_name=${p.data.fullName??current.full_name},role=${nextRole},active=${p.data.active??current.active},
        assigned_location_id=${assignedLocationId},password_hash=${passwordHash},updated_at=now()
      where id=${id}
      returning id,username,full_name,role,active,assigned_location_id,last_login_at,updated_at
    `;
    return ok(rows[0])
  }catch(error){const auth=authFailure(error);return auth?fail(auth.message,auth.status):serverError(error)}
}

export async function DELETE(request:NextRequest,{params}:{params:Promise<{id:string}>}){
  try{
    const actor=await requireAuth(request,['ADMIN']);
    await ensureScannerLocationSchema();
    const {id}=await params;
    if(actor.id===id)return fail('You cannot disable your own account',409);
    const rows=await db()`update ims_users set active=false,updated_at=now() where id=${id} returning id,username,full_name,role,active,assigned_location_id`;
    return rows[0]?ok(rows[0]):fail('User not found',404)
  }catch(error){const auth=authFailure(error);return auth?fail(auth.message,auth.status):serverError(error)}
}
