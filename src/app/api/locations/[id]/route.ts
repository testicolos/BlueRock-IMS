import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth, authFailure } from '@/lib/auth';
import { db } from '@/lib/db';
import { fail, ok, serverError } from '@/lib/http';

const patchSchema=z.object({name:z.string().min(2).max(120).optional(),description:z.string().max(500).nullable().optional(),address:z.string().max(300).nullable().optional(),locationType:z.string().max(60).nullable().optional(),active:z.boolean().optional()});

export async function PATCH(request:NextRequest,{params}:{params:Promise<{id:string}>}){try{await requireAuth(request,['ADMIN']);const {id}=await params;const p=patchSchema.safeParse(await request.json());if(!p.success)return fail('Invalid location update',400,p.error.flatten());const sql=db();const current=(await sql`select * from ims_locations where id=${id} limit 1`)[0];if(!current)return fail('Location not found',404);const d=p.data;const rows=await sql`update ims_locations set name=${d.name??current.name},description=${d.description===undefined?current.description:d.description},address=${d.address===undefined?current.address:d.address},location_type=${d.locationType===undefined?current.location_type:d.locationType},active=${d.active??current.active},updated_at=now() where id=${id} returning *`;return ok(rows[0]);}catch(error){const auth=authFailure(error);return auth?fail(auth.message,auth.status):serverError(error)}}
export async function DELETE(request:NextRequest,{params}:{params:Promise<{id:string}>}){try{await requireAuth(request,['ADMIN']);const {id}=await params;const sql=db();const rows=await sql`update ims_locations set active=false,updated_at=now() where id=${id} returning id,name,active`;if(!rows[0])return fail('Location not found',404);return ok(rows[0]);}catch(error){const auth=authFailure(error);return auth?fail(auth.message,auth.status):serverError(error)}}
