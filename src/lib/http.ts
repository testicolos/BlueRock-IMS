import { NextResponse } from 'next/server';
import { errorCode, requestId, traceFailure } from '@/lib/request-trace';

export function ok(data: unknown, status = 200) {
  return NextResponse.json({ success: true, data }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function fail(message: string, status = 400, details?: unknown) {
  const id = requestId();
  return NextResponse.json({ success: false, error: { message, details, requestId: id } }, {
    status, headers: { 'Cache-Control': 'no-store', 'x-request-id': id },
  });
}

export function serverError(error: unknown) {
  const failure = traceFailure(error);
  const code = errorCode(error);
  const temporary = ['DATABASE_LOCK_TIMEOUT', 'DATABASE_QUERY_TIMEOUT', 'DATABASE_DEADLOCK', 'DATABASE_CONNECTION_LIMIT', 'DATABASE_UNAVAILABLE', 'DATABASE_CONNECT_TIMEOUT'].includes(code);
  const message = temporary ? 'The database is temporarily busy or unavailable. Please try again.' : 'An unexpected server error occurred.';
  return NextResponse.json({ success: false, error: { message: `${message} Reference: ${failure.requestId}`, ...failure } }, {
    status: temporary ? 503 : 500, headers: { 'Cache-Control': 'no-store', 'x-request-id': failure.requestId },
  });
}
