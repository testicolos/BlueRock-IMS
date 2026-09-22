import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const canonicalHost = 'bluerock-ims.vercel.app';

export function proxy(request: NextRequest) {
  const host = request.headers.get('host')?.split(':')[0].toLowerCase();
  if (process.env.VERCEL_ENV === 'production' && host?.endsWith('.vercel.app') && host !== canonicalHost) {
    const url = request.nextUrl.clone();
    url.protocol = 'https:';
    url.host = canonicalHost;
    url.port = '';
    return NextResponse.redirect(url, 308);
  }
  return NextResponse.next();
}

export const proxyConfig = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
