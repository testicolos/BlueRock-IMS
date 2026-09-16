import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth,authFailure } from '@/lib/auth';
import { db } from '@/lib/db';
import { fail,ok,serverError } from '@/lib/http';
const schema=z.object({issueId:z.string().uuid(),resolutionNote:z.string().min(2).max(2000)});
export async function GET(request:NextRequest){try{await requireAuth(request,['ADMIN']);const rows=await db()`select x.*,i.barcode,i.name,i.inventory_type,l.name as location_name,u.full_name as reported_by_name from ims_issues x join ims_inventory_items i on i.id=x.inventory_item_id left join ims_locations l on l.id=i.current_location_id left join ims_users u on u.id=x.reported_by order by x.reported_at desc`;return ok(rows)}catch(error){const auth=authFailure(error);return auth?fail(auth.message,auth.status):serverError(error)}}
export async function POST(request:NextRequest){try{const actor=await requireAuth(request,['ADMIN']);const p=schema.safeParse(await request.json());if(!p.success)return fail('Invalid issue resolution',400,p.error.flatten());const rows=await db()`update ims_issues set status='RESOLVED',resolved_by=${actor.id},resolution_note=${p.data.resolutionNote},resolved_at=now(),updated_at=now() where id=${p.data.issueId} and status='OPEN' returning *`;if(!rows[0])return fail('Open issue not found',404);return ok(rows[0])}catch(error){const auth=authFailure(error);return auth?fail(auth.message,auth.status):serverError(error)}}
