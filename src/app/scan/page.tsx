'use client';

import { BrowserMultiFormatReader,type IScannerControls } from '@zxing/browser';
import { AlertTriangle, Barcode, Camera, CheckCircle2, ImagePlus, ScanLine } from 'lucide-react';
import { useEffect,useRef,useState } from 'react';

type Location={id:string;name:string;code:string};
type Match={id:string;barcode:string;name:string;inventoryType:string;condition:string;status:string;currentLocationId?:string;locationName?:string;imageUrl?:string};
type Stamp={latitude:number;longitude:number;locationAccuracy?:number;capturedAt:string};
const conditions=['GOOD','MINOR_ISSUE','DAMAGED','MISSING_PARTS','NEEDS_MAINTENANCE'];

function position(){return new Promise<GeolocationPosition>((resolve,reject)=>navigator.geolocation?navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:true,timeout:15000,maximumAge:10000}):reject(new Error('Location is unavailable')))}
function stamp(p:GeolocationPosition):Stamp{return{latitude:p.coords.latitude,longitude:p.coords.longitude,locationAccuracy:Number.isFinite(p.coords.accuracy)?p.coords.accuracy:undefined,capturedAt:new Date().toISOString()}}
function imageData(file:File){return new Promise<string>((resolve,reject)=>{if(file.size>8_000_000){reject(new Error('Photo must be smaller than 8 MB'));return}const url=URL.createObjectURL(file);const image=new Image();image.onload=()=>{URL.revokeObjectURL(url);const max=1400;const scale=Math.min(1,max/Math.max(image.naturalWidth,image.naturalHeight));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));const ctx=canvas.getContext('2d');if(!ctx){reject(new Error('Unable to process this photo'));return}ctx.drawImage(image,0,0,canvas.width,canvas.height);for(const quality of [.78,.68,.58,.48,.38]){const data=canvas.toDataURL('image/jpeg',quality);if(data.length<=3_200_000){resolve(data);return}}reject(new Error('Photo is too large. Retake it closer to the item.'))};image.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('Unable to read this photo'))};image.src=url})}

