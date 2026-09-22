'use client';

import JsBarcode from 'jsbarcode';
import { Barcode, Edit3, History, PlayCircle, Plus, Printer, Search, Square, Trash2, X } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';

type Location={id:string;name:string;code:string};
type OfficeItem={id:string;barcode:string;name:string;category:string;manufacturer?:string|null;model?:string|null;serial_number?:string|null;owner_name?:string|null;current_location_id?:string|null;location_name?:string|null;condition:string;status:string;last_validated_at?:string|null;validation_status?:'VALIDATED'|'PENDING'};
type Session={id:string;status:'OPEN'|'CLOSED';started_at:string;closed_at?:string|null;started_by_name?:string|null;closed_by_name?:string|null;total:number;validated:number};
type Target={id:string;barcode:string;name:string;category:string;owner_name?:string|null;location_name?:string|null;condition:string;status:string;validated_at?:string|null;validated_by_name?:string|null};
type Api=<T>(url:string,options?:RequestInit)=>Promise<T>;
type SessionResponse={sessions:Session[];sessionId:string|null;targets:Target[]};
type OwnerRow={id:string;previous_owner?:string|null;new_owner?:string|null;changed_by_name?:string|null;changed_at:string};

const conditions=['GOOD','MINOR_ISSUE','DAMAGED','MISSING_PARTS','NEEDS_MAINTENANCE'];
const statuses=['ACTIVE','INACTIVE','MAINTENANCE','LOST','RETIRED'];
const categories=['Laptop','Desktop','Monitor','Printer','Scanner','Mobile Phone','Tablet','Network Device','UPS','Accessory / Peripheral','Other'];

