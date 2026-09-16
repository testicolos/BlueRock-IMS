'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';

type User={id:string;username:string;fullName?:string;full_name?:string;role:string;active?:boolean;last_login_at?:string};
type Location={id:string;name:string;code:string;location_type?:string;address?:string;active:boolean};
type Item={id:string;barcode:string;inventory_type:'TOOL'|'SAMPLE';name:string;condition:string;status:string;location_name?:string;manufacturer?:string;model?:string};
type Scan={id:string;barcode:string;name:string;inventory_type:string;previous_location_name?:string;new_location_name?:string;scanner_name?:string;condition:string;scanned_at:string};
type Issue={id:string;barcode:string;name:string;inventory_type:string;issue_type:string;description:string;status:string;location_name?:string;reported_by_name?:string;reported_at:string};
type ApiResult<T>={success:boolean;data:T;error?:{message:string}};

const nav=[['dashboard','Overview'],['inventory','Inventory'],['locations','Locations'],['users','Users'],['issues','Issues'],['scans','Scan History']] as const;

export default function Home(){
  const [token,setToken]=useState('');
  const [me,setMe]=useState<User|null>(null);
  const [view,setView]=useState('dashboard');
  const [locations,setLocations]=useState<Location[]>([]);
  const [items,setItems]=useState<Item[]>([]);
  const [users,setUsers]=useState<User[]>([]);
  const [scans,setScans]=useState<Scan[]>([]);
  const [issues,setIssues]=useState<Issue[]>([]);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');

  useEffect(()=>{const t=localStorage.getItem('br_token'); const u=localStorage.getItem('br_user'); if(t&&u){setToken(t);setMe(JSON.parse(u));}},[]);
  useEffect(()=>{if(token) loadAll();},[token]);

  async function api<T>(url:string,options:RequestInit={}){
    const res=await fetch(url,{...options,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{ }),...(options.headers||{})}});
    const body:ApiResult<T>=await res.json(); if(!body.success) throw new Error(body.error?.message||'Request failed'); return body.data;
  }
  async function loadAll(){
    try{
      const [l,i,u,s,x]=await Promise.all([api<Location[]>('/api/locations'),api<Item[]>('/api/inventory'),api<User[]>('/api/users'),api<Scan[]>('/api/scans'),api<Issue[]>('/api/issues')]);
      setLocations(l);setItems(i);setUsers(u);setScans(s);setIssues(x);
    }catch(e){setMessage(e instanceof Error?e.message:'Unable to load data');}
  }
  function logout(){localStorage.removeItem('br_token');localStorage.removeItem('br_user');setToken('');setMe(null);}

  if(!token||!me) return <Login onLogin={(t,u)=>{localStorage.setItem('br_token',t);localStorage.setItem('br_user',JSON.stringify(u));setToken(t);setMe(u);}}/>;

  const tools=items.filter(i=>i.inventory_type==='TOOL'); const samples=items.filter(i=>i.inventory_type==='SAMPLE'); const openIssues=issues.filter(i=>i.status==='OPEN');
  return <div className="appShell">
    <aside className="sidebar">
      <div className="sideBrand"><div className="logoMark">BR</div><div><strong>BlueRock IMS</strong><small>Inventory Control</small></div></div>
      <nav>{nav.map(([key,label])=><button key={key} className={view===key?'active':''} onClick={()=>setView(key)}><span>{icon(key)}</span>{label}{key==='issues'&&openIssues.length>0?<b>{openIssues.length}</b>:null}</button>)}</nav>
      <div className="sideFoot"><div className="avatar">{(me.fullName||me.username).slice(0,2).toUpperCase()}</div><div><strong>{me.fullName||me.username}</strong><small>{me.role}</small></div><button onClick={logout} title="Sign out">↗</button></div>
    </aside>
    <main className="mainArea">
      <header className="topbar"><div><small>BLUE ROCK / INVENTORY</small><h1>{nav.find(n=>n[0]===view)?.[1]}</h1></div><div className="live"><span/>Live system</div></header>
      {message&&<div className="notice" onClick={()=>setMessage('')}>{message}</div>}
      {view==='dashboard'&&<Dashboard items={items} tools={tools.length} samples={samples.length} issues={openIssues.length} locations={locations.length} scans={scans}/>} 
      {view==='inventory'&&<Inventory items={items} locations={locations} onRefresh={loadAll} api={api}/>} 
      {view==='locations'&&<Locations rows={locations} onRefresh={loadAll} api={api}/>} 
      {view==='users'&&<Users rows={users} onRefresh={loadAll} api={api}/>} 
      {view==='issues'&&<Issues rows={issues} onRefresh={loadAll} api={api}/>} 
      {view==='scans'&&<Scans rows={scans}/>} 
      {busy&&<div className="loading">Working…</div>}
    </main>
  </div>;
}

