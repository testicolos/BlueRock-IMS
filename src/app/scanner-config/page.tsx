'use client';

import { useEffect,useState } from 'react';

type User={id:string;username:string;full_name:string;role:'ADMIN'|'SCANNER';active:boolean;assigned_location_id?:string|null;assigned_location_name?:string|null};
type Location={id:string;name:string;code:string};
type AppData={users:User[];locations:Location[]};

type ApiResult<T>={success:boolean;data:T;error?:{message?:string}};

export default function ScannerConfigPage(){
  const[users,setUsers]=useState<User[]>([]);const[locations,setLocations]=useState<Location[]>([]);const[error,setError]=useState('');const[saving,setSaving]=useState('');const[loading,setLoading]=useState(true);
  const token=()=>localStorage.getItem('br_token')||'';

  async function load(){
    const t=token();if(!t){window.location.replace('/');return}
    setLoading(true);setError('');
    const controller=new AbortController();
    const timeout=window.setTimeout(()=>controller.abort(),15000);
    try{
      const stored=localStorage.getItem('br_user');const role=stored?JSON.parse(stored)?.role:null;
      if(role!=='ADMIN'){window.location.replace(role==='SCANNER'?'/scan':'/');return}
      const response=await fetch('/api/app-data',{headers:{Authorization:`Bearer ${t}`},cache:'no-store',signal:controller.signal});
      const body=await response.json() as ApiResult<AppData>;
      if(!response.ok||!body.success)throw new Error(body.error?.message||'Unable to load scanner setup');
      setUsers(Array.isArray(body.data?.users)?body.data.users:[]);
      setLocations(Array.isArray(body.data?.locations)?body.data.locations:[]);
    }catch(reason){
      if(reason instanceof DOMException&&reason.name==='AbortError')setError('Scanner Setup took too long to load. Refresh the page and try again.');
      else setError(reason instanceof Error?reason.message:'Unable to load scanner setup');
    }finally{window.clearTimeout(timeout);setLoading(false)}
  }

  useEffect(()=>{void load()},[]);

  async function assign(user:User,assignedLocationId:string){
    setSaving(user.id);setError('');
    try{
      const res=await fetch(`/api/users/${user.id}`,{method:'PATCH',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token()}`},body:JSON.stringify({assignedLocationId:assignedLocationId||null}),cache:'no-store'});
      const body=await res.json();
      if(!res.ok||!body.success)throw new Error(body.error?.message||'Unable to save assignment');
      await load();
    }catch(reason){setError(reason instanceof Error?reason.message:'Unable to save assignment')}finally{setSaving('')}
  }

  const shell:React.CSSProperties={minHeight:'100vh',background:'#f3f1eb',padding:'24px 18px 80px',fontFamily:'system-ui,sans-serif',color:'#252725'};
  const card:React.CSSProperties={background:'#fff',border:'1px solid #dedbd1',borderRadius:18,padding:18,boxShadow:'0 8px 24px rgba(0,0,0,.05)'};
  const scanners=users.filter(u=>u.role==='SCANNER'&&u.active!==false);

  return <main style={shell}><div style={{maxWidth:900,margin:'0 auto'}}><header style={{marginBottom:22}}><small style={{fontWeight:800,letterSpacing:1}}>BLUE ROCK IMS / ADMIN</small><h1 style={{fontSize:34,margin:'6px 0'}}>Scanner locations</h1><p style={{margin:0,color:'#666'}}>Bind each scanner to the site they are responsible for. That assignment controls their My Site inventory and incoming transfer approvals.</p></header>{error&&<div style={{...card,marginBottom:14,borderColor:'#d56b5c',color:'#8b3328'}}>{error}</div>}<div style={{display:'grid',gap:12}}>{loading?<div style={card}>Loading scanner accounts and locations…</div>:scanners.map(user=><article key={user.id} style={card}><div style={{display:'grid',gridTemplateColumns:'minmax(180px,1fr) minmax(220px,1fr)',gap:14,alignItems:'center'}}><div><strong style={{fontSize:18}}>{user.full_name}</strong><div style={{color:'#777',marginTop:4}}>@{user.username}</div></div><label style={{fontWeight:700}}>Assigned location<select disabled={saving===user.id} value={user.assigned_location_id||''} onChange={e=>void assign(user,e.target.value)} style={{width:'100%',boxSizing:'border-box',marginTop:6,padding:'11px',border:'1px solid #cbc7bd',borderRadius:10,fontSize:16}}><option value="">Not assigned</option>{locations.map(location=><option key={location.id} value={location.id}>{location.name} ({location.code})</option>)}</select></label></div></article>)}{!loading&&!error&&scanners.length===0&&<div style={card}><strong>No active scanner accounts found.</strong><div style={{marginTop:6,color:'#666'}}>Create a user with the Scanner role from the Users page, then return here to assign its location.</div><a href="/?view=users" style={{display:'inline-block',marginTop:12,fontWeight:800,color:'#a34b18'}}>Open Users</a></div>}</div></div></main>;
}
