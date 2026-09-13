import {NextResponse} from 'next/server';
import type {NextRequest} from 'next/server';

// Routes reachable without a session: the login page, the Auth.js endpoints, and
// the health/liveness probe (used by supervisors and the self-update restart check).
const PUBLIC = ['/login', '/api/auth', '/api/health'];

/**
 * A server action call — what Next's client sends when a button runs an action.
 *
 * Only POST counts, as it does for Next itself (server-action-request-meta.js):
 * a GET carrying the same header is an ordinary page render, and stays behind
 * the session check below.
 */
function isServerActionCall(req: NextRequest): boolean {
  return req.method === 'POST' && req.headers.has('next-action');
}

export function proxy(req: NextRequest) {
  const {pathname} = req.nextUrl;
  if (PUBLIC.some((p) => pathname.startsWith(p))) return NextResponse.next();
  // Every action checks the session itself before anything else, and
  // guard-first.test.ts holds that for all of them (ADR-0009). Redirecting the
  // call instead handed the browser a login page where the action's answer was
  // expected, and the button silently did nothing (Д-30).
  if (isServerActionCall(req)) return NextResponse.next();
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