function Login({onLogin}:{onLogin:(t:string,u:User)=>void}){
 const [username,setUsername]=useState('');const[password,setPassword]=useState('');const[err,setErr]=useState('');const[busy,setBusy]=useState(false);
 async function submit(e:FormEvent){e.preventDefault();setBusy(true);setErr('');try{const r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});const b=await r.json();if(!b.success)throw new Error(b.error?.message||'Login failed');onLogin(b.data.token,b.data.user)}catch(e){setErr(e instanceof Error?e.message:'Login failed')}finally{setBusy(false)}}
 return <div className="loginPage"><div className="loginCard"><div className="loginLogo">BR</div><h1>BlueRock IMS</h1><p>Inventory Management System</p><form onSubmit={submit}><label>Username<input value={username} onChange={e=>setUsername(e.target.value)} autoComplete="username" required/></label><label>Password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="current-password" required/></label>{err&&<div className="error">{err}</div>}<button className="primary" disabled={busy}>{busy?'Signing in…':'Sign in'}</button></form><small>Authorized personnel only</small></div></div>
}

function Dashboard({items,tools,samples,issues,locations,scans}:{items:Item[];tools:number;samples:number;issues:number;locations:number;scans:Scan[]}){
 return <><section className="stats"><Stat label="Tools & Equipment" value={tools} note="Tracked assets"/><Stat label="Display Samples" value={samples} note="Tracked samples"/><Stat label="Open Issues" value={issues} note={issues?'Needs attention':'All clear'} alert={issues>0}/><Stat label="Locations" value={locations} note="Active locations"/></section><section className="twoCol"><div className="panel"><div className="panelHead"><div><h2>Recent activity</h2><p>Latest inventory movements</p></div></div><ScanTable rows={scans.slice(0,8)}/></div><div className="panel"><div className="panelHead"><div><h2>Inventory condition</h2><p>Current asset health</p></div></div><ConditionSummary items={items}/></div></section></>
}
function Stat({label,value,note,alert=false}:{label:string;value:number;note:string;alert?:boolean}){return <div className={'stat '+(alert?'statAlert':'')}><small>{label}</small><strong>{value}</strong><span>{note}</span></div>}
function ConditionSummary({items}:{items:Item[]}){const groups=['GOOD','MINOR_ISSUE','DAMAGED','MISSING_PARTS','NEEDS_MAINTENANCE'];return <div className="conditionList">{groups.map(g=>{const c=items.filter(i=>i.condition===g).length;const pct=items.length?Math.round(c/items.length*100):0;return <div key={g}><div><span>{pretty(g)}</span><b>{c}</b></div><div className="bar"><i style={{width:`${pct}%`}}/></div></div>})}</div>}

