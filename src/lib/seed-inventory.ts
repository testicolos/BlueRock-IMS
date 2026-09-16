import { db } from '@/lib/db';
import { ensureInventorySchema } from '@/lib/inventory-schema';

type SeedMaterial = {
  name: string;
  code: string;
  image: string;
  source: string;
  allocations: [string, number][];
};

export const APPROVED_LOCATIONS = [
  { name: 'AL Baker', code: 'ALB' },
  { name: 'Al Thumama', code: 'THU' },
  { name: 'Sultan', code: 'SUL' },
  { name: 'Seef', code: 'SEE' },
  { name: 'Glitch', code: 'GLI' },
] as const;

const wiki = (file: string) => `https://commons.wikimedia.org/wiki/File:${file}`;

export const APPROVED_MATERIALS: SeedMaterial[] = [
  { name:'Scaffolding Sets', code:'SCF', image:'/materials/scaffolding.jpg', source:'https://en.wikipedia.org/wiki/Scaffolding', allocations:[['ALB',20],['THU',40],['SUL',38]] },
  { name:'Aluminium Scaffolding Sets', code:'ASC', image:'/materials/scaffolding.jpg', source:'https://en.wikipedia.org/wiki/Scaffolding', allocations:[['SUL',2],['SEE',2],['GLI',2]] },
  { name:'Ladder', code:'LDR', image:'/materials/ladder.webp', source:'https://en.wikipedia.org/wiki/Ladder', allocations:[['ALB',2],['THU',3],['SUL',3],['GLI',3]] },
  { name:'Wheelbarrow', code:'WBR', image:'/materials/wheelbarrow.jpg', source:'https://en.wikipedia.org/wiki/Wheelbarrow', allocations:[['ALB',3],['THU',2],['SUL',2]] },
  { name:'Big Grinder', code:'BGR', image:'/materials/grinder.jpg', source:'https://en.wikipedia.org/wiki/Angle_grinder', allocations:[['ALB',1],['SUL',1]] },
  { name:'Small Grinder', code:'SGR', image:'/materials/grinder.jpg', source:'https://en.wikipedia.org/wiki/Angle_grinder', allocations:[['ALB',2],['SUL',1],['SEE',2],['GLI',2]] },
  { name:'PPR Welder', code:'PPR', image:'/materials/ppr-welder.jpg', source:wiki('Manual_hydraulic_hot_melt_welding_machine.jpg'), allocations:[['ALB',1],['THU',1],['SUL',2]] },
  { name:'Welding Machine', code:'WLD', image:'/materials/welding-machine.jpg', source:wiki('SMAW_Welding_machine-1.jpg'), allocations:[['SUL',1]] },
  { name:'Battery Drill', code:'BDR', image:'/materials/cordless-drill.jpg', source:wiki('Panasonic_Cordless_Drill_%26_Driver_EY1DD2,_Ottobrunn_(20250410-P1046293).jpg'), allocations:[['ALB',1],['THU',1],['SUL',1],['SEE',2],['GLI',2]] },
  { name:'Corded Drill', code:'CDR', image:'/materials/drill.png', source:'https://en.wikipedia.org/wiki/Drill', allocations:[['ALB',1]] },
  { name:'Small Impact Drill', code:'SID', image:'/materials/impact-driver.png', source:'https://en.wikipedia.org/wiki/Impact_driver', allocations:[['ALB',2],['GLI',1]] },
  { name:'Medium Impact Drill', code:'MID', image:'/materials/impact-driver.png', source:'https://en.wikipedia.org/wiki/Impact_driver', allocations:[['ALB',1],['THU',1],['SUL',1]] },
  { name:'Small Jackhammer', code:'SJH', image:'/materials/jackhammer.jpg', source:'https://en.wikipedia.org/wiki/Rotary_hammer', allocations:[['ALB',1],['THU',1]] },
  { name:'Spirit Level', code:'SPL', image:'/materials/spirit-level.jpg', source:wiki('Waterpass.jpg'), allocations:[['ALB',6],['THU',2],['SUL',4],['GLI',2]] },
  { name:'Jack Support', code:'JSP', image:'/materials/jack-support.jpg', source:wiki('Trolley_jack_and_axle_stands.jpg'), allocations:[['ALB',300]] },
  { name:'Laser Level', code:'LSL', image:'/materials/laser-level.jpg', source:wiki('Construction_laser.jpg'), allocations:[['ALB',1]] },
  { name:'Spanner Set', code:'SPS', image:'/materials/spanner-set.jpg', source:wiki('Spanner_set.jpg'), allocations:[['ALB',1]] },
  { name:'Small Generator 3 kVA', code:'G3K', image:'/materials/generator.jpg', source:wiki('Cummins_Generator.jpg'), allocations:[['ALB',1],['THU',1],['SUL',1]] },
  { name:'Medium Generator 5 kVA', code:'G5K', image:'/materials/generator.jpg', source:wiki('Cummins_Generator.jpg'), allocations:[['ALB',2],['THU',1]] },
  { name:'Big Generator', code:'BGN', image:'/materials/generator.jpg', source:wiki('Cummins_Generator.jpg'), allocations:[['SUL',1]] },
  { name:'Shovel', code:'SHV', image:'/materials/shovel.png', source:wiki('Shovel_(PSF).png'), allocations:[['ALB',6],['THU',5],['SUL',7]] },
  { name:'Air Compressor', code:'ACP', image:'/materials/air-compressor.webp', source:wiki('Air_compressor.webp'), allocations:[['SUL',1]] },
  { name:'Sanding Machine', code:'SDM', image:'/materials/sander.jpg', source:wiki('Random_orbit_sander.jpg'), allocations:[['THU',1],['SEE',7]] },
  { name:'Jigsaw', code:'JSW', image:'/materials/jigsaw.jpg', source:wiki('Makita_4350FCT_Jigsaw.jpg'), allocations:[['SEE',1]] },
  { name:'Tile Glue Mixer', code:'TGM', image:'/materials/tile-mixer.png', source:wiki('Cement_Mixer.png'), allocations:[['ALB',1],['THU',1],['SEE',1]] },
  { name:'Tile Cutter', code:'TLC', image:'/materials/tile-cutter.jpg', source:wiki('RUBI_TX_Tille_Cutter.jpg'), allocations:[['ALB',1],['THU',1]] },
  { name:'Circular Saw', code:'CSW', image:'/materials/circular-saw.jpg', source:'https://en.wikipedia.org/wiki/Circular_saw', allocations:[['ALB',1],['GLI',1]] },
];

