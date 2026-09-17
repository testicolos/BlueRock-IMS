'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { createPortal } from 'react-dom';
import { clearSession } from '@/lib/client-api';
import { useSessionUser } from './session-gate';

export default function ScannerNav(){
  const pathname=usePathname();const user=useSessionUser();const role=user?.role;
  const[adminNav,setAdminNav]=useState<HTMLElement|null>(null);
  useEffect(()=>{
    if(role!=='ADMIN'||pathname!=='/'){setAdminNav(null);return}
    const find=()=>{
      // Compatibility with the legacy Home logout: it clears localStorage and
      // removes its sidebar. Notify the shared gate without polling auth state.
      if(!localStorage.getItem('br_token')){clearSession();return}
      setAdminNav(document.querySelector<HTMLElement>('#main-navigation nav'));
    };
    find();const observer=new MutationObserver(find);
    observer.observe(document.body,{childList:true,subtree:true});
    return()=>observer.disconnect();
  },[role,pathname]);
  if(!role)return null;
  if(role==='ADMIN'){
    if(pathname==='/scanner-config'){
      const bar:React.CSSProperties={position:'fixed',zIndex:10000,left:'50%',bottom:'calc(16px + env(safe-area-inset-bottom))',transform:'translateX(-50%)',display:'flex',gap:6,padding:6,borderRadius:18,background:'rgba(24,26,25,.94)',boxShadow:'0 12px 35px rgba(0,0,0,.28)',backdropFilter:'blur(12px)'};
      const link:React.CSSProperties={textDecoration:'none',fontFamily:'system-ui,sans-serif',fontWeight:800,fontSize:14,padding:'11px 18px',borderRadius:13,color:'#1b1d1c',background:'#ff8a46',whiteSpace:'nowrap'};
      return <nav aria-label="Admin navigation" style={bar}><Link href="/" prefetch={false} style={link}>Back to Admin</Link></nav>;
    }
    return adminNav?createPortal(<Link href="/scanner-config" prefetch={false} style={{display:'flex',alignItems:'center',gap:12,padding:'13px 16px',color:'inherit',textDecoration:'none'}}><span aria-hidden="true" style={{width:19,height:19,display:'grid',placeItems:'center',fontSize:18}}>⌖</span><span>Scanner Setup</span></Link>,adminNav):null;
  }
  const base:React.CSSProperties={position:'fixed',zIndex:10000,left:'50%',bottom:'calc(16px + env(safe-area-inset-bottom))',transform:'translateX(-50%)',display:'flex',gap:6,padding:6,borderRadius:18,background:'rgba(24,26,25,.94)',boxShadow:'0 12px 35px rgba(0,0,0,.28)',backdropFilter:'blur(12px)'};
  const link=(active:boolean):React.CSSProperties=>({textDecoration:'none',border:0,fontFamily:'system-ui,sans-serif',fontWeight:800,fontSize:14,padding:'11px 18px',borderRadius:13,color:active?'#1b1d1c':'#fff',background:active?'#ff8a46':'transparent',whiteSpace:'nowrap',cursor:'pointer'});
  return <nav aria-label="Scanner views" style={base}><Link href="/scan" prefetch={false} style={link(pathname==='/scan')}>Scan</Link><Link href="/site" prefetch={false} style={link(pathname==='/site')}>My Site</Link><button type="button" onClick={()=>clearSession()} style={link(false)}>Logout</button></nav>;
}
