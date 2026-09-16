'use client';

import JsBarcode from 'jsbarcode';
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
import {
  AlertTriangle, Archive, Barcode, Boxes, Camera, CheckCircle2, ChevronDown, ChevronRight, CircleGauge,
  Download, Edit3, History, ImagePlus, Keyboard, LocateFixed, LogOut, MapPin, Menu, PackageCheck,
  Plus, Printer, ScanLine, Search, ShieldCheck, Smartphone, Trash2, UsersRound, X,
} from 'lucide-react';
import { FormEvent, ReactNode, useEffect, useRef, useState } from 'react';

type User={id:string;username:string;fullName?:string;full_name?:string;role:'ADMIN'|'SCANNER';active?:boolean;last_login_at?:string};
type Location={id:string;name:string;code:string;location_type?:string;address?:string;description?:string;active:boolean};
type Unit={id:string;barcode:string;unit_number:number;name:string;condition:string;status:string;serial_number?:string;location_id?:string;location_name?:string;last_scanned_at?:string};
type Material={id:string;inventory_type:'TOOL'|'SAMPLE';name:string;code:string;image_url?:string;image_source_url?:string;description?:string;units:Unit[]};
type Scan={id:string;barcode:string;name:string;inventory_type:string;previous_location_name?:string;new_location_name?:string;scanner_name?:string;condition:string;scanned_at:string;capture_method?:'CAMERA'|'MANUAL';latitude?:number;longitude?:number;location_accuracy?:number;evidence_image_url?:string};
type Issue={id:string;inventory_item_id:string;barcode:string;name:string;inventory_type:string;issue_type:string;description:string;image_url?:string;material_image_url?:string;status:string;location_name?:string;reported_by_name?:string;reported_at:string;resolution_note?:string};
type GeoStamp={latitude:number;longitude:number;locationAccuracy?:number;capturedAt:string};
type ScanMatch={id:string;barcode:string;name:string;inventoryType:string;condition:string;status:string;locationName?:string;imageUrl?:string};
type ValidationResult={matched:boolean;attemptId:string;item:ScanMatch|null};
type ApiResult<T>={success:boolean;data:T;error?:{message:string}};
type Api=<T>(url:string,options?:RequestInit)=>Promise<T>;
type View='dashboard'|'materials'|'locations'|'scanner'|'issues'|'users'|'scans';
type AppData={locations:Location[];materials:Material[];users:User[];scans:Scan[];issues:Issue[]};

const adminNav:[View,string,typeof CircleGauge][]=[
  ['dashboard','Overview',CircleGauge],['materials','Materials & Units',Boxes],['locations','Locations',MapPin],
  ['scanner','Scan Unit',ScanLine],['issues','Defects',AlertTriangle],['users','Users',UsersRound],['scans','Scan History',History],
];
const conditions=['GOOD','MINOR_ISSUE','DAMAGED','MISSING_PARTS','NEEDS_MAINTENANCE'];
const statuses=['ACTIVE','INACTIVE','MAINTENANCE','LOST','RETIRED'];

export default function Home(){
  const[token,setToken]=useState(''); const[me,setMe]=useState<User|null>(null); const[view,setView]=useState<View>('dashboard');
  const[locations,setLocations]=useState<Location[]>([]); const[materials,setMaterials]=useState<Material[]>([]); const[users,setUsers]=useState<User[]>([]);
  const[scans,setScans]=useState<Scan[]>([]); const[issues,setIssues]=useState<Issue[]>([]); const[message,setMessage]=useState(''); const[mobileNav,setMobileNav]=useState(false); const[loading,setLoading]=useState(false);

  useEffect(()=>{const savedToken=localStorage.getItem('br_token');const savedUser=localStorage.getItem('br_user');if(savedToken&&savedUser){setToken(savedToken);setMe(JSON.parse(savedUser))}},[]);
  useEffect(()=>{if('serviceWorker' in navigator)void navigator.serviceWorker.register('/sw.js')},[]);
  useEffect(()=>{if(me?.role==='SCANNER'&&view!=='scanner')setView('scanner')},[me?.role,view]);
  const api:Api=async<T,>(url:string,options:RequestInit={})=>{const res=await fetch(url,{...options,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{ }),...(options.headers||{})}});const body:ApiResult<T>=await res.json();if(!body.success)throw new Error(body.error?.message||'Request failed');return body.data};
  async function loadAll(){
    if(!token||!me)return;
    setLoading(true);
    try{
      const data=await api<AppData>('/api/app-data');
      setLocations(data.locations);setMaterials(data.materials);setUsers(data.users);setScans(data.scans);setIssues(data.issues);
    }catch(error){setMessage(error instanceof Error?error.message:'Unable to load data')}finally{setLoading(false)}
  }
  useEffect(()=>{void loadAll()},[token,me?.id]);
  function logout(){localStorage.removeItem('br_token');localStorage.removeItem('br_user');setToken('');setMe(null)}
  function notify(text:string){setMessage(text);window.setTimeout(()=>setMessage(''),3500)}
  if(!token||!me)return <Login onLogin={(newToken,user)=>{localStorage.setItem('br_token',newToken);localStorage.setItem('br_user',JSON.stringify(user));setToken(newToken);setMe(user)}}/>;

  const isAdmin=me.role==='ADMIN';
  const nav=isAdmin?adminNav:adminNav.filter(([key])=>key==='scanner');
  const units=materials.flatMap(material=>material.units); const openIssues=issues.filter(issue=>issue.status==='OPEN');
  return <div className="appShell">
    <aside className={`sidebar ${mobileNav?'open':''}`}>
      <button className="mobileClose" onClick={()=>setMobileNav(false)}><X size={20}/></button>
      <div className="sideBrand"><div className="brandMark"><span/></div><div><strong>BlueRock IMS</strong><small>Inventory Management</small></div></div>
      <nav>{nav.map(([key,label,Icon])=><button key={key} className={view===key?'active':''} onClick={()=>{setView(key);setMobileNav(false)}}><Icon size={19}/><span>{label}</span>{key==='issues'&&openIssues.length>0?<b>{openIssues.length}</b>:null}</button>)}</nav>
      <div className="sidebarMotto">BUILT FOR<br/>A STRONGER<br/>TOMORROW</div>
      <div className="sideFoot"><div className="avatar">{(me.fullName||me.full_name||me.username).slice(0,2).toUpperCase()}</div><div><strong>{me.fullName||me.full_name||me.username}</strong><small>{pretty(me.role)}</small></div><button onClick={logout} title="Sign out"><LogOut size={18}/></button></div>
    </aside>
    <main className="mainArea">
      <header className="topbar"><button className="mobileMenu" onClick={()=>setMobileNav(true)}><Menu/></button><div><span className="eyebrow">BLUE ROCK / INVENTORY</span><h1>{nav.find(item=>item[0]===view)?.[1]||'Inventory'}</h1></div><div className="topbarActions"><InstallApp/><div className="systemPill"><span/>System online</div></div></header>
      {message&&<button className="notice" onClick={()=>setMessage('')}>{message}</button>}
      {loading?<DataLoading/>:<>
        {view==='dashboard'&&isAdmin&&<Dashboard materials={materials} issues={openIssues} locations={locations} scans={scans}/>}
        {view==='materials'&&isAdmin&&<Materials materials={materials} locations={locations} api={api} refresh={loadAll} notify={notify}/>}
        {view==='locations'&&isAdmin&&<Locations rows={locations} units={units} api={api} refresh={loadAll} notify={notify}/>}
        {view==='scanner'&&<Scanner locations={locations} api={api} refresh={loadAll} notify={notify}/>}
        {view==='issues'&&me.role==='ADMIN'&&<Issues rows={issues} units={units} api={api} refresh={loadAll} notify={notify}/>}
        {view==='users'&&me.role==='ADMIN'&&<Users rows={users} currentId={me.id} api={api} refresh={loadAll} notify={notify}/>}
        {view==='scans'&&me.role==='ADMIN'&&<Scans rows={scans}/>}
      </>}
    </main>
  </div>
}