function Inventory({items,locations,onRefresh,api}:{items:Item[];locations:Location[];onRefresh:()=>void;api:<T>(u:string,o?:RequestInit)=>Promise<T>}){const[filter,setFilter]=useState('ALL');const[show,setShow]=useState(false);const rows=filter==='ALL'?items:items.filter(i=>i.inventory_type===filter);return <section className="panel"><div className="panelHead"><div><h2>Inventory</h2><p>Tools, equipment and display samples</p></div><button className="primary small" onClick={()=>setShow(!show)}>+ Add item</button></div>{show&&<ItemForm locations={locations} api={api} done={()=>{setShow(false);onRefresh()}}/>}<div className="filters"><button className={filter==='ALL'?'active':''} onClick={()=>setFilter('ALL')}>All</button><button className={filter==='TOOL'?'active':''} onClick={()=>setFilter('TOOL')}>Tools</button><button className={filter==='SAMPLE'?'active':''} onClick={()=>setFilter('SAMPLE')}>Samples</button></div><table><thead><tr><th>Asset</th><th>Barcode</th><th>Type</th><th>Location</th><th>Condition</th><th>Status</th></tr></thead><tbody>{rows.map(i=><tr key={i.id}><td><strong>{i.name}</strong><small>{[i.manufacturer,i.model].filter(Boolean).join(' · ')||'—'}</small></td><td><code>{i.barcode}</code></td><td><Badge text={i.inventory_type}/></td><td>{i.location_name||'Unassigned'}</td><td><Badge text={pretty(i.condition)} tone={i.condition==='GOOD'?'good':'warn'}/></td><td><Badge text={i.status} tone="good"/></td></tr>)}</tbody></table>{rows.length===0&&<Empty text="No inventory items yet"/>}</section>}
function ItemForm({locations,api,done}:{locations:Location[];api:<T>(u:string,o?:RequestInit)=>Promise<T>;done:()=>void}){const[f,setF]=useState({barcode:'',name:'',inventoryType:'TOOL',locationId:'',condition:'GOOD',manufacturer:'',model:''});async function submit(e:FormEvent){e.preventDefault();await api('/api/inventory',{method:'POST',body:JSON.stringify({...f,locationId:f.locationId||undefined})});done()}return <form className="inlineForm" onSubmit={submit}><input placeholder="Barcode" required value={f.barcode} onChange={e=>setF({...f,barcode:e.target.value})}/><input placeholder="Item name" required value={f.name} onChange={e=>setF({...f,name:e.target.value})}/><select value={f.inventoryType} onChange={e=>setF({...f,inventoryType:e.target.value})}><option value="TOOL">Tool / Equipment</option><option value="SAMPLE">Display Sample</option></select><select value={f.locationId} onChange={e=>setF({...f,locationId:e.target.value})}><option value="">No location</option>{locations.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select><input placeholder="Manufacturer" value={f.manufacturer} onChange={e=>setF({...f,manufacturer:e.target.value})}/><input placeholder="Model" value={f.model} onChange={e=>setF({...f,model:e.target.value})}/><button className="primary small">Create item</button></form>}

function Locations({rows,onRefresh,api}:{rows:Location[];onRefresh:()=>void;api:<T>(u:string,o?:RequestInit)=>Promise<T>}){const[show,setShow]=useState(false);const[f,setF]=useState({name:'',code:'',locationType:'Warehouse',address:''});async function submit(e:FormEvent){e.preventDefault();await api('/api/locations',{method:'POST',body:JSON.stringify(f)});setF({name:'',code:'',locationType:'Warehouse',address:''});setShow(false);onRefresh()}return <section className="panel"><div className="panelHead"><div><h2>Locations</h2><p>Managed destinations shown in the scanner app</p></div><button className="primary small" onClick={()=>setShow(!show)}>+ Add location</button></div>{show&&<form className="inlineForm" onSubmit={submit}><input placeholder="Location name" required value={f.name} onChange={e=>setF({...f,name:e.target.value})}/><input placeholder="Code" required value={f.code} onChange={e=>setF({...f,code:e.target.value})}/><input placeholder="Type" value={f.locationType} onChange={e=>setF({...f,locationType:e.target.value})}/><input placeholder="Address" value={f.address} onChange={e=>setF({...f,address:e.target.value})}/><button className="primary small">Save location</button></form>}<div className="cardGrid">{rows.map(l=><div className="locationCard" key={l.id}><div className="locationIcon">⌖</div><div><h3>{l.name}</h3><code>{l.code}</code><p>{l.location_type||'Location'}{l.address?` · ${l.address}`:''}</p></div><Badge text="ACTIVE" tone="good"/></div>)}</div>{rows.length===0&&<Empty text="No locations created yet"/>}</section>}

function Users({rows,onRefresh,api}:{rows:User[];onRefresh:()=>void;api:<T>(u:string,o?:RequestInit)=>Promise<T>}){const[show,setShow]=useState(false);const[f,setF]=useState({username:'',fullName:'',password:'',role:'SCANNER'});async function submit(e:FormEvent){e.preventDefault();await api('/api/users',{method:'POST',body:JSON.stringify(f)});setShow(false);onRefresh()}return <section className="panel"><div className="panelHead"><div><h2>Scanner & Admin Users</h2><p>Accounts allowed to access BlueRock IMS</p></div><button className="primary small" onClick={()=>setShow(!show)}>+ Add user</button></div>{show&&<form className="inlineForm" onSubmit={submit}><input placeholder="Full name" required value={f.fullName} onChange={e=>setF({...f,fullName:e.target.value})}/><input placeholder="Username" required value={f.username} onChange={e=>setF({...f,username:e.target.value})}/><input type="password" placeholder="Password (12+ chars)" minLength={12} required value={f.password} onChange={e=>setF({...f,password:e.target.value})}/><select value={f.role} onChange={e=>setF({...f,role:e.target.value})}><option value="SCANNER">Scanner</option><option value="ADMIN">Admin</option></select><button className="primary small">Create user</button></form>}<table><thead><tr><th>User</th><th>Username</th><th>Role</th><th>Status</th><th>Last login</th></tr></thead><tbody>{rows.map(u=><tr key={u.id}><td><strong>{u.full_name||u.fullName||u.username}</strong></td><td>{u.username}</td><td><Badge text={u.role}/></td><td><Badge text={u.active===false?'DISABLED':'ACTIVE'} tone={u.active===false?'warn':'good'}/></td><td>{fmt(u.last_login_at)}</td></tr>)}</tbody></table></section>}

function Issues({rows,onRefresh,api}:{rows:Issue[];onRefresh:()=>void;api:<T>(u:string,o?:RequestInit)=>Promise<T>}){async function resolve(id:string){const note=window.prompt('Resolution note');if(!note)return;await api('/api/issues',{method:'POST',body:JSON.stringify({issueId:id,resolutionNote:note})});onRefresh()}return <section className="panel"><div className="panelHead"><div><h2>Issue Queue</h2><p>Problems reported during scanning</p></div></div><table><thead><tr><th>Asset</th><th>Issue</th><th>Location</th><th>Reported by</th><th>Status</th><th/></tr></thead><tbody>{rows.map(x=><tr key={x.id}><td><strong>{x.name}</strong><small>{x.barcode}</small></td><td><strong>{x.issue_type}</strong><small>{x.description}</small></td><td>{x.location_name||'—'}</td><td>{x.reported_by_name||'—'}<small>{fmt(x.reported_at)}</small></td><td><Badge text={x.status} tone={x.status==='OPEN'?'warn':'good'}/></td><td>{x.status==='OPEN'&&<button className="ghost" onClick={()=>resolve(x.id)}>Resolve</button>}</td></tr>)}</tbody></table>{rows.length===0&&<Empty text="No issues reported"/>}</section>}
function Scans({rows}:{rows:Scan[]}){return <section className="panel"><div className="panelHead"><div><h2>Scan History</h2><p>Immutable movement audit trail</p></div><span className="count">{rows.length} records</span></div><ScanTable rows={rows}/></section>}
function ScanTable({rows}:{rows:Scan[]}){return <div className="tableWrap"><table><thead><tr><th>Asset</th><th>Movement</th><th>Condition</th><th>Scanner</th><th>Time</th></tr></thead><tbody>{rows.map(s=><tr key={s.id}><td><strong>{s.name}</strong><small>{s.barcode} · {s.inventory_type}</small></td><td>{s.previous_location_name||'Unassigned'} <span className="arrow">→</span> {s.new_location_name||'—'}</td><td><Badge text={pretty(s.condition)} tone={s.condition==='GOOD'?'good':'warn'}/></td><td>{s.scanner_name||'—'}</td><td>{fmt(s.scanned_at)}</td></tr>)}</tbody></table>{rows.length===0&&<Empty text="No scans recorded yet"/>}</div>}
function Empty({text}:{text:string}){return <div className="empty">{text}</div>}
function Badge({text,tone='blue'}:{text:string;tone?:string}){return <span className={`badge ${tone}`}>{text}</span>}
function pretty(s:string){return s.replaceAll('_',' ').toLowerCase().replace(/\b\w/g,c=>c.toUpperCase())}
function fmt(v?:string){return v?new Date(v).toLocaleString():'Never'}
function icon(k:string){return ({dashboard:'▦',inventory:'▣',locations:'⌖',users:'♙',issues:'!',scans:'↔'} as Record<string,string>)[k]||'•'}
