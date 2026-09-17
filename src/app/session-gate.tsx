'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { SessionUser } from '@/lib/auth';
import { ApiError, apiRequest, clearSession, SESSION_EVENT } from '@/lib/client-api';

type Session = { user: SessionUser; expiresAt: string };
const SessionContext = createContext<SessionUser | null>(null);
export const useSessionUser = () => useContext(SessionContext);

export default function SessionGate({ children }: { children: ReactNode }) {
  const pathname = usePathname(); const router = useRouter();
  const [state, setState] = useState<'checking'|'ready'|'signedOut'|'error'>('checking');
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState('');
  const pending = useRef<AbortController | null>(null);
  const sequence = useRef(0); const lastCheck = useRef(0);
  const verified = useRef<{ token: string; session: Session } | null>(null);

  const check = useCallback(async () => {
    const current = ++sequence.current;
    pending.current?.abort();
    const controller = new AbortController(); pending.current = controller;
    lastCheck.current = Date.now();
    let token: string | null = null;
    try {
      token = localStorage.getItem('br_token');
      const stored = localStorage.getItem('br_user');
      // Malformed saved JSON must never crash the legacy root page.
      if (stored) { try { JSON.parse(stored); } catch { localStorage.removeItem('br_user'); } }
      if (!token) { verified.current = null; setSession(null); setState('signedOut'); return; }
      const result = await apiRequest<Session>('/api/auth/session', {
        headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
      });
      if (current !== sequence.current || localStorage.getItem('br_token') !== token) return;
      if (!result?.user || !['ADMIN','SCANNER'].includes(result.user.role) || !Number.isFinite(Date.parse(result.expiresAt))) throw new Error('Invalid session response. Please sign in again.');
      localStorage.setItem('br_user', JSON.stringify(result.user));
      verified.current = { token, session: result };
      setSession(result); setError(''); setState('ready');
    } catch (reason) {
      if (current !== sequence.current || controller.signal.aborted) return;
      if (reason instanceof ApiError && reason.status === 401) {
        verified.current = null; setSession(null); setState('signedOut'); return;
      }
      setError(reason instanceof Error ? reason.message : 'Unable to verify your session.');
      // A transient resume check must not unmount a scanner's unsaved form.
      // Only an already-verified, still-unexpired token may keep its UI mounted.
      const previous = verified.current;
      if (previous?.token === token && Date.parse(previous.session.expiresAt) > Date.now()) setState('ready');
      else setState('error');
    }
  }, []);

  useEffect(() => {
    void check();
    const changed = () => { setState('checking'); void check(); };
    const storage = (event: StorageEvent) => { if (!event.key || event.key === 'br_token' || event.key === 'br_user') changed(); };
    const resumed = () => { if (document.visibilityState === 'visible' && Date.now() - lastCheck.current > 30_000) void check(); };
    window.addEventListener(SESSION_EVENT, changed); window.addEventListener('storage', storage);
    window.addEventListener('focus', resumed); document.addEventListener('visibilitychange', resumed);
    return () => {
      ++sequence.current; pending.current?.abort();
      window.removeEventListener(SESSION_EVENT, changed); window.removeEventListener('storage', storage);
      window.removeEventListener('focus', resumed); document.removeEventListener('visibilitychange', resumed);
    };
  }, [check]);

  useEffect(() => {
    if (!session || state !== 'ready') return;
    const delay = Math.max(0, Date.parse(session.expiresAt) - Date.now());
    const timer = window.setTimeout(() => { setState('checking'); void check(); }, Math.min(delay + 100, 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [session, state, check]);

  const publicPage = pathname === '/login' || pathname === '/setup';
  useEffect(() => {
    if (state === 'signedOut' && !publicPage) router.replace('/login');
    if (state === 'ready' && session && (pathname === '/login' || (pathname === '/' && session.user.role === 'SCANNER'))) router.replace(session.user.role === 'SCANNER' ? '/scan' : '/?view=dashboard');
    if (state === 'ready' && session?.user.role === 'SCANNER' && pathname === '/scanner-config') router.replace('/scan');
  }, [state, session, pathname, publicPage, router]);

  if (pathname === '/setup' || (pathname === '/login' && state === 'signedOut')) return <SessionContext.Provider value={null}>{children}</SessionContext.Provider>;
  if (state === 'error') return <main className="loginPage"><section className="loginPanel"><div role="alert"><h1>Unable to verify your session</h1><p>{error}</p><button className="primary" onClick={() => { setState('checking'); void check(); }}>Retry connection</button><button type="button" onClick={() => clearSession()}>Return to sign in</button></div></section></main>;
  if (state !== 'ready' || !session || pathname === '/login' || (pathname === '/' && session.user.role === 'SCANNER') || (pathname === '/scanner-config' && session.user.role !== 'ADMIN')) return <main className="dataLoading" role="status"><h2>Checking your session...</h2></main>;
  return <SessionContext.Provider value={session.user}>{error&&<div role="status" className="notice">Connection check delayed. {error}<button type="button" onClick={()=>void check()}>Retry connection</button></div>}{children}</SessionContext.Provider>;
}
