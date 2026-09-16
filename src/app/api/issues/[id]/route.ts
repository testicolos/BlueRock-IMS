import type { NextRequest } from 'next/server';
import { z } from 'zod';

import { authFailure, requireAuth } from '@/lib/auth';
import { db } from '@/lib/db';
import { fail, ok, serverError } from '@/lib/http';
import { ensureInventorySchema } from '@/lib/inventory-schema';

const schema=z.object({issueType:z.string().min(2).max(120).optional(),description:z.string().min(2).max(2000).optional(),imageUrl:z.string().max(3_500_000).nullable().optional()});

export async function PATCH(request:NextRequest,{params}:{params:Promise<{id:string}>}){try{await requireAuth(request,['ADMIN']);await ensureInventorySchema();const {id}=await params;const parsed=schema.safeParse(await request.json());if(!parsed.success)return fail('Invalid defect update',400,parsed.error.flatten());const sql=db();const current=(await sql`select * from ims_issues where id=${id} limit 1`)[0];if(!current)return fail('Defect not found',404);const d=parsed.data;const rows=await sql`update ims_issues set issue_type=${d.issueType??current.issue_type},description=${d.description??current.description},image_url=${d.imageUrl===undefined?current.image_url:d.imageUrl},updated_at=now() where id=${id} returning *`;return ok(rows[0])}catch(error){const auth=authFailure(error);return auth?fail(auth.message,auth.status):serverError(error)}}
export async function DELETE(request:NextRequest,{params}:{params:Promise<{id:string}>}){try{await requireAuth(request,['ADMIN']);await ensureInventorySchema();const {id}=await params;const rows=await db()`update ims_issues set archived=true,updated_at=now() where id=${id} returning id`;return rows[0]?ok(rows[0]):fail('Defect not found',404)}catch(error){const auth=authFailure(error);return auth?fail(auth.message,auth.status):serverError(error)}}
