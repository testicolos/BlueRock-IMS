'use client';

import { useEffect,useState } from 'react';

type User={id:string;username:string;full_name:string;role:'ADMIN'|'SCANNER';active:boolean;assigned_location_id?:string|null;assigned_location_name?:string|null};
type Location={id:string;name:string;code:string};

export default function ScannerConfigPage(){
  const[users,setUsers]=useState<User[]>([]);const[locations,setLocations]=useState<Location[]>([]);const[error,setError]=useState('');const[saving,setSaving]=useState('');
  const token=()=>localStorage.getItem('br_token')||'';
  async function load(){
    const t=token();if(!t){window.location.href='/';return}
    try{
      const headers={Authorization:`Bearer ${t}`};
      const[userRes,locationRes]=await Promise.all([fetch('/api/users',{headers,cache:'no-store'}),fetch('/api/locations',{headers,cache:'no-store'})]);
      const[userBody,locationBody]=await Promise.all([userRes.json(),locationRes.json()]);
      if(!userBody.success)throw new Error(userBody.error?.message||'Unable to load users');
      if(!locationBody.success)throw new Error(locationBody.error?.message||'Unable to load locations');
      setUsers(userBody.data);setLocations(locationBody.data);setError('');
    }catch(reason){setError(reason instanceof Error?reason.message:'Unable to load scanner setup')}
  }
  useEffect(()=>{void load()},[]);
  async function assign(user:User,assignedLocationId:string){
    setSaving(user.id);setError('');
    try{const res=await fetch(`/api/users/${user.id}`,{method:'PATCH',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token()}`},body:JSON.stringify({assignedLocationId:assignedLocationId||null})});const body=await res.json();if(!body.success)throw new Error(body.error?.message||'Unable to save assignment');await load()}catch(reason){setError(reason instanceof Error?reason.message:'Unable to save assignment')}finally{setSaving('')}
  }
  const shell:React.CSSProperties={minHeight:'100vh',background:'#f3f1eb',padding:'24px 18px 80px',fontFamily:'system-ui,sans-serif',color:'#252725'};const card:React.CSSProperties={background:'#fff',border:'1px solid #dedbd1',borderRadius:18,padding:18,boxShadow:'0 8px 24px rgba(0,0,0,.05)'};
  const scanners=users.filter(u=>u.role==='SCANNER');
  return <main style={shell}><div style={{maxWidth:900,margin:'0 auto'}}><header style={{marginBottom:22}}><small style={{fontWeight:800,letterSpacing:1}}>BLUE ROCK IMS / ADMIN</small><h1 style={{fontSize:34,margin:'6px 0'}}>Scanner locations</h1><p style={{margin:0,color:'#666'}}>Bind each scanner to the site they are responsible for. That assignment controls their My Site inventory and incoming transfer approvals.</p></header>{error&&<div style={{...card,marginBottom:14,borderColor:'#d56b5c',color:'#8b3328'}}>{error}</div>}<div style={{display:'grid',gap:12}}>{scanners.map(user=><article key={user.id} style={card}><div style={{display:'grid',gridTemplateColumns:'minmax(180px,1fr) minmax(220px,1fr)',gap:14,alignItems:'center'}}><div><strong style={{fontSize:18}}>{user.full_name}</strong><div style={{color:'#777',marginTop:4}}>@{user.username}</div></div><label style={{fontWeight:700}}>Assigned location<select disabled={saving===user.id} value={user.assigned_location_id||''} onChange={e=>void assign(user,e.target.value)} style={{width:'100%',boxSizing:'border-box',marginTop:6,padding:'11px',border:'1px solid #cbc7bd',borderRadius:10,fontSize:16}}><option value="">Not assigned</option>{locations.map(location=><option key={location.id} value={location.id}>{location.name} ({location.code})</option>)}</select></label></div></article>)}{scanners.length===0&&<div style={card}>No scanner accounts found.</div>}</div></div></main>;
}
