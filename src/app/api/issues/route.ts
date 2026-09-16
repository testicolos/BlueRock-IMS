import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth,authFailure } from '@/lib/auth';
import { db } from '@/lib/db';
import { fail,ok,serverError } from '@/lib/http';
import { ensureInventorySchema } from '@/lib/inventory-schema';
const schema=z.discriminatedUnion('action',[
  z.object({action:z.literal('resolve'),issueId:z.string().uuid(),resolutionNote:z.string().min(2).max(2000)}),
  z.object({action:z.literal('create'),inventoryItemId:z.string().uuid(),issueType:z.string().min(2).max(120),description:z.string().min(2).max(2000),imageUrl:z.string().max(3_500_000).optional()}),
]);
export async function GET(request:NextRequest){try{await requireAuth(request,['ADMIN']);await ensureInventorySchema();const rows=await db()`select x.*,i.barcode,i.name,i.inventory_type,m.image_url as material_image_url,l.name as location_name,u.full_name as reported_by_name from ims_issues x join ims_inventory_items i on i.id=x.inventory_item_id left join ims_materials m on m.id=i.material_id left join ims_locations l on l.id=i.current_location_id left join ims_users u on u.id=x.reported_by where x.archived=false order by x.reported_at desc`;return ok(rows)}catch(error){const auth=authFailure(error);return auth?fail(auth.message,auth.status):serverError(error)}}
export async function POST(request:NextRequest){try{const actor=await requireAuth(request,['ADMIN']);await ensureInventorySchema();const p=schema.safeParse(await request.json());if(!p.success)return fail('Invalid defect request',400,p.error.flatten());if(p.data.action==='resolve'){const rows=await db()`update ims_issues set status='RESOLVED',resolved_by=${actor.id},resolution_note=${p.data.resolutionNote},resolved_at=now(),updated_at=now() where id=${p.data.issueId} and status='OPEN' returning *`;if(!rows[0])return fail('Open defect not found',404);return ok(rows[0])}const rows=await db()`insert into ims_issues(inventory_item_id,reported_by,issue_type,description,image_url) values(${p.data.inventoryItemId},${actor.id},${p.data.issueType},${p.data.description},${p.data.imageUrl??null}) returning *`;await db()`update ims_inventory_items set condition='DAMAGED',updated_at=now() where id=${p.data.inventoryItemId}`;return ok(rows[0],201)}catch(error){const auth=authFailure(error);return auth?fail(auth.message,auth.status):serverError(error)}}
