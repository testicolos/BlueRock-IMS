'use client';

import { useState, type FormEvent } from 'react';
import type { SessionUser } from '@/lib/auth';
import { apiRequest, getClientDiagnostics, SESSION_EVENT } from '@/lib/client-api';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(''); setCopied('');
    try {
      const result = await apiRequest<{ token: string; user: SessionUser }>('/api/auth/login', {
        method: 'POST', body: JSON.stringify({ username: username.trim(), password }),
      });
      if (!result?.token || !result.user?.id || !['ADMIN','SCANNER'].includes(result.user.role)) throw new Error('The server returned an invalid session. Please try again.');
      localStorage.setItem('br_token', result.token); localStorage.setItem('br_user', JSON.stringify(result.user));
      sessionStorage.removeItem('br_session_notice'); setPassword('');
      window.dispatchEvent(new Event(SESSION_EVENT));
      // SessionGate verifies the account and routes by its server-side role.
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to sign in.'); }
    finally { setBusy(false); }
  }
  async function copyDiagnostics() {
    try { await navigator.clipboard.writeText(JSON.stringify(getClientDiagnostics(), null, 2)); setCopied('Diagnostic reference log copied. No passwords or tokens are included.'); }
    catch { setCopied('Clipboard is unavailable. The same sanitized request references are in the browser console.'); }
  }
  return <main className="loginPage"><section className="loginIntro"><div className="brandMark large"><span/></div><p>BLUE ROCK</p><h1>Every asset.<br/>Every movement.<br/><em>Accounted for.</em></h1><small>Tools, equipment and display sample control for stronger operations.</small></section><section className="loginPanel"><form onSubmit={submit}><span className="eyebrow">SECURE ACCESS</span><h2>Welcome back</h2><p>Sign in to BlueRock Inventory Management.</p><label>Username<input autoComplete="username" required value={username} onChange={event => setUsername(event.target.value)}/></label><label>Password<input type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)}/></label>{error && <div className="error" role="alert">{error}</div>}<button className="primary" disabled={busy}>{busy ? 'Signing in...' : 'Sign in'}</button>{error && <button type="button" onClick={() => void copyDiagnostics()}>Copy diagnostic log</button>}{copied && <p role="status">{copied}</p>}<small className="secure">Authorized personnel only</small></form></section></main>;
}