export default function ScanPage(){
  const videoRef=useRef<HTMLVideoElement>(null);const controlsRef=useRef<IScannerControls|null>(null);const streamRef=useRef<MediaStream|null>(null);
  const[locations,setLocations]=useState<Location[]>([]);const[match,setMatch]=useState<Match|null>(null);const[attemptId,setAttemptId]=useState('');const[geo,setGeo]=useState<Stamp|null>(null);const[locationId,setLocationId]=useState('');const[condition,setCondition]=useState('GOOD');const[notes,setNotes]=useState('');const[reportIssue,setReportIssue]=useState(false);const[issueType,setIssueType]=useState('Damaged equipment');const[unitPhoto,setUnitPhoto]=useState('');const[defectPhoto,setDefectPhoto]=useState('');const[busy,setBusy]=useState(false);const[scanning,setScanning]=useState(false);const[error,setError]=useState('');const[message,setMessage]=useState('');
  const token=()=>localStorage.getItem('br_token')||'';
  useEffect(()=>{const t=token();if(!t){window.location.href='/';return}fetch('/api/app-data',{headers:{Authorization:`Bearer ${t}`}}).then(r=>r.json()).then(body=>{if(body.success)setLocations(body.data.locations||[])}).catch(()=>{});return()=>stopCamera()},[]);
  function stopCamera(){controlsRef.current?.stop();controlsRef.current=null;streamRef.current?.getTracks().forEach(track=>track.stop());streamRef.current=null;if(videoRef.current)videoRef.current.srcObject=null;setScanning(false)}
  function reset(){stopCamera();setMatch(null);setAttemptId('');setGeo(null);setLocationId('');setCondition('GOOD');setNotes('');setReportIssue(false);setIssueType('Damaged equipment');setUnitPhoto('');setDefectPhoto('');setError('')}
  async function validate(barcode:string){setBusy(true);setError('');try{const s=stamp(await position());const res=await fetch('/api/scans/validate',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token()}`},body:JSON.stringify({barcode,captureMethod:'CAMERA',...s})});const body=await res.json();if(!body.success)throw new Error(body.error?.message||'Unable to validate barcode');if(!body.data.matched||!body.data.item)throw new Error('Barcode not found in inventory');setGeo(s);setAttemptId(body.data.attemptId);setMatch(body.data.item);setCondition(body.data.item.condition||'GOOD')}catch(reason){setError(reason instanceof Error?reason.message:'Scan failed')}finally{setBusy(false)}}
  async function openCamera(){if(!videoRef.current||busy)return;reset();setBusy(true);setError('');try{await position();const stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'}}});streamRef.current=stream;const reader=new BrowserMultiFormatReader();setScanning(true);const controls=await reader.decodeFromStream(stream,videoRef.current,(result,_err,controls)=>{if(!result)return;controls.stop();stopCamera();void validate(result.getText())});controlsRef.current=controls}catch(reason){setError(reason instanceof Error?reason.message:'Unable to open camera')}finally{setBusy(false)}}
  async function attachPhoto(file:File,kind:'unit'|'defect'){if(!match)return;setBusy(true);setError('');try{const data=await imageData(file);if(kind==='unit')setUnitPhoto(data);else setDefectPhoto(data)}catch(reason){setError(reason instanceof Error?reason.message:'Unable to attach photo')}finally{setBusy(false)}}
  async function submit(){if(!match||!attemptId||!geo)return;if(reportIssue&&!defectPhoto){setError('Take or attach a defect photo before creating the defect report.');return}setBusy(true);setError('');setMessage('');try{const res=await fetch('/api/scans',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token()}`},body:JSON.stringify({barcode:match.barcode,locationId:locationId||undefined,condition,notes:notes||undefined,reportIssue,issueType:reportIssue?issueType:undefined,evidenceImageUrl:unitPhoto||undefined,issueImageUrl:reportIssue?defectPhoto||undefined:undefined,validationAttemptId:attemptId,captureMethod:'CAMERA',clientTransactionId:crypto.randomUUID(),...geo})});const body=await res.json();if(!body.success)throw new Error(body.error?.message||'Unable to save scan');const base=body.data.transfer?`Scan saved. Transfer to ${body.data.transfer.destination.name} is awaiting approval.`:'Scan saved. Current location was left unchanged.';setMessage(body.data.issue?base+' Defect report created.':base);setMatch(null);setAttemptId('');setGeo(null);setLocationId('');setNotes('');setReportIssue(false);setIssueType('Damaged equipment');setUnitPhoto('');setDefectPhoto('')}catch(reason){setError(reason instanceof Error?reason.message:'Unable to save scan')}finally{setBusy(false)}}
  const shell:React.CSSProperties={minHeight:'100vh',background:'#f3f1eb',padding:'24px 18px 110px',fontFamily:'system-ui,sans-serif',color:'#252725'};
  const card:React.CSSProperties={background:'#fff',border:'1px solid #dedbd1',borderRadius:18,padding:18,boxShadow:'0 8px 24px rgba(0,0,0,.05)'};
  const input:React.CSSProperties={width:'100%',boxSizing:'border-box',padding:'12px',border:'1px solid #cbc7bd',borderRadius:10,background:'#fff',fontSize:16};
  const action:React.CSSProperties={width:'100%',padding:'13px',border:0,borderRadius:11,fontWeight:900,fontSize:16,cursor:'pointer'};
  const modeCard:React.CSSProperties={display:'flex',alignItems:'center',gap:12,padding:16,borderRadius:14,border:'1px solid #d8d1c5',background:'#fff',textDecoration:'none',color:'#252725',boxShadow:'0 6px 18px rgba(0,0,0,.04)'};

  return <main style={shell}><div style={{maxWidth:900,margin:'0 auto'}}>
    <header style={{marginBottom:18}}>
      <small style={{fontWeight:800,letterSpacing:1}}>BLUE ROCK IMS</small>
      <h1 style={{fontSize:34,margin:'6px 0'}}>Scanner</h1>
      <p style={{margin:0,color:'#666'}}>Choose what you want to scan.</p>
    </header>

    <section style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(260px,1fr))',gap:12,marginBottom:18}}>
      <div style={{...modeCard,borderColor:'#ff8a46',background:'#fff5ec'}}>
        <ScanLine size={28} color="#d95f1d"/>
        <div><strong style={{display:'block'}}>Scan equipment / samples</strong><small style={{display:'block',marginTop:4,color:'#666'}}>Normal BlueRock inventory barcode scanning.</small></div>
      </div>
      <a href="/office-scan" style={{...modeCard,borderColor:'#ff8a46',background:'#fff0e3'}}>
        <Barcode size={28} color="#d95f1d"/>
        <div><strong style={{display:'block'}}>Scan Office Inventory</strong><small style={{display:'block',marginTop:4,color:'#666'}}>Scan OI barcodes for laptops, printers, monitors and office devices.</small></div>
      </a>
    </section>

    {message&&<div style={{...card,marginBottom:14,borderColor:'#72a77b',color:'#315c38'}}>{message}</div>}
    {error&&<div style={{...card,marginBottom:14,borderColor:'#d56b5c',color:'#8b3328'}}>{error}</div>}

    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(300px,1fr))',gap:16}}>
      <section style={card}>
        <div style={{position:'relative',aspectRatio:'4/3',background:'#1d1f1e',borderRadius:14,overflow:'hidden',display:'grid',placeItems:'center'}}>
          <video ref={videoRef} muted playsInline style={{width:'100%',height:'100%',objectFit:'cover'}}/>
          {!scanning&&<div style={{position:'absolute',color:'#fff',textAlign:'center'}}><Camera size={38}/><strong style={{display:'block',marginTop:8}}>Camera ready</strong></div>}
        </div>
        <button disabled={busy} onClick={scanning?stopCamera:()=>void openCamera()} style={{...action,marginTop:12,background:scanning?'#e6e2d9':'#ff8a46'}}>
          {scanning?'Stop camera':busy?'Working...':'Open barcode camera'}
        </button>
      </section>

      <section style={card}>{match?<><div style={{paddingBottom:14,borderBottom:'1px solid #eee'}}>
        <small style={{fontWeight:800,color:'#777'}}>ITEM FOUND</small>
        <h2 style={{margin:'5px 0'}}>{match.name}</h2>
        <code>{match.barcode}</code>
        <p style={{margin:'10px 0 0'}}><strong>Current location:</strong> {match.locationName||'Unassigned'}</p>
      </div>

      <div style={{marginTop:14,padding:14,border:'1px solid #e5d8c7',borderRadius:12,background:'#fff8ef'}}>
        <div style={{display:'flex',alignItems:'flex-start',gap:9}}><ImagePlus size={20} color="#d95f1d"/><div><strong>Attach unit photo</strong><small style={{display:'block',marginTop:3,color:'#666'}}>Optional photo evidence for this scan.</small></div></div>
        <label style={{...action,display:'block',boxSizing:'border-box',marginTop:10,background:'#eee8df',textAlign:'center'}}>
          {unitPhoto?'Replace unit photo':'Take / attach unit photo'}
          <input type="file" accept="image/*" capture="environment" hidden disabled={busy} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void attachPhoto(file,'unit')}}/>
        </label>
        {unitPhoto&&<img src={unitPhoto} alt="Unit evidence" style={{width:'100%',marginTop:10,borderRadius:10,maxHeight:220,objectFit:'cover'}}/>}
      </div>

      <label style={{display:'block',marginTop:14,fontWeight:700}}>New location <small style={{fontWeight:500,color:'#777'}}>(optional)</small>
        <select value={locationId} onChange={e=>setLocationId(e.target.value)} style={{...input,marginTop:6}}>
          <option value="">Keep current location</option>
          {locations.filter(l=>l.id!==match.currentLocationId).map(l=><option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </label>

      <label style={{display:'block',marginTop:14,fontWeight:700}}>Condition
        <select value={condition} onChange={e=>setCondition(e.target.value)} style={{...input,marginTop:6}}>
          {conditions.map(c=><option key={c} value={c}>{c.replaceAll('_',' ')}</option>)}
        </select>
      </label>

      <label style={{display:'block',marginTop:14,fontWeight:700}}>Notes
        <textarea value={notes} onChange={e=>setNotes(e.target.value)} style={{...input,marginTop:6,minHeight:85}} placeholder="Optional notes"/>
      </label>

      <label style={{display:'flex',alignItems:'center',gap:9,marginTop:16,padding:12,border:'1px solid #e9a17a',borderRadius:10,background:'#fff1e8',fontWeight:800}}>
        <input type="checkbox" checked={reportIssue} onChange={e=>{const checked=e.target.checked;setReportIssue(checked);if(checked&&condition==='GOOD')setCondition('DAMAGED');if(!checked)setDefectPhoto('')}}/>
        <AlertTriangle size={18} color="#b84315"/> Report this item as defective
      </label>

      {reportIssue&&<section style={{marginTop:12,padding:14,border:'2px solid #ff8a46',borderRadius:12,background:'#fff3e8'}}>
        <div style={{display:'flex',alignItems:'flex-start',gap:9}}>
          <AlertTriangle size={22} color="#b84315"/>
          <div><strong>Defect photo required</strong><small style={{display:'block',marginTop:3,color:'#765746'}}>Take a clear photo of the damaged area before submitting.</small></div>
        </div>
        <label style={{display:'block',marginTop:12,fontWeight:700}}>Issue type
          <input value={issueType} onChange={e=>setIssueType(e.target.value)} style={{...input,marginTop:6}}/>
        </label>
        <label style={{...action,display:'block',boxSizing:'border-box',marginTop:12,background:'#ff8a46',textAlign:'center'}}>
          <Camera size={17} style={{verticalAlign:'middle',marginRight:7}}/>
          {defectPhoto?'Retake / replace defect photo':'Take / attach defect photo'}
          <input type="file" accept="image/*" capture="environment" hidden disabled={busy} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void attachPhoto(file,'defect')}}/>
        </label>
        {defectPhoto?<><img src={defectPhoto} alt="Defect evidence" style={{width:'100%',marginTop:10,borderRadius:10,maxHeight:240,objectFit:'cover'}}/><div style={{display:'flex',alignItems:'center',gap:7,marginTop:9,color:'#3f713c',fontWeight:700}}><CheckCircle2 size={17}/> Defect photo attached</div></>:<div style={{marginTop:9,color:'#a03e1b',fontWeight:700}}>Defect photo is required before the report can be created.</div>}
      </section>}

      <button disabled={busy} onClick={()=>void submit()} style={{...action,marginTop:16,background:'#ff8a46'}}>
        {busy?'Saving...':reportIssue?'Save scan & create defect report':locationId?'Save scan & request transfer':'Save scan'}
      </button>
      </>:<div style={{minHeight:300,display:'grid',placeItems:'center',textAlign:'center',color:'#777'}}><div><h2 style={{color:'#333'}}>No item scanned yet</h2><p>Open the camera and scan a registered barcode.</p></div></div>}</section>
    </div>
  </div></main>;
}
