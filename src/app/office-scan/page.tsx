'use client';

import { BrowserMultiFormatReader,type IScannerControls } from '@zxing/browser';
import { ArrowLeft, Camera, CheckCircle2, Keyboard, RefreshCw, ScanLine, UserRound, X } from 'lucide-react';
import { useEffect,useRef,useState } from 'react';

type Session={id:string;status:'OPEN'|'CLOSED';started_at:string;total:number;validated:number};
type SessionResponse={sessions:Session[];sessionId:string|null;targets:unknown[]};
type Item={id:string;barcode:string;name:string;category:string;manufacturer?:string|null;model?:string|null;serialNumber?:string|null;ownerName?:string|null;locationName?:string|null;condition:string;status:string;alreadyValidated?:boolean};
const conditions=['GOOD','MINOR_ISSUE','DAMAGED','MISSING_PARTS','NEEDS_MAINTENANCE'];

export default function OfficeScanPage(){
  const videoRef=useRef<HTMLVideoElement>(null);const controlsRef=useRef<IScannerControls|null>(null);const streamRef=useRef<MediaStream|null>(null);
  const[session,setSession]=useState<Session|null>(null);const[item,setItem]=useState<Item|null>(null);const[manual,setManual]=useState('');const[condition,setCondition]=useState('GOOD');const[busy,setBusy]=useState(false);const[scanning,setScanning]=useState(false);const[error,setError]=useState('');const[message,setMessage]=useState('');
  const token=()=>localStorage.getItem('br_token')||'';
  async function request<T>(url:string,options:RequestInit={}){
    const response=await fetch(url,{...options,headers:{'Content-Type':'application/json',Authorization:'Bearer '+token(),...(options.headers||{})}});
    const body=await response.json();if(!body.success)throw new Error(body.error?.message||'Request failed');return body.data as T;
  }
  async function load(){
    if(!token()){window.location.href='/';return}
    try{const data=await request<SessionResponse>('/api/office-validation-sessions?summary=1',{cache:'no-store'});setSession(data.sessions.find(row=>row.status==='OPEN')||null)}catch(reason){setError(reason instanceof Error?reason.message:'Unable to load validation request')}
  }
  useEffect(()=>{void load();return()=>stopCamera()},[]);
  function stopCamera(){controlsRef.current?.stop();controlsRef.current=null;streamRef.current?.getTracks().forEach(track=>track.stop());streamRef.current=null;if(videoRef.current)videoRef.current.srcObject=null;setScanning(false)}
  async function scanBarcode(value:string){
    if(!session||busy)return;const barcode=value.trim().toUpperCase();if(barcode.length<3){setError('Enter a valid Office Inventory barcode');return}
    setBusy(true);setError('');setMessage('');
    try{
      const result=await request<Item>('/api/office-validation/validate',{method:'POST',body:JSON.stringify({sessionId:session.id,barcode})});
      setItem(result);setCondition(result.condition||'GOOD');setManual('');
      if(result.alreadyValidated)setMessage(result.barcode+' is already validated in this request. You can confirm again to add another scan-history entry.');
    }catch(reason){setItem(null);setError(reason instanceof Error?reason.message:'Unable to match office item')}finally{setBusy(false)}
  }
  async function confirmValidation(){
    if(!session||!item||busy)return;
    setBusy(true);setError('');setMessage('');
    try{
      const result=await request<{duplicate:boolean;item:Item;scannedAt:string}>('/api/office-validation/scan',{method:'POST',body:JSON.stringify({sessionId:session.id,barcode:item.barcode,condition})});
      setItem({...result.item,alreadyValidated:true});
      setMessage(result.duplicate?result.item.barcode+' was already validated. This confirmation was added to scan history.':result.item.barcode+' validated successfully.');
      await load();
    }catch(reason){setError(reason instanceof Error?reason.message:'Unable to validate office item')}finally{setBusy(false)}
  }
  async function openCamera(){
    if(!videoRef.current||busy||!session)return;stopCamera();setError('');setMessage('');
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'}}});streamRef.current=stream;setScanning(true);
      const reader=new BrowserMultiFormatReader();
      const controls=await reader.decodeFromStream(stream,videoRef.current,(result,_err,activeControls)=>{if(!result)return;activeControls.stop();stopCamera();void scanBarcode(result.getText())});controlsRef.current=controls;
    }catch(reason){setError(reason instanceof Error?reason.message:'Unable to open camera');stopCamera()}
  }
  const shell:React.CSSProperties={minHeight:'100vh',background:'#f3f1eb',padding:'24px 18px 80px',fontFamily:'system-ui,sans-serif',color:'#252725'};
  const card:React.CSSProperties={background:'#fff',border:'1px solid #dedbd1',borderRadius:18,padding:18,boxShadow:'0 8px 24px rgba(0,0,0,.05)'};
  const input:React.CSSProperties={width:'100%',boxSizing:'border-box',padding:'12px',border:'1px solid #cbc7bd',borderRadius:10,background:'#fff',fontSize:16};
  const button:React.CSSProperties={padding:'13px 16px',border:0,borderRadius:11,fontWeight:800,fontSize:15,cursor:'pointer'};
  return <main style={shell}><div style={{maxWidth:980,margin:'0 auto'}}>
    <header style={{display:'flex',justifyContent:'space-between',gap:14,alignItems:'center',marginBottom:18}}><div><small style={{fontWeight:800,letterSpacing:1}}>BLUE ROCK IMS / OFFICE INVENTORY</small><h1 style={{fontSize:34,margin:'6px 0'}}>Office Inventory Validation</h1><p style={{margin:0,color:'#666'}}>Scan office assets to validate them. Owner is view-only for scanner users and no transfer can be created.</p></div><a href="/" style={{...button,background:'#e8e4da',color:'#252725',textDecoration:'none',display:'inline-flex',gap:8,alignItems:'center'}}><ArrowLeft size={18}/> Back</a></header>
    {!session&&<section style={{...card,textAlign:'center',padding:32}}><ScanLine size={42}/><h2>No active Office Inventory validation request</h2><p>An administrator must start a request from the Office Inventory page before devices can be validated.</p><button onClick={()=>void load()} style={{...button,background:'#ff8a46'}}><RefreshCw size={17}/> Refresh</button></section>}
    {session&&<>
      <section style={{...card,marginBottom:16}}><strong>Validation request active</strong><p style={{margin:'6px 0 0'}}>Progress: {session.validated} of {session.total} assets validated.</p></section>
      {message&&<div style={{...card,marginBottom:14,borderColor:'#72a77b',color:'#315c38'}}>{message}</div>}{error&&<div style={{...card,marginBottom:14,borderColor:'#d56b5c',color:'#8b3328'}}>{error}</div>}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(320px,1fr))',gap:16}}>
        <section style={card}><div style={{position:'relative',aspectRatio:'4/3',background:'#1d1f1e',borderRadius:14,overflow:'hidden',display:'grid',placeItems:'center'}}><video ref={videoRef} muted playsInline style={{width:'100%',height:'100%',objectFit:'cover'}}/>{!scanning&&<div style={{position:'absolute',color:'#fff',textAlign:'center'}}><Camera size={42}/><strong style={{display:'block',marginTop:8}}>Camera ready</strong></div>}</div><button disabled={busy} onClick={scanning?stopCamera:()=>void openCamera()} style={{...button,width:'100%',marginTop:12,background:scanning?'#e6e2d9':'#ff8a46'}}>{scanning?<><X size={17}/> Stop camera</>:<><Camera size={17}/> Open barcode camera</>}</button><div style={{marginTop:18,borderTop:'1px solid #e6e2d9',paddingTop:16}}><label style={{fontWeight:700,display:'block',marginBottom:7}}><Keyboard size={17}/> Manual barcode</label><div style={{display:'flex',gap:8}}><input style={input} placeholder="OI-LAP-0001" value={manual} onChange={e=>setManual(e.target.value.toUpperCase())} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();void scanBarcode(manual)}}}/><button disabled={busy||manual.trim().length<3} style={{...button,background:'#e8e4da'}} onClick={()=>void scanBarcode(manual)}>Validate</button></div></div></section>
        <section style={card}>{item?<><div style={{display:'flex',alignItems:'center',gap:8,color:'#315c38'}}><CheckCircle2 size={20}/><strong>Office Inventory match</strong></div><h2 style={{marginBottom:4}}>{item.name}</h2><code>{item.barcode}</code><dl style={{display:'grid',gridTemplateColumns:'140px 1fr',gap:'10px 12px',marginTop:20}}><dt>Category</dt><dd>{item.category}</dd><dt>Manufacturer</dt><dd>{item.manufacturer||'—'}</dd><dt>Model</dt><dd>{item.model||'—'}</dd><dt>Serial number</dt><dd>{item.serialNumber||'—'}</dd><dt><UserRound size={15}/> Owner</dt><dd><strong>{item.ownerName||'Unassigned'}</strong></dd><dt>Location</dt><dd>{item.locationName||'Unassigned'}</dd><dt>Status</dt><dd>{pretty(item.status)}</dd></dl></>:<div style={{textAlign:'center',padding:'24px 0'}}><ScanLine size={40}/><h2>No item scanned yet</h2><p>Scan an OI barcode to see the registered device and its owner.</p></div>}<label style={{display:'block',fontWeight:700,marginTop:18}}>Condition<select style={{...input,marginTop:7}} value={condition} onChange={e=>setCondition(e.target.value)}>{conditions.map(value=><option key={value}>{pretty(value)}</option>)}</select></label><button disabled={busy||!item} onClick={()=>void confirmValidation()} style={{...button,width:'100%',marginTop:16,background:'#ff8a46'}}><CheckCircle2 size={17}/> {busy?'Saving…':item?.alreadyValidated?'Confirm again':'Confirm validation'}</button><small style={{display:'block',marginTop:10,color:'#666'}}>Review the device and owner, choose the current condition, then confirm. Owner cannot be changed from this page.</small></section>
      </div>
    </>}
  </div></main>
}
function pretty(value:string){return value.replaceAll('_',' ').toLowerCase().replace(/\b\w/g,char=>char.toUpperCase())}
