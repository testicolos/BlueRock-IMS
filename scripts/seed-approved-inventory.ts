import { db } from '../src/lib/db';
import { seedApprovedInventory } from '../src/lib/seed-inventory';

async function main(){
  const sql=db();
  const admin=(await sql`select id from ims_users where role='ADMIN' and active=true order by created_at limit 1`)[0];
  if(!admin)throw new Error('Create an active administrator before seeding inventory');
  const result=await seedApprovedInventory(String(admin.id));
  console.log(JSON.stringify(result));
  await sql.end();
}

void main();
