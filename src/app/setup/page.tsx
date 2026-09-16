'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';

export default function SetupPage(){
  const [form,setForm]=useState({fullName:'',username:'',password:'',secret:''});
  const [status,setStatus]=useState<'idle'|'busy'|'done'>('idle');
  const [message,setMessage]=useState('');
  async function submit(e:FormEvent){
    e.preventDefault(); setStatus('busy'); setMessage('');
    try{
      const res=await fetch('/api/setup/bootstrap',{method:'POST',headers:{'Content-Type':'application/json','x-bootstrap-secret':form.secret},body:JSON.stringify({fullName:form.fullName,username:form.username,password:form.password})});
      const body=await res.json(); if(!body.success)throw new Error(body.error?.message||'Setup failed');
      setStatus('done'); setMessage('Administrator created successfully. You can now sign in.');
    }catch(e){setStatus('idle');setMessage(e instanceof Error?e.message:'Setup failed')}
  }
  return <main className="setupPage"><section className="setupCard"><div className="loginLogo">BR</div><span className="setupEyebrow">FIRST-RUN SETUP</span><h1>Create BlueRock administrator</h1><p>This screen works only before the first user is created. The bootstrap secret is verified server-side and is never stored in the browser.</p>{status==='done'?<div className="setupDone"><strong>Setup complete</strong><p>{message}</p><Link className="primary setupLink" href="/">Go to sign in</Link></div>:<form onSubmit={submit}><label>Administrator full name<input required value={form.fullName} onChange={e=>setForm({...form,fullName:e.target.value})}/></label><label>Username<input required minLength={3} value={form.username} onChange={e=>setForm({...form,username:e.target.value})} autoComplete="username"/></label><label>Password<input required minLength={12} type="password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})} autoComplete="new-password"/><small>Minimum 12 characters</small></label><label>Bootstrap secret<input required type="password" value={form.secret} onChange={e=>setForm({...form,secret:e.target.value})}/></label>{message&&<div className="error">{message}</div>}<button className="primary" disabled={status==='busy'}>{status==='busy'?'Creating administrator…':'Create administrator'}</button></form>}<div className="setupBack"><Link href="/">← Back to sign in</Link></div></section></main>
}