function DataLoading(){return <section className="dataLoading"><div className="loadingMark"><span/><span/><span/></div><span className="eyebrow">BLUE ROCK INVENTORY</span><h2>Loading your equipment</h2><p>Bringing materials, locations and barcode records together.</p></section>}

type InstallPromptEvent=Event&{prompt:()=>Promise<void>;userChoice:Promise<{outcome:'accepted'|'dismissed'}>};
function InstallApp(){
  const[prompt,setPrompt]=useState<InstallPromptEvent|null>(null);const[showIos,setShowIos]=useState(false);const[installed,setInstalled]=useState(false);
  useEffect(()=>{
    const standalone=window.matchMedia('(display-mode: standalone)').matches||Boolean((navigator as Navigator&{standalone?:boolean}).standalone);
    setInstalled(standalone);setShowIos(/iphone|ipad|ipod/i.test(navigator.userAgent)&&!standalone);
    const ready=(event:Event)=>{event.preventDefault();setPrompt(event as InstallPromptEvent)};
    const complete=()=>{setInstalled(true);setPrompt(null);setShowIos(false)};
    window.addEventListener('beforeinstallprompt',ready);window.addEventListener('appinstalled',complete);
    return()=>{window.removeEventListener('beforeinstallprompt',ready);window.removeEventListener('appinstalled',complete)};
  },[]);
  if(installed||(!prompt&&!showIos))return null;
  async function install(){if(prompt){await prompt.prompt();const choice=await prompt.userChoice;if(choice.outcome==='accepted')setPrompt(null)}else{window.alert('On iPhone or iPad: tap Share in Safari, then choose “Add to Home Screen”.')}}
  return <button type="button" className="installButton" onClick={()=>void install()}><Download size={16}/>{showIos?'Add to Home Screen':'Install app'}</button>
}

function Login({onLogin}:{onLogin:(token:string,user:User)=>void}){
  const[username,setUsername]=useState('');const[password,setPassword]=useState('');const[error,setError]=useState('');const[busy,setBusy]=useState(false);
  async function submit(event:FormEvent){event.preventDefault();setBusy(true);setError('');try{const response=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});const body=await response.json();if(!body.success)throw new Error(body.error?.message||'Login failed');onLogin(body.data.token,body.data.user)}catch(reason){setError(reason instanceof Error?reason.message:'Login failed')}finally{setBusy(false)}}
  return <main className="loginPage"><section className="loginIntro"><div className="brandMark large"><span/></div><p>BLUE ROCK</p><h1>Every asset.<br/>Every movement.<br/><em>Accounted for.</em></h1><small>Tools, equipment and display sample control for stronger operations.</small></section><section className="loginPanel"><form onSubmit={submit}><span className="eyebrow">SECURE ACCESS</span><h2>Welcome back</h2><p>Sign in to BlueRock Inventory Management.</p><label>Username<input value={username} onChange={e=>setUsername(e.target.value)} autoComplete="username" required/></label><label>Password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="current-password" required/></label>{error&&<div className="error">{error}</div>}<button className="primary" disabled={busy}>{busy?'Signing in…':'Sign in'} <ChevronRight size={17}/></button><small className="secure"><ShieldCheck size={14}/> Authorized personnel only</small></form></section></main>
}

function Dashboard({materials,issues,locations,scans}:{materials:Material[];issues:Issue[];locations:Location[];scans:Scan[]}){
  const units=materials.flatMap(m=>m.units);const defective=units.filter(unit=>unit.condition!=='GOOD').length;
  return <><section className="stats"><Stat icon={<PackageCheck/>} label="Total Units" value={units.length} note="Individually barcoded"/><Stat icon={<Boxes/>} label="Material Types" value={materials.length} note="Grouped inventory"/><Stat icon={<AlertTriangle/>} label="Open Defects" value={issues.length} note={issues.length?'Needs attention':'All clear'} alert={issues.length>0}/><Stat icon={<MapPin/>} label="Locations" value={locations.length} note={`${defective} units need review`}/></section><section className="dashboardGrid"><div className="panel"><PanelHead title="Inventory by material" subtitle="Largest material groups"/><div className="materialSummary">{[...materials].sort((a,b)=>b.units.length-a.units.length).slice(0,6).map(material=><div key={material.id}><img src={material.image_url||'/materials/scaffolding.jpg'} alt=""/><div><strong>{material.name}</strong><small>{barcodeRange(material)}</small></div><b>{material.units.length}</b></div>)}</div></div><div className="panel"><PanelHead title="Recent movement" subtitle="Latest scan activity"/><ScanTable rows={scans.slice(0,7)}/></div></section></>
}
function Stat({icon,label,value,note,alert}:{icon:ReactNode;label:string;value:number;note:string;alert?:boolean}){return <div className={`stat ${alert?'alert':''}`}><div className="statIcon">{icon}</div><div><small>{label}</small><strong>{value.toLocaleString()}</strong><span>{note}</span></div></div>}

