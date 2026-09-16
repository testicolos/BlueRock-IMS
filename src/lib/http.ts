import { NextResponse } from 'next/server';

export function ok(data: unknown, status = 200) {
  return NextResponse.json({ success: true, data }, { status });
}

export function fail(message: string, status = 400, details?: unknown) {
  return NextResponse.json({ success: false, error: { message, details } }, { status });
}

export function serverError(error: unknown) {
  console.error(error);
  const message = error instanceof Error && process.env.NODE_ENV !== 'production' ? error.message : 'Internal server error';
  return fail(message, 500);
}