export default function OfficeInventory({locations,api,notify}:{locations:Location[];api:Api;notify:(message:string)=>void}){
  const[items,setItems]=useState<OfficeItem[]>([]);
  const[sessions,setSessions]=useState<Session[]>([]);
  const[targets,setTargets]=useState<Target[]>([]);
  const[selectedSessionId,setSelectedSessionId]=useState('');
  const[query,setQuery]=useState('');
  const[status,setStatus]=useState<'ALL'|'VALIDATED'|'PENDING'>('ALL');
  const[modal,setModal]=useState<'add'|'edit'|'history'|''>('');
  const[selected,setSelected]=useState<OfficeItem|null>(null);
  const[history,setHistory]=useState<OwnerRow[]>([]);
  const[busy,setBusy]=useState(false);
  const[error,setError]=useState('');
  const[printItem,setPrintItem]=useState<OfficeItem|null>(null);

  async function load(sessionId?:string){
    setError('');
    try{
      const [inventory,validation]=await Promise.all([
        api<OfficeItem[]>('/api/office-inventory',{cache:'no-store'}),
        api<SessionResponse>('/api/office-validation-sessions'+(sessionId?'?sessionId='+encodeURIComponent(sessionId):''),{cache:'no-store'}),
      ]);
      setItems(inventory);setSessions(validation.sessions);setTargets(validation.targets);setSelectedSessionId(validation.sessionId||'');
    }catch(reason){setError(reason instanceof Error?reason.message:'Unable to load Office Inventory')}
  }
  useEffect(()=>{void load()},[]);
  useEffect(()=>{const timer=window.setInterval(()=>void load(selectedSessionId||undefined),60_000);return()=>window.clearInterval(timer)},[selectedSessionId]);

  const active=sessions.find(row=>row.status==='OPEN');
  const shown=useMemo(()=>items.filter(item=>{
    const term=query.trim().toLowerCase();
    const searchable=[item.barcode,item.name,item.category,item.manufacturer||'',item.model||'',item.serial_number||'',item.owner_name||'',item.location_name||''].join(' ').toLowerCase();
    return (status==='ALL'||item.validation_status===status)&&(!term||searchable.includes(term));
  }),[items,query,status]);

  async function start(){
    if(busy)return;setBusy(true);setError('');
    try{await api('/api/office-validation-sessions',{method:'POST',body:JSON.stringify({})});notify('Office Inventory validation request started');await load()}
    catch(reason){setError(reason instanceof Error?reason.message:'Unable to start validation request')}finally{setBusy(false)}
  }
  async function close(){
    if(!active||busy)return;
    if(!window.confirm('End the active Office Inventory validation request? Pending items will remain recorded as not validated.'))return;
    setBusy(true);setError('');
    try{await api('/api/office-validation-sessions',{method:'PATCH',body:JSON.stringify({id:active.id,action:'close'})});notify('Office Inventory validation request closed');await load(active.id)}
    catch(reason){setError(reason instanceof Error?reason.message:'Unable to close validation request')}finally{setBusy(false)}
  }
  async function remove(item:OfficeItem){
    if(!window.confirm('Archive '+item.name+' ('+item.barcode+')? Validation and owner history will be preserved.'))return;
    try{await api('/api/office-inventory/'+item.id,{method:'DELETE'});notify(item.barcode+' archived');await load(selectedSessionId||undefined)}
    catch(reason){setError(reason instanceof Error?reason.message:'Unable to archive item')}
  }
  async function exportSession(){
    if(!selectedSessionId)return;
    setError('');
    try{
      const token=localStorage.getItem('br_token')||'';
      const response=await fetch('/api/office-validation-sessions/export?sessionId='+encodeURIComponent(selectedSessionId),{headers:{Authorization:'Bearer '+token}});
      if(!response.ok){const body=await response.json().catch(()=>null);throw new Error(body?.error?.message||'Unable to export validation report')}
      const blob=await response.blob();const url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download='BlueRock-Office-Inventory.xlsx';anchor.click();URL.revokeObjectURL(url);
    }catch(reason){setError(reason instanceof Error?reason.message:'Unable to export validation report')}
  }
  async function showHistory(item:OfficeItem){
    setSelected(item);setError('');
    try{const result=await api<{item:OfficeItem;ownerHistory:OwnerRow[]}>('/api/office-inventory/'+item.id);setHistory(result.ownerHistory);setModal('history')}
    catch(reason){setError(reason instanceof Error?reason.message:'Unable to load owner history')}
  }

  return <>
    <section className="pageHero"><div><span className="eyebrow">OFFICE ASSET CONTROL</span><h2>Office Inventory</h2><p>Laptops, printers, displays and other office devices. Barcode validation only — no transfer workflow.</p></div><div className="officeHeroActions"><button className="secondary" onClick={()=>{setSelected(null);setModal('add')}}><Plus size={17}/> Add office item</button>{active?<><a className="primary" href="/office-scan"><Barcode size={17}/> Open validation scanner</a><button className="secondary" disabled={busy} onClick={()=>void close()}><Square size={16}/> End validation</button></>:<button className="primary" disabled={busy} onClick={()=>void start()}><PlayCircle size={17}/> Start validation request</button>}</div></section>
    {error&&<div className="error" role="alert">{error}</div>}
    {active&&<section className="panel"><div className="panelHead"><div><h2>Active validation request</h2><p>Started {formatDate(active.started_at)} by {active.started_by_name||'Administrator'}</p></div><strong>{active.validated}/{active.total} validated</strong></div><div style={{height:10,borderRadius:10,overflow:'hidden',background:'#e7e3da'}}><div style={{height:'100%',width:(active.total?Math.round(active.validated/active.total*100):0)+'%',background:'currentColor'}}/></div></section>}
    <section className="toolbar"><label className="search"><Search size={17}/><input placeholder="Search barcode, device, owner, serial, location…" value={query} onChange={e=>setQuery(e.target.value)}/></label><div className="segmented"><button className={status==='ALL'?'active':''} onClick={()=>setStatus('ALL')}>All</button><button className={status==='VALIDATED'?'active':''} onClick={()=>setStatus('VALIDATED')}>Validated</button><button className={status==='PENDING'?'active':''} onClick={()=>setStatus('PENDING')}>Pending</button></div></section>
    <section className="panel"><div className="tableScroll"><table><thead><tr><th>Barcode</th><th>Item</th><th>Category</th><th>Manufacturer / Model</th><th>Serial</th><th>Owner</th><th>Location</th><th>Condition</th><th>Status</th><th>Last validated</th><th>Validation</th><th/></tr></thead><tbody>{shown.map(item=><tr key={item.id}><td><code>{item.barcode}</code></td><td><strong>{item.name}</strong></td><td>{item.category}</td><td>{[item.manufacturer,item.model].filter(Boolean).join(' / ')||'—'}</td><td>{item.serial_number||'—'}</td><td><strong>{item.owner_name||'Unassigned'}</strong></td><td>{item.location_name||'Unassigned'}</td><td>{pretty(item.condition)}</td><td>{pretty(item.status)}</td><td>{formatDate(item.last_validated_at||undefined)}</td><td>{active?(item.validation_status==='VALIDATED'?'Validated':'Pending'):'—'}</td><td><div className="tableActions"><button title="Print barcode" onClick={()=>{setPrintItem(item);setTimeout(()=>window.print(),80)}}><Printer size={15}/></button><button title="Owner history" onClick={()=>void showHistory(item)}><History size={15}/></button><button title="Edit office item" onClick={()=>{setSelected(item);setModal('edit')}}><Edit3 size={15}/></button><button className="dangerButton" title="Archive office item" onClick={()=>void remove(item)}><Trash2 size={15}/></button></div></td></tr>)}</tbody></table>{shown.length===0&&<div className="empty"><strong>No office inventory items match the current filters.</strong></div>}</div></section>
    <section className="panel"><div className="panelHead"><div><h2>Validation history</h2><p>Select a request to review validated and pending assets.</p></div>{selectedSessionId&&<button className="secondary" type="button" onClick={()=>void exportSession()}>Export Excel</button>}</div><label>Validation request<select value={selectedSessionId} onChange={e=>{setSelectedSessionId(e.target.value);void load(e.target.value)}}><option value="">Current / latest</option>{sessions.map(row=><option key={row.id} value={row.id}>{row.status==='OPEN'?'Active':'Closed'} · {formatDate(row.started_at)} · {row.validated}/{row.total}</option>)}</select></label>{targets.length>0&&<div className="tableScroll"><table><thead><tr><th>Barcode</th><th>Item</th><th>Owner</th><th>Location</th><th>Result</th><th>Validated by</th><th>Time</th></tr></thead><tbody>{targets.map(row=><tr key={row.id}><td><code>{row.barcode}</code></td><td>{row.name}</td><td>{row.owner_name||'Unassigned'}</td><td>{row.location_name||'Unassigned'}</td><td>{row.validated_at?'Validated':'Not validated'}</td><td>{row.validated_by_name||'—'}</td><td>{formatDate(row.validated_at||undefined)}</td></tr>)}</tbody></table></div>}</section>
    {(modal==='add'||modal==='edit')&&<OfficeForm row={modal==='edit'?selected:null} locations={locations} api={api} close={()=>setModal('')} done={async()=>{setModal('');notify(selected?'Office item updated':'Office item created');await load(selectedSessionId||undefined)}}/>}
    {modal==='history'&&selected&&<OwnerHistory item={selected} rows={history} close={()=>setModal('')}/>}
    {printItem&&<PrintOfficeItem item={printItem} close={()=>setPrintItem(null)}/>}
  </>
}