function Materials({materials,locations,api,refresh,notify}:{materials:Material[];locations:Location[];api:Api;refresh:()=>Promise<void>;notify:(s:string)=>void}){
  const[search,setSearch]=useState('');const[type,setType]=useState('ALL');const[expanded,setExpanded]=useState<string>('');const[modal,setModal]=useState<'add'|'edit'|'units'|'unit'|''>('');const[selected,setSelected]=useState<Material|null>(null);const[selectedUnit,setSelectedUnit]=useState<Unit|null>(null);const[printing,setPrinting]=useState<Material|null>(null);const[preview,setPreview]=useState<Material|null>(null);
  const filtered=materials.filter(material=>(type==='ALL'||material.inventory_type===type)&&`${material.name} ${material.code}`.toLowerCase().includes(search.toLowerCase()));
  async function removeMaterial(material:Material){if(!confirm(`Archive ${material.name} and all of its units? Scan and defect history will be preserved.`))return;await api(`/api/materials/${material.id}`,{method:'DELETE'});notify('Material archived');await refresh()}
  async function removeUnit(unit:Unit){if(!confirm(`Archive ${unit.barcode}? Its history will be preserved.`))return;await api(`/api/inventory/${unit.id}`,{method:'DELETE'});notify(`${unit.barcode} archived`);await refresh()}
  return <>
    <section className="pageHero"><div><span className="eyebrow">STOCK CONTROL</span><h2>Materials & Units</h2><p>Quantities are calculated from individually tracked barcode units.</p></div><button className="primary" onClick={()=>{setSelected(null);setModal('add')}}><Plus size={17}/> Add material</button></section>
    <section className="toolbar"><label className="search"><Search size={17}/><input placeholder="Search materials or barcode prefixes…" value={search} onChange={e=>setSearch(e.target.value)}/></label><div className="segmented"><button className={type==='ALL'?'active':''} onClick={()=>setType('ALL')}>All</button><button className={type==='TOOL'?'active':''} onClick={()=>setType('TOOL')}>Tools</button><button className={type==='SAMPLE'?'active':''} onClick={()=>setType('SAMPLE')}>Samples</button></div></section>
    <section className="materialList">{filtered.map(material=>{const isOpen=expanded===material.id;const defective=material.units.filter(unit=>unit.condition!=='GOOD').length;return <article className="materialCard" key={material.id}>
      <div className="materialRow"><button className="expand" onClick={()=>setExpanded(isOpen?'':material.id)}>{isOpen?<ChevronDown/>:<ChevronRight/>}</button><button type="button" className="materialPhoto" title={`Preview ${material.name}`} onClick={()=>setPreview(material)}><img src={material.image_url||'/materials/scaffolding.jpg'} alt={material.name}/></button><div className="materialName"><span>{pretty(material.inventory_type)}</span><h3>{material.name}</h3><small>{material.description||'Tracked BlueRock material'}</small></div><div className="metric"><small>Total units</small><strong>{material.units.length}</strong></div><div className="metric"><small>Available</small><strong>{material.units.length-defective}</strong></div><div className={`metric ${defective?'danger':''}`}><small>Defective</small><strong>{defective}</strong></div><div className="barcodeRange"><Barcode size={16}/><div><small>Barcode series</small><code>{barcodeRange(material)}</code></div></div><div className="rowActions"><button title="Generate barcodes" onClick={()=>{setSelected(material);setModal('units')}}><Barcode size={17}/></button><button title="Print labels" onClick={()=>{setPrinting(material);setTimeout(()=>window.print(),100)}}><Printer size={17}/></button><button title="Edit material" onClick={()=>{setSelected(material);setModal('edit')}}><Edit3 size={17}/></button><button className="dangerButton" title="Archive material" onClick={()=>void removeMaterial(material)}><Trash2 size={17}/></button></div></div>
      {isOpen&&<div className="unitTable"><table><thead><tr><th>Unit</th><th>Barcode</th><th>Location</th><th>Condition</th><th>Status</th><th>Last scanned</th><th/></tr></thead><tbody>{material.units.map(unit=><tr key={unit.id}><td>#{unit.unit_number}</td><td><code>{unit.barcode}</code></td><td>{unit.location_name||'Unassigned'}</td><td><Status value={unit.condition}/></td><td><Status value={unit.status}/></td><td>{formatDate(unit.last_scanned_at)}</td><td><div className="tableActions"><button onClick={()=>{setSelectedUnit(unit);setModal('unit')}}><Edit3 size={15}/></button><button className="dangerButton" onClick={()=>void removeUnit(unit)}><Trash2 size={15}/></button></div></td></tr>)}</tbody></table>{material.units.length===0&&<Empty text="No units generated yet"/>}</div>}
    </article>})}{filtered.length===0&&<Empty text="No materials match your filters"/>}</section>
    {modal==='add'&&<MaterialForm locations={locations} api={api} close={()=>setModal('')} done={async()=>{setModal('');notify('Material and barcodes created');await refresh()}}/>}
    {modal==='edit'&&selected&&<MaterialEdit material={selected} api={api} close={()=>setModal('')} done={async()=>{setModal('');notify('Material updated');await refresh()}}/>}
    {modal==='units'&&selected&&<GenerateUnits material={selected} locations={locations} api={api} close={()=>setModal('')} done={async()=>{setModal('');notify('New barcodes generated');await refresh()}}/>}
    {modal==='unit'&&selectedUnit&&<UnitEdit unit={selectedUnit} locations={locations} api={api} close={()=>setModal('')} done={async()=>{setModal('');notify('Unit updated');await refresh()}}/>}
    {preview&&<ImagePreview material={preview} close={()=>setPreview(null)}/>}
    {printing&&<PrintSheet material={printing} close={()=>setPrinting(null)}/>}
  </>
}

function MaterialForm({locations,api,close,done}:{locations:Location[];api:Api;close:()=>void;done:()=>void}){
  const[form,setForm]=useState({name:'',code:'',inventoryType:'TOOL',imageUrl:'',imageSourceUrl:'',description:''});const[counts,setCounts]=useState<Record<string,number>>({});const[busy,setBusy]=useState(false);const[error,setError]=useState('');const[fileName,setFileName]=useState('');
  const total=Object.values(counts).reduce((sum,value)=>sum+(Number(value)||0),0);
  async function imageFile(event:React.ChangeEvent<HTMLInputElement>){const image=event.target.files?.[0];if(!image)return;if(!image.type.startsWith('image/')){setError('Please choose a JPG, PNG, WEBP or other image file');return}if(image.size>2_500_000){setError('Image must be smaller than 2.5 MB');return}const data=await fileData(image);setError('');setFileName(image.name);setForm(current=>({...current,imageUrl:data}))}
  async function submit(event:FormEvent){event.preventDefault();setBusy(true);setError('');try{await api('/api/materials',{method:'POST',body:JSON.stringify({...form,allocations:Object.entries(counts).filter(([,count])=>count>0).map(([locationId,count])=>({locationId,count:Number(count)}))})});done()}catch(reason){setError(reason instanceof Error?reason.message:'Unable to create material')}finally{setBusy(false)}}
  return <Modal title="Add material" subtitle="Create a material group and its first barcode units." close={close}><form className="formGrid" onSubmit={submit}><label>Material name<input required value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label><label>Material code<input required maxLength={12} placeholder="e.g. CSW" value={form.code} onChange={e=>setForm({...form,code:e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'')})}/></label><label className="full">Item type<select value={form.inventoryType} onChange={e=>setForm({...form,inventoryType:e.target.value})}><option value="TOOL">Tool / Equipment</option><option value="SAMPLE">Display Sample</option></select></label><label className="upload uploadProminent full"><span className="uploadIcon"><ImagePlus/></span><span><b>Upload material photo</b><small>{fileName||'Choose JPG, PNG or WEBP from your device · maximum 2.5 MB'}</small></span><span className="uploadBrowse">Choose image</span><input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={imageFile}/></label>{form.imageUrl&&<img className="uploadPreview full" src={form.imageUrl} alt="Material preview"/>}<label className="full">Or paste an image URL <small>Optional when you upload a photo directly.</small><input value={form.imageUrl.startsWith('data:')?'':form.imageUrl} placeholder="https://…" onChange={e=>{setFileName('');setForm({...form,imageUrl:e.target.value})}}/></label><label className="full">Description<textarea value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></label><fieldset className="full"><legend>Initial quantity by location <b>{total} units</b></legend><div className="allocationGrid">{locations.map(location=><label key={location.id}>{location.name}<input type="number" min="0" value={counts[location.id]||''} onChange={e=>setCounts({...counts,[location.id]:Number(e.target.value)})}/></label>)}</div></fieldset>{error&&<div className="error full">{error}</div>}<div className="formActions full"><button type="button" className="secondary" onClick={close}>Cancel</button><button className="primary" disabled={busy}>{busy?'Creating…':`Create ${total} unit${total===1?'':'s'}`}</button></div></form></Modal>
}

function MaterialEdit({material,api,close,done}:{material:Material;api:Api;close:()=>void;done:()=>void}){
  const[form,setForm]=useState({name:material.name,imageUrl:material.image_url||'',imageSourceUrl:material.image_source_url||'',description:material.description||''});const[error,setError]=useState('');const[fileName,setFileName]=useState('');
  async function imageFile(event:React.ChangeEvent<HTMLInputElement>){const image=event.target.files?.[0];if(!image)return;if(!image.type.startsWith('image/')){setError('Please choose a JPG, PNG, WEBP or other image file');return}if(image.size>2_500_000){setError('Image must be smaller than 2.5 MB');return}const data=await fileData(image);setError('');setFileName(image.name);setForm(current=>({...current,imageUrl:data}))}
  async function submit(event:FormEvent){event.preventDefault();try{await api(`/api/materials/${material.id}`,{method:'PATCH',body:JSON.stringify(form)});done()}catch(reason){setError(reason instanceof Error?reason.message:'Unable to update material')}}
  return <Modal title="Edit material" subtitle={`${material.code} · Existing barcodes remain permanent.`} close={close}><form className="formGrid" onSubmit={submit}><label>Material name<input required value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label><label>Material code<input disabled value={material.code}/></label><label className="upload uploadProminent full"><span className="uploadIcon"><ImagePlus/></span><span><b>Replace material photo</b><small>{fileName||'Choose a new JPG, PNG or WEBP from your device · maximum 2.5 MB'}</small></span><span className="uploadBrowse">Choose image</span><input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={imageFile}/></label>{form.imageUrl&&<img className="uploadPreview full" src={form.imageUrl} alt="Material preview"/>}<label className="full">Or paste an image URL <small>Optional when you upload a photo directly.</small><input value={form.imageUrl.startsWith('data:')?'':form.imageUrl} placeholder="https://…" onChange={e=>{setFileName('');setForm({...form,imageUrl:e.target.value})}}/></label><label className="full">Description<textarea value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></label>{error&&<div className="error full">{error}</div>}<FormActions close={close} label="Save changes"/></form></Modal>
}

function GenerateUnits({material,locations,api,close,done}:{material:Material;locations:Location[];api:Api;close:()=>void;done:()=>void}){
  const[quantity,setQuantity]=useState(1);const[locationId,setLocationId]=useState(locations[0]?.id||'');const[error,setError]=useState('');const next=Math.max(0,...material.units.map(unit=>unit.unit_number))+1;const prefix=material.inventory_type==='TOOL'?'TL':'SP';const preview=Array.from({length:Math.min(quantity,6)},(_,index)=>`${prefix}-${material.code}-${String(next+index).padStart(4,'0')}`);
  async function submit(event:FormEvent){event.preventDefault();try{await api(`/api/materials/${material.id}/units`,{method:'POST',body:JSON.stringify({quantity,locationId})});done()}catch(reason){setError(reason instanceof Error?reason.message:'Unable to generate units')}}
  return <Modal title="Generate barcodes" subtitle={`Material: ${material.name}`} close={close}><form onSubmit={submit}><div className="generateFields"><label>Prefix<input disabled value={`${prefix}-${material.code}`}/></label><label>Quantity<input type="number" min="1" max="1000" value={quantity} onChange={e=>setQuantity(Number(e.target.value))}/></label><label>Initial location<select value={locationId} onChange={e=>setLocationId(e.target.value)}>{locations.map(location=><option key={location.id} value={location.id}>{location.name}</option>)}</select></label></div><div className="barcodePreview"><span>Preview</span><div>{preview.map(code=><BarcodeLabel key={code} value={code}/>)}</div>{quantity>6&&<small>+ {quantity-6} more sequential barcodes</small>}</div>{error&&<div className="error">{error}</div>}<div className="formActions"><button type="button" className="secondary" onClick={close}>Cancel</button><button className="primary"><Barcode size={17}/> Generate {quantity} barcode{quantity===1?'':'s'}</button></div></form></Modal>
}

function UnitEdit({unit,locations,api,close,done}:{unit:Unit;locations:Location[];api:Api;close:()=>void;done:()=>void}){
  const[form,setForm]=useState({barcode:unit.barcode,locationId:unit.location_id||'',condition:unit.condition,status:unit.status,serialNumber:unit.serial_number||''});const[error,setError]=useState('');
  async function submit(event:FormEvent){event.preventDefault();try{await api(`/api/inventory/${unit.id}`,{method:'PATCH',body:JSON.stringify(form)});done()}catch(reason){setError(reason instanceof Error?reason.message:'Unable to update unit')}}
  return <Modal title="Edit physical unit" subtitle={`Unit #${unit.unit_number}`} close={close}><form className="formGrid" onSubmit={submit}><label className="full">Barcode<input required value={form.barcode} onChange={e=>setForm({...form,barcode:e.target.value.toUpperCase()})}/></label><label>Location<select value={form.locationId} onChange={e=>setForm({...form,locationId:e.target.value})}>{locations.map(location=><option key={location.id} value={location.id}>{location.name}</option>)}</select></label><label>Serial number<input value={form.serialNumber} onChange={e=>setForm({...form,serialNumber:e.target.value})}/></label><label>Condition<select value={form.condition} onChange={e=>setForm({...form,condition:e.target.value})}>{conditions.map(value=><option key={value}>{value}</option>)}</select></label><label>Status<select value={form.status} onChange={e=>setForm({...form,status:e.target.value})}>{statuses.map(value=><option key={value}>{value}</option>)}</select></label>{error&&<div className="error full">{error}</div>}<FormActions close={close} label="Save unit"/></form></Modal>
}

function Locations({rows,units,api,refresh,notify}:{rows:Location[];units:Unit[];api:Api;refresh:()=>Promise<void>;notify:(s:string)=>void}){
  const[selected,setSelected]=useState<Location|null>(null);const[open,setOpen]=useState(false);
  async function remove(row:Location){if(!confirm(`Disable ${row.name}? Existing unit history will be preserved.`))return;await api(`/api/locations/${row.id}`,{method:'DELETE'});notify('Location disabled');await refresh()}
  return <><section className="pageHero"><div><span className="eyebrow">MANAGED DESTINATIONS</span><h2>Locations</h2><p>These locations are available to scanner users.</p></div><button className="primary" onClick={()=>{setSelected(null);setOpen(true)}}><Plus size={17}/> Add location</button></section><section className="locationGrid">{rows.map(row=>{const count=units.filter(unit=>unit.location_id===row.id).length;return <article className="locationCard" key={row.id}><div className="locationPin"><MapPin/></div><div><span>{row.code}</span><h3>{row.name}</h3><p>{row.location_type||'Project location'}{row.address?` · ${row.address}`:''}</p></div><strong>{count}<small>units</small></strong><div className="rowActions"><button onClick={()=>{setSelected(row);setOpen(true)}}><Edit3 size={16}/></button><button className="dangerButton" onClick={()=>void remove(row)}><Trash2 size={16}/></button></div></article>})}</section>{open&&<LocationForm row={selected} api={api} close={()=>setOpen(false)} done={async()=>{setOpen(false);notify(selected?'Location updated':'Location created');await refresh()}}/>}</>
}

function LocationForm({row,api,close,done}:{row:Location|null;api:Api;close:()=>void;done:()=>void}){const[form,setForm]=useState({name:row?.name||'',code:row?.code||'',locationType:row?.location_type||'Project location',address:row?.address||'',description:row?.description||''});const[error,setError]=useState('');async function submit(event:FormEvent){event.preventDefault();try{await api(row?`/api/locations/${row.id}`:'/api/locations',{method:row?'PATCH':'POST',body:JSON.stringify(form)});done()}catch(reason){setError(reason instanceof Error?reason.message:'Unable to save location')}}return <Modal title={row?'Edit location':'Add location'} subtitle="Managed destination for inventory movements." close={close}><form className="formGrid" onSubmit={submit}><label>Name<input required value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label><label>Code<input required disabled={Boolean(row)} value={form.code} onChange={e=>setForm({...form,code:e.target.value.toUpperCase()})}/></label><label>Type<input value={form.locationType} onChange={e=>setForm({...form,locationType:e.target.value})}/></label><label>Address<input value={form.address} onChange={e=>setForm({...form,address:e.target.value})}/></label>{error&&<div className="error full">{error}</div>}<FormActions close={close} label="Save location"/></form></Modal>}

function Users({rows,currentId,api,refresh,notify}:{rows:User[];currentId:string;api:Api;refresh:()=>Promise<void>;notify:(s:string)=>void}){const[selected,setSelected]=useState<User|null>(null);const[open,setOpen]=useState(false);async function remove(user:User){if(!confirm(`Disable ${user.full_name||user.username}?`))return;await api(`/api/users/${user.id}`,{method:'DELETE'});notify('User disabled');await refresh()}return <><section className="pageHero"><div><span className="eyebrow">ACCESS CONTROL</span><h2>Users</h2><p>Administrator and scanner accounts.</p></div><button className="primary" onClick={()=>{setSelected(null);setOpen(true)}}><Plus size={17}/> Add user</button></section><section className="panel"><table><thead><tr><th>User</th><th>Username</th><th>Role</th><th>Status</th><th>Last login</th><th/></tr></thead><tbody>{rows.map(user=><tr key={user.id}><td><div className="userCell"><span>{(user.full_name||user.username).slice(0,2).toUpperCase()}</span><strong>{user.full_name||user.username}</strong></div></td><td>{user.username}</td><td><Status value={user.role}/></td><td><Status value={user.active===false?'DISABLED':'ACTIVE'}/></td><td>{formatDate(user.last_login_at)}</td><td><div className="tableActions"><button onClick={()=>{setSelected(user);setOpen(true)}}><Edit3 size={15}/></button>{user.id!==currentId&&<button className="dangerButton" onClick={()=>void remove(user)}><Trash2 size={15}/></button>}</div></td></tr>)}</tbody></table></section>{open&&<UserForm row={selected} api={api} close={()=>setOpen(false)} done={async()=>{setOpen(false);notify(selected?'User updated':'User created');await refresh()}}/>}</>}

function UserForm({row,api,close,done}:{row:User|null;api:Api;close:()=>void;done:()=>void}){const[form,setForm]=useState({username:row?.username||'',fullName:row?.full_name||'',password:'',role:row?.role||'SCANNER',active:row?.active!==false});const[error,setError]=useState('');async function submit(event:FormEvent){event.preventDefault();try{const body=row?{fullName:form.fullName,role:form.role,active:form.active,...(form.password?{password:form.password}:{})}:form;await api(row?`/api/users/${row.id}`:'/api/users',{method:row?'PATCH':'POST',body:JSON.stringify(body)});done()}catch(reason){setError(reason instanceof Error?reason.message:'Unable to save user')}}return <Modal title={row?'Edit user':'Add user'} subtitle="Passwords are securely hashed." close={close}><form className="formGrid" onSubmit={submit}><label>Full name<input required value={form.fullName} onChange={e=>setForm({...form,fullName:e.target.value})}/></label><label>Username<input required disabled={Boolean(row)} value={form.username} onChange={e=>setForm({...form,username:e.target.value})}/></label><label>Role<select value={form.role} onChange={e=>setForm({...form,role:e.target.value as User['role']})}><option value="SCANNER">Scanner</option><option value="ADMIN">Administrator</option></select></label><label>{row?'New password (optional)':'Password'}<input required={!row} minLength={12} type="password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})}/></label>{row&&<label className="check"><input type="checkbox" checked={form.active} onChange={e=>setForm({...form,active:e.target.checked})}/> Account active</label>}{error&&<div className="error full">{error}</div>}<FormActions close={close} label="Save user"/></form></Modal>}

function Issues({rows,units,api,refresh,notify}:{rows:Issue[];units:Unit[];api:Api;refresh:()=>Promise<void>;notify:(s:string)=>void}){const[selected,setSelected]=useState<Issue|null>(null);const[open,setOpen]=useState(false);async function resolve(issue:Issue){const note=prompt('Resolution note');if(!note)return;await api('/api/issues',{method:'POST',body:JSON.stringify({action:'resolve',issueId:issue.id,resolutionNote:note})});notify('Defect resolved');await refresh()}async function remove(issue:Issue){if(!confirm('Archive this defect record?'))return;await api(`/api/issues/${issue.id}`,{method:'DELETE'});notify('Defect archived');await refresh()}return <><section className="pageHero"><div><span className="eyebrow">MAINTENANCE EVIDENCE</span><h2>Defect Log</h2><p>Photo-backed issues attached to individual barcode units.</p></div><button className="primary" onClick={()=>{setSelected(null);setOpen(true)}}><Plus size={17}/> Report defect</button></section><section className="defectGrid">{rows.map(issue=><article className="defectCard" key={issue.id}><img src={issue.image_url||issue.material_image_url||'/materials/grinder.jpg'} alt={issue.issue_type}/><div className="defectBody"><div><Status value={issue.status}/><small>{formatDate(issue.reported_at)}</small></div><h3>{issue.issue_type}</h3><code>{issue.barcode}</code><p>{issue.description}</p><small>{issue.location_name||'Unassigned'} · {issue.reported_by_name||'Unknown'}</small></div><div className="defectActions">{issue.status==='OPEN'&&<button className="resolve" onClick={()=>void resolve(issue)}><PackageCheck size={16}/> Resolve</button>}<button onClick={()=>{setSelected(issue);setOpen(true)}}><Edit3 size={16}/></button><button className="dangerButton" onClick={()=>void remove(issue)}><Trash2 size={16}/></button></div></article>)}{rows.length===0&&<Empty text="No defects recorded"/>}</section>{open&&<IssueForm row={selected} units={units} api={api} close={()=>setOpen(false)} done={async()=>{setOpen(false);notify(selected?'Defect updated':'Defect recorded');await refresh()}}/>}</>}

function IssueForm({row,units,api,close,done}:{row:Issue|null;units:Unit[];api:Api;close:()=>void;done:()=>void}){const[form,setForm]=useState({inventoryItemId:row?.inventory_item_id||units[0]?.id||'',issueType:row?.issue_type||'Damaged equipment',description:row?.description||'',imageUrl:row?.image_url||''});const[error,setError]=useState('');async function file(event:React.ChangeEvent<HTMLInputElement>){const selected=event.target.files?.[0];if(!selected)return;if(selected.size>2_500_000){setError('Image must be smaller than 2.5 MB');return}setForm({...form,imageUrl:await fileData(selected)})}async function submit(event:FormEvent){event.preventDefault();try{await api(row?`/api/issues/${row.id}`:'/api/issues',{method:row?'PATCH':'POST',body:JSON.stringify(row?{issueType:form.issueType,description:form.description,imageUrl:form.imageUrl}:{action:'create',...form})});done()}catch(reason){setError(reason instanceof Error?reason.message:'Unable to save defect')}}return <Modal title={row?'Edit defect':'Report defect'} subtitle="Attach clear photo evidence when available." close={close}><form className="formGrid" onSubmit={submit}>{!row&&<label className="full">Barcode unit<select value={form.inventoryItemId} onChange={e=>setForm({...form,inventoryItemId:e.target.value})}>{units.map(unit=><option key={unit.id} value={unit.id}>{unit.barcode} · {unit.name} · {unit.location_name}</option>)}</select></label>}<label className="full">Issue type<input required value={form.issueType} onChange={e=>setForm({...form,issueType:e.target.value})}/></label><label className="full">Description<textarea required value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></label><label className="upload full"><ImagePlus/><span>{form.imageUrl?'Replace defect photo':'Upload defect photo'}<small>JPG, PNG or WEBP · maximum 2.5 MB</small></span><input type="file" accept="image/*" onChange={file}/></label>{form.imageUrl&&<img className="uploadPreview full" src={form.imageUrl} alt="Defect preview"/>}{error&&<div className="error full">{error}</div>}<FormActions close={close} label="Save defect"/></form></Modal>}

function Scanner({locations,api,refresh,notify}:{locations:Location[];api:Api;refresh:()=>Promise<void>;notify:(s:string)=>void}){
  const videoRef=useRef<HTMLVideoElement>(null);
  const controlsRef=useRef<IScannerControls|null>(null);
  const busyRef=useRef(false);
  const[form,setForm]=useState({locationId:locations[0]?.id||'',condition:'GOOD',notes:'',reportIssue:false,issueType:'Damaged equipment'});
  const[barcode,setBarcode]=useState('');
  const[manualBarcode,setManualBarcode]=useState('');
  const[match,setMatch]=useState<ScanMatch|null>(null);
  const[attemptId,setAttemptId]=useState('');
  const[method,setMethod]=useState<'CAMERA'|'MANUAL'>('CAMERA');
  const[geo,setGeo]=useState<GeoStamp|null>(null);
  const[evidence,setEvidence]=useState('');
  const[failures,setFailures]=useState(0);
  const[scanning,setScanning]=useState(false);
  const[busy,setBusy]=useState(false);
  const[error,setError]=useState('');
  const manualAllowed=failures>=2;

  useEffect(()=>{if(!form.locationId&&locations[0])setForm(current=>({...current,locationId:locations[0].id}))},[locations,form.locationId]);
  useEffect(()=>()=>controlsRef.current?.stop(),[]);

  function stopCamera(){controlsRef.current?.stop();controlsRef.current=null;setScanning(false);busyRef.current=false}
  function resetScan(){stopCamera();setBarcode('');setManualBarcode('');setMatch(null);setAttemptId('');setMethod('CAMERA');setGeo(null);setEvidence('');setError('')}

  async function validateBarcode(value:string,captureMethod:'CAMERA'|'MANUAL'){
    const normalized=value.trim().toUpperCase();
    if(normalized.length<3){setError('Enter a valid barcode');return}
    setBusy(true);setError('');
    try{
      const position=await currentPosition();
      const stamp=geoFromPosition(position);
      const result=await api<ValidationResult>('/api/scans/validate',{method:'POST',body:JSON.stringify({barcode:normalized,captureMethod,...stamp})});
      setBarcode(normalized);setGeo(stamp);setMethod(captureMethod);setAttemptId(result.attemptId);
      if(!result.matched||!result.item){
        const next=failures+1;setFailures(next);setMatch(null);setAttemptId('');
        setError(next>=2?'Barcode not found. Manual entry is now available and requires a barcode photo.':'Barcode not found. Try scanning once more.');
        return;
      }
      setMatch(result.item);setError('');
    }catch(reason){setError(locationError(reason))}finally{setBusy(false)}
  }

  async function startCamera(){
    if(!videoRef.current)return;
    setError('');setMatch(null);setAttemptId('');setEvidence('');
    try{
      await currentPosition();
      const reader=new BrowserMultiFormatReader();
      setScanning(true);
      controlsRef.current=await reader.decodeFromConstraints(
        {audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}}},
        videoRef.current,
        (result,_error,controls)=>{
          if(!result||busyRef.current)return;
          busyRef.current=true;
          const value=result.getText();
          controls.stop();controlsRef.current=null;setScanning(false);busyRef.current=false;
          void validateBarcode(value,'CAMERA');
        },
      );
    }catch(reason){stopCamera();setError(cameraError(reason))}
  }

  async function photo(event:React.ChangeEvent<HTMLInputElement>){
    const selected=event.target.files?.[0];
    if(!selected)return;
    if(selected.size>8_000_000){setError('Photo must be smaller than 8 MB before processing');return}
    setBusy(true);setError('');
    try{
      const stamp=geoFromPosition(await currentPosition());
      setGeo(stamp);
      setEvidence(await stampedImage(selected,stamp,barcode||manualBarcode));
    }catch(reason){setError(locationError(reason))}finally{setBusy(false)}
  }

  async function submit(event:FormEvent){
    event.preventDefault();
    if(!match||!attemptId||!geo){setError('Scan and match a barcode before submitting');return}
    if(method==='MANUAL'&&!evidence){setError('Take a clear photo showing the barcode before submitting manual entry');return}
    setBusy(true);setError('');
    try{
      await api('/api/scans',{method:'POST',body:JSON.stringify({
        barcode:match.barcode,locationId:form.locationId,condition:form.condition,notes:form.notes,
        reportIssue:form.reportIssue,issueType:form.issueType,evidenceImageUrl:evidence||undefined,
        validationAttemptId:attemptId,captureMethod:method,...geo,
      })});
      notify(`${match.barcode} scanned successfully`);
      resetScan();setFailures(0);setForm(current=>({...current,notes:'',reportIssue:false}));
      await refresh();
    }catch(reason){setError(reason instanceof Error?reason.message:'Scan failed')}finally{setBusy(false)}
  }

  return <section className="scannerPage">
    <div className="scannerHero"><div><span className="eyebrow">MOBILE BARCODE CONTROL</span><h2>Scan a unit</h2><p>Camera scans are checked against the inventory database before movement is recorded.</p></div><div className={`gpsBadge ${geo?'ready':''}`}><LocateFixed size={18}/><span>{geo?`${geo.latitude.toFixed(5)}, ${geo.longitude.toFixed(5)}`:'GPS captured with every scan'}</span></div></div>
    <div className="scannerGrid">
      <section className="cameraCard">
        <div className="cameraViewport"><video ref={videoRef} muted playsInline/><div className="scanReticle"><span/><span/><span/><span/></div>{!scanning&&<div className="cameraEmpty"><Camera size={42}/><strong>Ready to scan</strong><small>Use the rear camera and center the barcode.</small></div>}</div>
        <div className="cameraActions">{scanning?<button type="button" className="secondary" onClick={stopCamera}><X size={18}/> Stop camera</button>:<button type="button" className="primary" onClick={()=>void startCamera()} disabled={busy}><Camera size={18}/> Open barcode camera</button>}<small>Camera and location permission are required.</small></div>
        <div className="attemptMeter"><span>Failed matches</span><div><i className={failures>=1?'active':''}/><i className={failures>=2?'active':''}/></div></div>
        {manualAllowed&&<div className="manualEntry"><div><Keyboard size={20}/><div><strong>Enter barcode manually</strong><small>After two failed scans, photographic proof is required.</small></div></div><div className="manualRow"><input aria-label="Manual barcode" placeholder="TL-CSW-0001" value={manualBarcode} onChange={event=>setManualBarcode(event.target.value.toUpperCase())}/><button type="button" onClick={()=>void validateBarcode(manualBarcode,'MANUAL')} disabled={busy}>Match barcode</button></div></div>}
      </section>
      <form className="scanForm scannerForm" onSubmit={submit}>
        <div className={`matchCard ${match?'matched':''}`}>{match?<><img src={match.imageUrl||'/materials/scaffolding.jpg'} alt=""/><div><span><CheckCircle2 size={15}/> Database match</span><h3>{match.name}</h3><code>{match.barcode}</code><small>{match.locationName||'Unassigned'} · {pretty(match.condition)}</small></div></>:<><Barcode size={28}/><div><strong>No barcode matched yet</strong><small>Open the camera and scan a registered unit.</small></div></>}</div>
        <label>New location<select required value={form.locationId} onChange={e=>setForm({...form,locationId:e.target.value})}><option value="" disabled>Select location</option>{locations.map(location=><option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
        <label>Condition<select value={form.condition} onChange={e=>setForm({...form,condition:e.target.value})}>{conditions.map(value=><option key={value}>{pretty(value)}</option>)}</select></label>
        <label>Notes<textarea placeholder="Optional movement or condition notes" value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})}/></label>
        <label className="check"><input type="checkbox" checked={form.reportIssue} onChange={e=>setForm({...form,reportIssue:e.target.checked})}/> Report this unit as defective</label>
        {form.reportIssue&&<label>Issue type<input value={form.issueType} onChange={e=>setForm({...form,issueType:e.target.value})}/></label>}
        <label className={`upload scanEvidence ${method==='MANUAL'?'required':''}`}><ImagePlus/><span>{evidence?'Replace unit photo':method==='MANUAL'?'Take required barcode photo':'Attach unit photo (optional)'}<small>Photo is stamped with capture time and GPS coordinates.</small></span><input type="file" accept="image/*" capture="environment" onChange={photo}/></label>
        {evidence&&<img className="uploadPreview" src={evidence} alt="Timestamped unit evidence"/>}
        {error&&<div className="error scanError">{error}</div>}
        <button className="primary submitScan" disabled={busy||!match||!form.locationId||(method==='MANUAL'&&!evidence)}><ScanLine size={19}/>{busy?'Working…':'Submit matched scan'}</button>
      </form>
    </div>
  </section>
}

