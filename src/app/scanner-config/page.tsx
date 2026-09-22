'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest } from '@/lib/client-api';
import { useSessionUser } from '../session-gate';

type ScanAccess='MATERIALS'|'OFFICE'|'BOTH';
type User={id:string;username:string;full_name:string;role:'ADMIN'|'SCANNER';active:boolean;assigned_location_id?:string|null;assigned_location_name?:string|null;scanner_access?:ScanAccess};
type Location={id:string;name:string;code:string};
type SetupData={users:User[];locations:Location[]};

export default function ScannerConfigPage(){
  const me=useSessionUser();
  const[users,setUsers]=useState<User[]>([]);const[locations,setLocations]=useState<Location[]>([]);
  const[error,setError]=useState('');const[saving,setSaving]=useState('');const[loading,setLoading]=useState(true);const[message,setMessage]=useState('');
  const pending=useRef<AbortController|null>(null);
  const load=useCallback(async()=>{
    pending.current?.abort();const controller=new AbortController();pending.current=controller;
    setLoading(true);setError('');
    try{
      const data=await apiRequest<SetupData>('/api/scanner-setup',{headers:{Authorization:`Bearer ${localStorage.getItem('br_token')||''}`},signal:controller.signal});
      if(!Array.isArray(data?.users)||!Array.isArray(data.locations))throw new Error('Scanner Setup returned an invalid response. Please retry.');
      setUsers(data.users);setLocations(data.locations);
    }catch(reason){if(!controller.signal.aborted)setError(reason instanceof Error?reason.message:'Unable to load scanner setup')}
    finally{if(!controller.signal.aborted)setLoading(false)}
  },[]);
  useEffect(()=>{if(me?.role==='ADMIN')void load();return()=>pending.current?.abort()},[me?.role,load]);
  async function save(user:User,changes:{assignedLocationId?:string|null;scannerAccess?:ScanAccess}){
    if(saving)return;setSaving(user.id);setError('');setMessage('');
    try{
      const saved=await apiRequest<User>(`/api/users/${user.id}`,{method:'PATCH',headers:{Authorization:`Bearer ${localStorage.getItem('br_token')||''}`},body:JSON.stringify(changes)});
      setUsers(rows=>rows.map(row=>row.id===saved.id?{...row,...saved}:row));
      setMessage('Scanner setup saved.');
    }catch(reason){setError(reason instanceof Error?reason.message:'Unable to save scanner setup')}finally{setSaving('')}
  }
  const shell:React.CSSProperties={minHeight:'100vh',background:'#f3f1eb',padding:'24px 18px 100px',fontFamily:'system-ui,sans-serif',color:'#252725'};
  const card:React.CSSProperties={background:'#fff',border:'1px solid #dedbd1',borderRadius:18,padding:18,boxShadow:'0 8px 24px rgba(0,0,0,.05)'};
  if(me?.role!=='ADMIN')return null;
  return <main style={shell}><div style={{maxWidth:900,margin:'0 auto'}}><header style={{marginBottom:22}}><small style={{fontWeight:800,letterSpacing:1}}>BLUE ROCK IMS / ADMIN</small><h1 style={{fontSize:34,margin:'6px 0'}}>Scanner setup</h1><p>Assign each scanner to a site and choose whether they can scan Materials / Samples, Office Inventory, or both.</p><button type="button" disabled={loading||Boolean(saving)} onClick={()=>void load()}>Refresh</button></header>{error&&<div role="alert" style={{...card,marginBottom:14,color:'#8b3328'}}>{error}</div>}{message&&<p role="status">{message}</p>}<div style={{display:'grid',gap:12}}>{loading?<div role="status" style={card}>Loading scanner accounts and locations...</div>:users.map(user=><article key={user.id} style={card}><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:14,alignItems:'center'}}><div><strong style={{fontSize:18}}>{user.full_name}</strong><div style={{color:'#777',marginTop:4}}>@{user.username}</div></div><label style={{fontWeight:700}}>Assigned location<select disabled={Boolean(saving)} value={user.assigned_location_id||''} onChange={event=>void save(user,{assignedLocationId:event.target.value||null})} style={{width:'100%',boxSizing:'border-box',marginTop:6,padding:11,border:'1px solid #cbc7bd',borderRadius:10,fontSize:16}}><option value="">Not assigned</option>{user.assigned_location_id&&!locations.some(location=>location.id===user.assigned_location_id)&&<option value={user.assigned_location_id} disabled>Assigned location is inactive</option>}{locations.map(location=><option key={location.id} value={location.id}>{location.name} ({location.code})</option>)}</select></label><label style={{fontWeight:700}}>Scan access<select disabled={Boolean(saving)} value={user.scanner_access||'MATERIALS'} onChange={event=>void save(user,{scannerAccess:event.target.value as ScanAccess})} style={{width:'100%',boxSizing:'border-box',marginTop:6,padding:11,border:'1px solid #cbc7bd',borderRadius:10,fontSize:16}}><option value="MATERIALS">Materials / Samples</option><option value="OFFICE">Office Inventory</option><option value="BOTH">Both</option></select></label></div></article>)}{!loading&&!error&&users.length===0&&<div style={card}><strong>No active scanner accounts found.</strong><p>Create a Scanner-role user from Users, then return to assign its location.</p><a href="/?view=users">Open Users</a></div>}</div></div></main>;
}
