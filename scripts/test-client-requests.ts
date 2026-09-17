import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { apiRequest, ApiError, getClientDiagnostics, SESSION_EVENT } from '../src/lib/client-api';

class MemoryStorage implements Storage {
  private rows = new Map<string, string>();
  get length() { return this.rows.size; }
  clear() { this.rows.clear(); }
  getItem(key: string) { return this.rows.get(key) ?? null; }
  key(index: number) { return [...this.rows.keys()][index] ?? null; }
  removeItem(key: string) { this.rows.delete(key); }
  setItem(key: string, value: string) { this.rows.set(key, String(value)); }
}
async function main() {
  const local = new MemoryStorage(); const session = new MemoryStorage();
  const events = new EventTarget();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { setTimeout, clearTimeout, dispatchEvent: events.dispatchEvent.bind(events) } });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: local });
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: session });
  const fetchOriginal = globalThis.fetch; const warn = console.warn; console.warn = () => {};
  const oldToken = randomUUID(); const newToken = randomUUID();
  let changes = 0; events.addEventListener(SESSION_EVENT, () => { changes++; });
  const headers = { Authorization: `Bearer ${oldToken}` };
  try {
    local.setItem('br_token', oldToken); local.setItem('br_user', '{}');
    globalThis.fetch = async (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Cancelled','AbortError')), { once: true });
    });
    await assert.rejects(apiRequest('/api/auth/session', { headers }, 20), error => error instanceof ApiError && error.code === 'TIMEOUT');
    assert.equal(local.getItem('br_token'), oldToken);

    globalThis.fetch = async (_input, init) => new Response(new ReadableStream({
      start(controller) { init?.signal?.addEventListener('abort', () => controller.error(new DOMException('Cancelled','AbortError')), { once: true }); },
    }), { headers: { 'Content-Type': 'application/json' } });
    await assert.rejects(apiRequest('/api/auth/session', { headers }, 20), error => error instanceof ApiError && error.code === 'TIMEOUT');
    assert.equal(getClientDiagnostics().at(-1)?.code, 'TIMEOUT', 'Timeout while reading the body is still a timeout');

    globalThis.fetch = async () => Response.json({ success: false, error: { message: 'Database busy' } }, { status: 503 });
    await assert.rejects(apiRequest('/api/auth/session', { headers }), error => error instanceof ApiError && error.status === 503);
    assert.equal(local.getItem('br_token'), oldToken);

    globalThis.fetch = async () => {
      local.setItem('br_token', newToken);
      return Response.json({ success: false }, { status: 401 });
    };
    await assert.rejects(apiRequest('/api/auth/session', { headers }));
    assert.equal(local.getItem('br_token'), newToken, 'Late 401 cannot erase a newer session');
    assert.equal(changes, 0);

    globalThis.fetch = async () => Response.json({ success: false }, { status: 401 });
    await assert.rejects(apiRequest('/api/auth/session', { headers: { Authorization: `Bearer ${newToken}` } }));
    assert.equal(local.getItem('br_token'), null);
    assert.equal(local.getItem('br_user'), null);
    assert.equal(changes, 1);
    const diagnosticText = JSON.stringify(getClientDiagnostics());
    assert.ok(!diagnosticText.includes(oldToken) && !diagnosticText.includes(newToken));
    assert.equal(getClientDiagnostics().length, 5);
  } finally { globalThis.fetch = fetchOriginal; console.warn = warn; }
  console.log('PASS: transport/body timeouts, 503 preservation, expired-session clearing, late-401 race protection and sanitized browser diagnostics');
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
