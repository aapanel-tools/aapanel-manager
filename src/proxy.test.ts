import {describe, it, expect} from 'vitest';
import {NextRequest} from 'next/server';
import {proxy} from './proxy';

function req(path: string, opts: {session?: boolean} = {}): NextRequest {
  const headers: Record<string, string> = {};
  if (opts.session) headers.cookie = 'authjs.session-token=abc';
  return new NextRequest(new URL(`http://localhost${path}`), {headers});
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
});
