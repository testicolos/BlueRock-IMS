import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

type TraceContext = { requestId: string; clientRequestId?: string; operation: string; started: number; stages: Record<string, number>; errorCode?: string };
const context = new AsyncLocalStorage<TraceContext>();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Only allowlisted categories leave the server. Never serialize Error, SQL,
// parameters, messages, stacks, headers, cookies, URLs or request/response bodies.
export function errorCode(error: unknown): string {
  const raw = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  const codes: Record<string, string> = {
    '55P03': 'DATABASE_LOCK_TIMEOUT', '57014': 'DATABASE_QUERY_TIMEOUT', '40P01': 'DATABASE_DEADLOCK',
    '42703': 'DATABASE_SCHEMA_MISSING', '42P01': 'DATABASE_SCHEMA_MISSING', '42501': 'DATABASE_PERMISSION_DENIED',
    '53300': 'DATABASE_CONNECTION_LIMIT', '57P01': 'DATABASE_UNAVAILABLE', '08006': 'DATABASE_UNAVAILABLE',
    'CONNECTION_CLOSED': 'DATABASE_UNAVAILABLE', 'CONNECTION_ENDED': 'DATABASE_UNAVAILABLE',
    'CONNECTION_DESTROYED': 'DATABASE_UNAVAILABLE', 'CONNECT_TIMEOUT': 'DATABASE_CONNECT_TIMEOUT',
    'ETIMEDOUT': 'DATABASE_CONNECT_TIMEOUT', 'ECONNREFUSED': 'DATABASE_UNAVAILABLE', 'ENOTFOUND': 'DATABASE_UNAVAILABLE',
    'ERR_JWT_EXPIRED': 'SESSION_EXPIRED', 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED': 'SESSION_INVALID',
  };
  if (Object.hasOwn(codes, raw)) return codes[raw];
  if (error instanceof SyntaxError) return 'INVALID_JSON';
  if (error instanceof Error) {
    if (error.message === 'SESSION_EXPIRED') return 'SESSION_EXPIRED';
    if (error.message === 'UNAUTHORIZED') return 'SESSION_INVALID';
    if (error.message === 'FORBIDDEN') return 'ACCESS_DENIED';
    if (error.message === 'DATABASE_URL is not configured' || error.message === 'JWT_SECRET must be configured with at least 32 characters') return 'SERVER_CONFIGURATION';
  }
  return 'UNEXPECTED_ERROR';
}
export function requestId() { return context.getStore()?.requestId ?? randomUUID(); }
function emit(level: 'info'|'warn'|'error', event: string, data: Record<string, string | number | Record<string, number> | undefined>) {
  const current = context.getStore();
  const line = JSON.stringify({ service: 'bluerock-ims', event, time: new Date().toISOString(),
    requestId: current?.requestId, clientRequestId: current?.clientRequestId,
    operation: current?.operation ?? 'unwrapped_api', ...data });
  if (level === 'error') console.error(line); else if (level === 'warn') console.warn(line); else console.info(line);
}
export function traceFailure(error: unknown, severity: 'warn'|'error' = 'error', stage = 'request') {
  const code = errorCode(error); const current = context.getStore();
  if (current && severity === 'error') current.errorCode = code;
  const id = requestId();
  emit(severity, 'request.error', { requestId: id, code, stage: /^[a-z_.-]{1,60}$/i.test(stage) ? stage : 'request' });
  return { requestId: id, code };
}
export async function traceStage<T>(stage: string, work: () => Promise<T>): Promise<T> {
  const started = performance.now();
  // Start records survive a platform hard timeout and identify the last stage.
  emit('info', 'request.stage.started', { stage });
  try { return await work(); }
  catch (error) {
    const expected = ['SESSION_EXPIRED','SESSION_INVALID','ACCESS_DENIED'].includes(errorCode(error));
    traceFailure(error, expected ? 'warn' : 'error', stage); throw error;
  } finally {
    const durationMs = Math.round(performance.now() - started);
    const current = context.getStore(); if (current) current.stages[stage] = durationMs;
    if (process.env.IMS_TRACE_LEVEL === 'debug') emit('info', 'request.stage.completed', { stage, durationMs });
  }
}
export function withRequestTrace<Args extends unknown[]>(operation: string, handler: (...args: Args) => Promise<Response>) {
  return async (...args: Args): Promise<Response> => {
    const first = args[0];
    const supplied = first instanceof Request ? first.headers.get('x-client-request-id') : null;
    const current: TraceContext = { requestId: randomUUID(), clientRequestId: supplied && uuid.test(supplied) ? supplied : undefined,
      operation, started: performance.now(), stages: {} };
    return context.run(current, async () => {
      emit('info', 'request.started', {});
      let response: Response;
      try { response = await handler(...args); }
      catch (error) {
        const failure = traceFailure(error);
        response = Response.json({ success: false, error: { message: 'The request failed. Please try again.', ...failure } }, { status: 500 });
      }
      response.headers.set('x-request-id', current.requestId); response.headers.set('Cache-Control', 'no-store');
      const durationMs = Math.round(performance.now() - current.started);
      response.headers.set('Server-Timing', `total;dur=${durationMs}`);
      emit(response.status >= 500 ? 'error' : response.status >= 400 ? 'warn' : 'info', 'request.completed', {
        status: response.status, durationMs, stages: current.stages, code: current.errorCode,
      });
      return response;
    });
  };
}
