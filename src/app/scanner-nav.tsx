'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

type Role='ADMIN'|'SCANNER'|null;

export default function ScannerNav(){
  const pathname=usePathname();
  const[role,setRole]=useState<Role>(null);
  useEffect(()=>{
    const read=()=>{
      try{const raw=localStorage.getItem('br_user');const next=raw?JSON.parse(raw)?.role:null;setRole(next==='ADMIN'||next==='SCANNER'?next:null)}catch{setRole(null)}
    };
    read();
    const timer=window.setInterval(read,750);
    window.addEventListener('storage',read);
    return()=>{window.clearInterval(timer);window.removeEventListener('storage',read)};
  },[]);
  if(!role)return null;
  const base:React.CSSProperties={position:'fixed',zIndex:10000,left:'50%',bottom:'calc(16px + env(safe-area-inset-bottom))',transform:'translateX(-50%)',display:'flex',gap:6,padding:6,borderRadius:18,background:'rgba(24,26,25,.94)',boxShadow:'0 12px 35px rgba(0,0,0,.28)',backdropFilter:'blur(12px)'};
  const link=(active:boolean):React.CSSProperties=>({textDecoration:'none',fontFamily:'system-ui,sans-serif',fontWeight:800,fontSize:14,padding:'11px 18px',borderRadius:13,color:active?'#1b1d1c':'#fff',background:active?'#ff8a46':'transparent',whiteSpace:'nowrap'});
  if(role==='ADMIN')return <nav aria-label="Admin scanner setup" style={base}><a href="/scanner-config" style={link(pathname==='/scanner-config')}>Scanner Setup</a></nav>;
  return <nav aria-label="Scanner views" style={base}><a href="/scan" style={link(pathname==='/scan')}>Scan</a><a href="/site" style={link(pathname==='/site')}>My Site</a></nav>;
}