function Scans({rows}:{rows:Scan[]}){return <><section className="pageHero"><div><span className="eyebrow">IMMUTABLE AUDIT TRAIL</span><h2>Scan History</h2><p>Every recorded inventory movement.</p></div><span className="recordCount">{rows.length} records</span></section><section className="panel"><ScanTable rows={rows}/></section></>}
function ScanTable({rows}:{rows:Scan[]}){return <div className="tableScroll"><table><thead><tr><th>Asset</th><th>Movement</th><th>Condition</th><th>Scanner</th><th>Time &amp; GPS</th></tr></thead><tbody>{rows.map(row=><tr key={row.id}><td><strong>{row.name}</strong><small>{row.barcode}</small></td><td>{row.previous_location_name||'Unassigned'} <span className="arrow">→</span> {row.new_location_name||'—'}</td><td><Status value={row.condition}/></td><td>{row.scanner_name||'—'}</td><td>{formatDate(row.scanned_at)}{row.latitude!=null&&row.longitude!=null&&<small>{pretty(row.capture_method||'CAMERA')} · {Number(row.latitude).toFixed(5)}, {Number(row.longitude).toFixed(5)}</small>}</td></tr>)}</tbody></table>{rows.length===0&&<Empty text="No scans recorded yet"/>}</div>}