function OfficeForm({row,locations,api,close,done}:{row:OfficeItem|null;locations:Location[];api:Api;close:()=>void;done:()=>void}){
  const[form,setForm]=useState({name:row?.name||'',category:row?.category||'Laptop',manufacturer:row?.manufacturer||'',model:row?.model||'',serialNumber:row?.serial_number||'',ownerName:row?.owner_name||'',locationId:row?.current_location_id||'',condition:row?.condition||'GOOD',status:row?.status||'ACTIVE',quantity:1});
  const[busy,setBusy]=useState(false);const[error,setError]=useState('');
  async function submit(event:FormEvent){event.preventDefault();if(busy)return;setBusy(true);setError('');try{const body=row?{...form,ownerName:form.ownerName.trim()||null,locationId:form.locationId||null}:{...form,ownerName:form.ownerName.trim()||undefined,locationId:form.locationId||undefined,quantity:Number(form.quantity)};await api(row?'/api/office-inventory/'+row.id:'/api/office-inventory',{method:row?'PATCH':'POST',body:JSON.stringify(body)});done()}catch(reason){setError(reason instanceof Error?reason.message:'Unable to save office item')}finally{setBusy(false)}}
  return <div className="modalBackdrop"><section className="modal"><header><div><h2>{row?'Edit office item':'Add office item'}</h2><p>{row?'Only administrators can change the owner.':'Each physical device receives its own permanent OI barcode.'}</p></div><button onClick={close}><X/></button></header><form className="formGrid" onSubmit={submit}><label>Item name<input required value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label><label>Category<select value={form.category} onChange={e=>setForm({...form,category:e.target.value})}>{categories.map(value=><option key={value}>{value}</option>)}</select></label><label>Manufacturer<input value={form.manufacturer} onChange={e=>setForm({...form,manufacturer:e.target.value})}/></label><label>Model<input value={form.model} onChange={e=>setForm({...form,model:e.target.value})}/></label><label>Serial number<input value={form.serialNumber} onChange={e=>setForm({...form,serialNumber:e.target.value})}/></label><label>Owner <small>Admin only</small><input value={form.ownerName} placeholder="Employee / responsible person" onChange={e=>setForm({...form,ownerName:e.target.value})}/></label><label>Location<select value={form.locationId} onChange={e=>setForm({...form,locationId:e.target.value})}><option value="">Unassigned</option>{locations.map(location=><option key={location.id} value={location.id}>{location.name}</option>)}</select></label><label>Condition<select value={form.condition} onChange={e=>setForm({...form,condition:e.target.value})}>{conditions.map(value=><option key={value}>{pretty(value)}</option>)}</select></label><label>Status<select value={form.status} onChange={e=>setForm({...form,status:e.target.value})}>{statuses.map(value=><option key={value}>{pretty(value)}</option>)}</select></label>{!row&&<label>Quantity<input type="number" min="1" max="500" step="1" value={form.quantity} onChange={e=>setForm({...form,quantity:Number(e.target.value)})}/></label>}{error&&<div className="error full">{error}</div>}<div className="formActions full"><button type="button" className="secondary" onClick={close}>Cancel</button><button className="primary" disabled={busy}>{busy?'Saving…':'Save office item'}</button></div></form></section></div>
}
function OwnerHistory({item,rows,close}:{item:OfficeItem;rows:OwnerRow[];close:()=>void}){return <div className="modalBackdrop"><section className="modal"><header><div><h2>Owner history</h2><p>{item.barcode} · {item.name}</p></div><button onClick={close}><X/></button></header><div className="tableScroll"><table><thead><tr><th>Previous owner</th><th>New owner</th><th>Changed by</th><th>Date</th></tr></thead><tbody>{rows.map(row=><tr key={row.id}><td>{row.previous_owner||'Unassigned'}</td><td>{row.new_owner||'Unassigned'}</td><td>{row.changed_by_name||'Administrator'}</td><td>{formatDate(row.changed_at)}</td></tr>)}</tbody></table>{rows.length===0&&<p>No owner changes recorded yet.</p>}</div></section></div>}
function BarcodeLabel({value}:{value:string}){const ref=useRef<SVGSVGElement>(null);useEffect(()=>{if(ref.current)JsBarcode(ref.current,value,{format:'CODE128',width:1.45,height:44,fontSize:13,margin:8,background:'#fff'})},[value]);return <div className="barcodeLabel"><svg ref={ref}/></div>}
function PrintOfficeItem({item,close}:{item:OfficeItem;close:()=>void}){return <div className="printSheet"><button onClick={close}><X/></button><h1>{item.name}</h1><p>Owner: {item.owner_name||'Unassigned'}</p><BarcodeLabel value={item.barcode}/></div>}
function pretty(value:string){return value.replaceAll('_',' ').toLowerCase().replace(/\b\w/g,char=>char.toUpperCase())}
function formatDate(value?:string){return value?new Date(value).toLocaleString():'Never'}
