import type { NextRequest } from 'next/server';
import { hash } from 'bcryptjs';
import { z } from 'zod';
import { requireAuth,authFailure } from '@/lib/auth';
import { db } from '@/lib/db';
import { fail,ok,serverError } from '@/lib/http';
import { ensureScannerLocationSchema } from '@/lib/scanner-location-schema';

const schema=z.object({
  username:z.string().min(3).max(80),
  password:z.string().min(12).max(200),
  fullName:z.string().min(2).max(120),
  role:z.enum(['ADMIN','SCANNER']).default('SCANNER'),
  assignedLocationId:z.string().uuid().nullable().optional(),
});

export async function GET(request:NextRequest){
  try{
    await requireAuth(request,['ADMIN']);
    await ensureScannerLocationSchema();
    const rows=await db()`
      select u.id,u.username,u.full_name,u.role,u.active,u.assigned_location_id,
        l.name as assigned_location_name,u.last_login_at,u.created_at,u.updated_at
      from ims_users u
      left join ims_locations l on l.id=u.assigned_location_id
      order by u.full_name
    `;
    return ok(rows)
  }catch(error){const auth=authFailure(error);return auth?fail(auth.message,auth.status):serverError(error)}
}

export async function POST(request:NextRequest){
  try{
    await requireAuth(request,['ADMIN']);
    await ensureScannerLocationSchema();
    const p=schema.safeParse(await request.json());
    if(!p.success)return fail('Invalid user',400,p.error.flatten());
    const sql=db();
    const assignedLocationId=p.data.role==='SCANNER'?(p.data.assignedLocationId??null):null;
    if(assignedLocationId){
      const location=(await sql`select id from ims_locations where id=${assignedLocationId} and active=true limit 1`)[0];
      if(!location)return fail('Assigned location not found or inactive',404);
    }
    const passwordHash=await hash(p.data.password,12);
    const rows=await sql`
      insert into ims_users(username,password_hash,full_name,role,assigned_location_id)
      values(${p.data.username},${passwordHash},${p.data.fullName},${p.data.role},${assignedLocationId})
      returning id,username,full_name,role,active,assigned_location_id,created_at
    `;
    return ok(rows[0],201)
  }catch(error){const auth=authFailure(error);return auth?fail(auth.message,auth.status):serverError(error)}
}
