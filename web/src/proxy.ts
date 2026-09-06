import {NextResponse} from 'next/server';
import type {NextRequest} from 'next/server';

// Routes reachable without a session: the login page, the Auth.js endpoints, and
// the health/liveness probe (used by supervisors and the self-update restart check).
const PUBLIC = ['/login', '/api/auth', '/api/health'];

export function proxy(req: NextRequest) {
  const {pathname} = req.nextUrl;
  if (PUBLIC.some((p) => pathname.startsWith(p))) return NextResponse.next();
  const hasSession =
    req.cookies.has('authjs.session-token') || req.cookies.has('__Secure-authjs.session-token');
  if (!hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {matcher: '/((?!_next|favicon.ico|.*\\..*).*)'};
