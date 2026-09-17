'use client';

export const SESSION_EVENT = 'br:session-change';
const DIAGNOSTICS_KEY = 'br_request_diagnostics';
export type ClientDiagnostic = { time: string; operation: string; method: string; status: number; durationMs: number; requestId: string; code: string };
const idPattern = /^[0-9a-f-]{36}$/i;
export class ApiError extends Error {
  constructor(message: string, public status: number, public requestId: string, public code: string) {
    super(requestId && !message.includes(requestId) ? `${message} Reference: ${requestId}` : message); this.name = 'ApiError';
  }
}
export function clearSession(expectedToken?: string, expired = false) {
  if (expectedToken && localStorage.getItem('br_token') !== expectedToken) return;
  try {
    localStorage.removeItem('br_token'); localStorage.removeItem('br_user');
    if (expired) sessionStorage.setItem('br_session_notice', 'expired');
  } finally { window.dispatchEvent(new Event(SESSION_EVENT)); }
}
function operationFor(path: string) {
  if (path === '/api/auth/login') return 'auth.login';
  if (path === '/api/auth/session') return 'auth.session';
  if (path === '/api/scanner-setup') return 'scanner.setup';
  if (/^\/api\/users\/[0-9a-f-]{36}$/i.test(path)) return 'scanner.assignment';
  return 'api.request';
}
// A bounded metadata list, never form data, server payloads or credentials.
export function getClientDiagnostics(): ClientDiagnostic[] {
  try {
    const raw: unknown = JSON.parse(sessionStorage.getItem(DIAGNOSTICS_KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw.slice(-100).filter(row => row && typeof row === 'object' &&
      ['auth.login','auth.session','scanner.setup','scanner.assignment','api.request'].includes(row.operation) &&
      typeof row.time === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(row.time) &&
      idPattern.test(row.requestId) && typeof row.status === 'number' && Number.isFinite(row.durationMs) &&
      ['GET','POST','PATCH','DELETE','PUT'].includes(row.method) &&
      ['OK','HTTP_ERROR','TIMEOUT','NETWORK_ERROR','INVALID_RESPONSE','ABORTED'].includes(row.code)
    ).map(row => ({ time: row.time, operation: row.operation, method: row.method, status: row.status, durationMs: row.durationMs, requestId: row.requestId, code: row.code }));
  } catch { return []; }
}
function record(row: ClientDiagnostic) {
  try { sessionStorage.setItem(DIAGNOSTICS_KEY, JSON.stringify([...getClientDiagnostics(), row].slice(-100))); } catch { /* Optional diagnostics must not block login. */ }
  if (row.code !== 'OK' && row.code !== 'ABORTED') console.warn('[BlueRock request]', JSON.stringify(row));
}
export async function apiRequest<T>(path: string, options: RequestInit = {}, timeoutMs = 20_000): Promise<T> {
  if (!path.startsWith('/api/')) throw new Error('Only same-origin API paths are supported');
  const controller = new AbortController(); const abort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  let timedOut = false;
  const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const started = performance.now(); const clientRequestId = crypto.randomUUID();
  let reference = clientRequestId; let status = 0; let code = 'OK';
  const headers = new Headers(options.headers); headers.set('x-client-request-id', clientRequestId);
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  try {
    const response = await fetch(path, { ...options, headers, cache: 'no-store', signal: controller.signal });
    status = response.status;
    const responseId = response.headers.get('x-request-id');
    if (responseId && idPattern.test(responseId)) reference = responseId;
    const body = await response.json().catch(error => { if (controller.signal.aborted) throw error; return null; });
    if (!response.ok || body?.success !== true) {
      code = body ? 'HTTP_ERROR' : 'INVALID_RESPONSE';
      const authorization = headers.get('Authorization');
      if (status === 401 && path !== '/api/auth/login' && authorization?.startsWith('Bearer ')) clearSession(authorization.slice(7), true);
      const fallback = status >= 500 ? 'The service is temporarily unavailable. Please try again.' : 'The request could not be completed.';
      throw new ApiError(typeof body?.error?.message === 'string' ? body.error.message : fallback, status, reference, code);
    }
    return body.data as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (controller.signal.aborted) {
      code = timedOut ? 'TIMEOUT' : 'ABORTED';
      if (!timedOut) throw new DOMException('Request cancelled', 'AbortError');
      const write = options.method && options.method !== 'GET' && path !== '/api/auth/login';
      throw new ApiError(write ? 'The save took too long. It may already have completed; refresh before resubmitting it.' : 'The service took too long to respond. Check your connection and try again.', 0, reference, code);
    }
    code = 'NETWORK_ERROR';
    throw new ApiError('Unable to reach the service. Check your connection and try again.', 0, reference, code);
  } finally {
    window.clearTimeout(timer); options.signal?.removeEventListener('abort', abort);
    record({ time: new Date().toISOString(), operation: operationFor(path), method: options.method || 'GET', status, durationMs: Math.round(performance.now() - started), requestId: reference, code });
  }
}
