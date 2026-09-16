import type { NextRequest } from 'next/server';
import { hash } from 'bcryptjs';
import { z } from 'zod';
import { requireAuth,authFailure } from '@/lib/auth';
import { db } from '@/lib/db';
import { fail,ok,serverError } from '@/lib/http';
const schema=z.object({username:z.string().min(3).max(80),password:z.string().min(12).max(200),fullName:z.string().min(2).max(120),role:z.enum(['ADMIN','SCANNER']).default('SCANNER')});
export async function GET(request:NextRequest){try{await requireAuth(request,['ADMIN']);const rows=await db()`select id,username,full_name,role,active,last_login_at,created_at,updated_at from ims_users order by full_name`;return ok(rows)}catch(error){const auth=authFailure(error);return auth?fail(auth.message,auth.status):serverError(error)}}
export async function POST(request:NextRequest){try{await requireAuth(request,['ADMIN']);const p=schema.safeParse(await request.json());if(!p.success)return fail('Invalid user',400,p.error.flatten());const passwordHash=await hash(p.data.password,12);const rows=await db()`insert into ims_users(username,password_hash,full_name,role) values(${p.data.username},${passwordHash},${p.data.fullName},${p.data.role}) returning id,username,full_name,role,active,created_at`;return ok(rows[0],201)}catch(error){const auth=authFailure(error);return auth?fail(auth.message,auth.status):serverError(error)}}