export async function seedApprovedInventory(actorId: string) {
  await ensureInventorySchema();
  const sql = db();
  return sql.begin(async (tx) => {
    const locationIds = new Map<string,string>();
    for (const location of APPROVED_LOCATIONS) {
      const rows = await tx`insert into ims_locations(name,code,location_type,active,created_by)
        values(${location.name},${location.code},'Project location',true,${actorId})
        on conflict(code) do update set name=excluded.name,active=true,updated_at=now()
        returning id,code`;
      locationIds.set(String(rows[0].code), String(rows[0].id));
    }

    const unitRows: Array<{
      barcode:string; inventory_type:'TOOL'; name:string; material_id:string; unit_number:number;
      current_location_id:string; condition:'GOOD'; status:'ACTIVE'; created_by:string;
    }> = [];
    for (const material of APPROVED_MATERIALS) {
      const rows = await tx`insert into ims_materials(inventory_type,name,code,image_url,image_source_url,description,active,created_by)
        values('TOOL',${material.name},${material.code},${material.image},${material.source},'Imported from the approved BlueRock equipment sheet.',true,${actorId})
        on conflict(code) do update set name=excluded.name,image_url=excluded.image_url,image_source_url=excluded.image_source_url,active=true,updated_at=now()
        returning id`;
      const materialId = String(rows[0].id);
      let unitNumber = 1;
      for (const [locationCode, count] of material.allocations) {
        const locationId = locationIds.get(locationCode);
        if (!locationId) throw new Error(`Missing location ${locationCode}`);
        for (let index = 0; index < count; index += 1) {
          const barcode = `TL-${material.code}-${String(unitNumber).padStart(4,'0')}`;
          unitRows.push({barcode,inventory_type:'TOOL',name:material.name,material_id:materialId,unit_number:unitNumber,current_location_id:locationId,condition:'GOOD',status:'ACTIVE',created_by:actorId});
          unitNumber += 1;
        }
      }
    }
    const inserted = await tx`insert into ims_inventory_items ${tx(unitRows,'barcode','inventory_type','name','material_id','unit_number','current_location_id','condition','status','created_by')}
      on conflict(barcode) do update set material_id=excluded.material_id,unit_number=excluded.unit_number,name=excluded.name,inventory_type=excluded.inventory_type,updated_at=now()
      returning (xmax = 0) as inserted`;
    const insertedUnits=inserted.filter(row=>row.inserted).length;
    const requestedUnits=unitRows.length;
    await tx`insert into ims_audit_logs(user_id,action,entity,new_value)
      values(${actorId},'IMPORT_APPROVED_INVENTORY','inventory_import',${tx.json({materials:APPROVED_MATERIALS.length,units:requestedUnits})})`;
    return { locations: APPROVED_LOCATIONS.length, materials: APPROVED_MATERIALS.length, requestedUnits, insertedUnits };
  });
}
