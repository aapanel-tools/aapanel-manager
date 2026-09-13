import {describe, it, expect} from 'vitest';
import {NextRequest} from 'next/server';
import {proxy} from './proxy';

interface RequestOptions {
  session?: boolean;
  method?: string;
  /** Carries the header Next's client puts on a server action call. */
  action?: boolean;
}

function req(path: string, opts: RequestOptions = {}): NextRequest {
  const headers: Record<string, string> = {};
  if (opts.session) headers.cookie = 'authjs.session-token=abc';
  if (opts.action) headers['next-action'] = '7f3c0e9a1b2d4c5e6f708192a3b4c5d6e7f80910';
  return new NextRequest(new URL(`http://localhost${path}`), {headers, method: opts.method ?? 'GET'});
}

const isRedirectToLogin = (res: Response): boolean =>
  res.status >= 300 && res.status < 400 && (res.headers.get('location') ?? '').endsWith('/login');

describe('proxy (auth gate)', () => {
  it('lets the health probe through without a session', () => {
    expect(isRedirectToLogin(proxy(req('/api/health')))).toBe(false);
  });

  it('lets the login page and Auth.js endpoints through without a session', () => {
    expect(isRedirectToLogin(proxy(req('/login')))).toBe(false);
    expect(isRedirectToLogin(proxy(req('/api/auth/session')))).toBe(false);
  });

  it('redirects protected routes to /login when there is no session', () => {
    expect(isRedirectToLogin(proxy(req('/servers')))).toBe(true);
    expect(isRedirectToLogin(proxy(req('/settings')))).toBe(true);
  });

  it('lets protected routes through when a session cookie is present', () => {
    expect(isRedirectToLogin(proxy(req('/servers', {session: true})))).toBe(false);
  });

  // ADR-0009. A redirect here reached the browser as a login page where the
  // action's answer should have been, and the button did nothing (Д-30).
  it('lets a server action call through without a session, so the action refuses in words', () => {
    expect(isRedirectToLogin(proxy(req('/servers/abc/cron', {method: 'POST', action: true})))).toBe(false);
  });

  it('still sends a page request to /login when it merely carries the action header', () => {
    expect(isRedirectToLogin(proxy(req('/servers', {action: true})))).toBe(true);
  });

  it('still sends a form posted without JavaScript to /login', () => {
    expect(isRedirectToLogin(proxy(req('/servers', {method: 'POST'})))).toBe(true);
  });
});