function ImagePreview({material,close}:{material:Material;close:()=>void}){return <div className="modalBackdrop imagePreviewBackdrop" onMouseDown={event=>{if(event.currentTarget===event.target)close()}}><section className="imagePreview"><button className="imagePreviewClose" onClick={close} aria-label="Close image preview"><X/></button><img src={material.image_url||'/materials/scaffolding.jpg'} alt={material.name}/><div><span>{pretty(material.inventory_type)}</span><h2>{material.name}</h2><code>{barcodeRange(material)}</code></div></section></div>}
function Modal({title,subtitle,close,children}:{title:string;subtitle:string;close:()=>void;children:ReactNode}){return <div className="modalBackdrop" onMouseDown={event=>{if(event.currentTarget===event.target)close()}}><section className="modal"><header><div><h2>{title}</h2><p>{subtitle}</p></div><button onClick={close}><X/></button></header>{children}</section></div>}
function FormActions({close,label}:{close:()=>void;label:string}){return <div className="formActions full"><button type="button" className="secondary" onClick={close}>Cancel</button><button className="primary">{label}</button></div>}
function PanelHead({title,subtitle}:{title:string;subtitle:string}){return <div className="panelHead"><div><h2>{title}</h2><p>{subtitle}</p></div></div>}
function Status({value}:{value:string}){const tone=['DAMAGED','MISSING_PARTS','LOST','DISABLED'].includes(value)?'bad':['MINOR_ISSUE','NEEDS_MAINTENANCE','MAINTENANCE','OPEN'].includes(value)?'warn':'good';return <span className={`status ${tone}`}><i/>{pretty(value)}</span>}
function Empty({text}:{text:string}){return <div className="empty"><Archive/><strong>{text}</strong></div>}
function BarcodeLabel({value}:{value:string}){const ref=useRef<SVGSVGElement>(null);useEffect(()=>{if(ref.current)JsBarcode(ref.current,value,{format:'CODE128',width:1.45,height:44,fontSize:13,margin:8,background:'#fffdf7'})},[value]);return <div className="barcodeLabel"><svg ref={ref}/></div>}
function PrintSheet({material,close}:{material:Material;close:()=>void}){return <div className="printSheet"><button onClick={close}><X/></button><h1>{material.name}</h1><div>{material.units.map(unit=><BarcodeLabel key={unit.id} value={unit.barcode}/>)}</div></div>}
function barcodeRange(material:Material){if(!material.units.length)return 'No units';const prefix=material.inventory_type==='TOOL'?'TL':'SP';const sorted=[...material.units].sort((a,b)=>a.unit_number-b.unit_number);return `${prefix}-${material.code}-${String(sorted[0].unit_number).padStart(4,'0')} – ${prefix}-${material.code}-${String(sorted.at(-1)!.unit_number).padStart(4,'0')}`}
function pretty(value:string){return value.replaceAll('_',' ').toLowerCase().replace(/\b\w/g,char=>char.toUpperCase())}
function formatDate(value?:string){return value?new Date(value).toLocaleString():'Never'}
function currentPosition(){return new Promise<GeolocationPosition>((resolve,reject)=>{if(!navigator.geolocation){reject(new Error('GEO_UNAVAILABLE'));return}navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:true,timeout:15_000,maximumAge:15_000})})}
function geoFromPosition(position:GeolocationPosition):GeoStamp{return{latitude:position.coords.latitude,longitude:position.coords.longitude,locationAccuracy:Number.isFinite(position.coords.accuracy)?position.coords.accuracy:undefined,capturedAt:new Date().toISOString()}}
function locationError(reason:unknown){if(typeof reason==='object'&&reason&&'code'in reason){const code=Number((reason as {code:unknown}).code);if(code===1)return 'Location permission is required to record a scan';if(code===3)return 'Location request timed out. Move to an open area and retry.'}return reason instanceof Error&&reason.message!=='GEO_UNAVAILABLE'?reason.message:'This device cannot provide location coordinates'}
function cameraError(reason:unknown){if(reason instanceof DOMException&&['NotAllowedError','SecurityError'].includes(reason.name))return 'Camera permission is required to scan barcodes';if(reason instanceof DOMException&&reason.name==='NotFoundError')return 'No camera was found on this device';return reason instanceof Error?reason.message:'Unable to open the camera'}
function loadPhoto(file:File){return new Promise<HTMLImageElement>((resolve,reject)=>{const url=URL.createObjectURL(file);const image=new Image();image.onload=()=>{URL.revokeObjectURL(url);resolve(image)};image.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('Unable to read this photo'))};image.src=url})}
async function stampedImage(file:File,stamp:GeoStamp,barcode:string){
  const image=await loadPhoto(file);const max=1600;const scale=Math.min(1,max/Math.max(image.naturalWidth,image.naturalHeight));const width=Math.max(1,Math.round(image.naturalWidth*scale));const height=Math.max(1,Math.round(image.naturalHeight*scale));
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const context=canvas.getContext('2d');if(!context)throw new Error('Unable to process this photo');context.drawImage(image,0,0,width,height);
  const font=Math.max(18,Math.round(width/48));const line=Math.round(font*1.4);const band=line*3+Math.round(font*.9);context.fillStyle='rgba(19,20,19,.78)';context.fillRect(0,height-band,width,band);context.fillStyle='#fff';context.font=`700 ${font}px system-ui,sans-serif`;context.textBaseline='top';const x=Math.round(font*.75);const y=height-band+Math.round(font*.45);context.fillText(`BlueRock IMS · ${barcode||'UNIT PHOTO'}`,x,y);context.font=`500 ${Math.max(15,font*.82)}px system-ui,sans-serif`;context.fillText(new Date(stamp.capturedAt).toLocaleString(),x,y+line);context.fillStyle='#ff8a46';context.fillText(`${stamp.latitude.toFixed(6)}, ${stamp.longitude.toFixed(6)} · ±${Math.round(stamp.locationAccuracy??0)} m`,x,y+line*2);
  return canvas.toDataURL('image/jpeg',.82);
}
function fileData(file:File){return new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file)})}
