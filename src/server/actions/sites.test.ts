import {describe, it, expect, vi, beforeEach, afterAll} from 'vitest';

// Mock @/auth so next-auth does not try to import 'next/server' in vitest.
vi.mock('@/auth', () => ({auth: vi.fn(async () => null)}));

// Mock auth guards so the acting user and role are ours to set.
const guard = vi.hoisted(() => ({
  user: {id: '', email: 'a@b.c', role: 'admin' as 'admin' | 'viewer'},
  authenticated: true,
}));
vi.mock('@/lib/auth/guards', async (orig) => {
  const actual = await orig<typeof import('@/lib/auth/guards')>();
  return {
    ...actual,
    requireUser: vi.fn(async () => {
      if (!guard.authenticated) throw new actual.AuthError('unauthenticated');
      return guard.user;
    }),
  };
});

// Mock the panel client so no network is hit.
vi.mock('@/lib/aapanel', async (orig) => {
  const actual = await orig<typeof import('@/lib/aapanel')>();
  return {
    ...actual,
    createClientForServer: vi.fn(() => ({
      listSites: async () => ({
        items: [
          {
            id: 1,
            name: 'shop.example.com',
            path: '/www/wwwroot/shop',
            running: true,
            phpVersion: '8.3',
            type: 'PHP',
            sslEnabled: false,
            domainCount: 2,
            note: '',
            addtime: '2026-01-01 00:00:00',
            backupCount: 0,
          },
        ],
        failures: [],
        truncations: [],
      }),
      getSiteDetail: async () => ({
        domains: [],
        directory: null,
        ssl: null,
        phpVersion: '8.3',
        failures: [],
      }),
      getSiteLogs: async () => '',
    })),
  };
});

import {prisma} from '@/lib/db/prisma';
import {createClientForServer} from '@/lib/aapanel';
import {listSitesAction, getSiteLogsAction} from './sites';

const cleanupServerIds: string[] = [];
let userId = '';
let serverId = '';
const uniq = () => Math.random().toString(36).slice(2, 8);

beforeEach(async () => {
  guard.authenticated = true;
  guard.user.role = 'admin';
  if (!userId) {
    const u = await prisma.user.create({
      data: {email: `site-actor-${uniq()}@t.c`, passwordHash: 'x', role: 'admin'},
    });
    userId = u.id;
    guard.user.id = u.id;
  }
  if (!serverId) {
    const s = await prisma.server.create({
      data: {name: `site-srv-${uniq()}`, baseUrl: 'http://h:1', apiSkEnc: 'enc'},
    });
    serverId = s.id;
    cleanupServerIds.push(serverId);
  }
});

afterAll(async () => {
  await prisma.server.deleteMany({where: {id: {in: cleanupServerIds}}});
  if (userId) await prisma.user.delete({where: {id: userId}}).catch(() => {});
});

describe('listSitesAction', () => {
  it('returns the sites the panel reported', async () => {
    const res = await listSitesAction(serverId);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.sites).toHaveLength(1);
      expect(res.sites[0]!.name).toBe('shop.example.com');
      expect(res.failures).toEqual([]);
      expect(res.truncations).toEqual([]);
    }
  });

  it('carries a search term through to the panel', async () => {
    // Ф-14: the action is the browser's only route to the panel's own search.
    // A term that stops here leaves a box that looks like it works over a list
    // that ignores it — and the row worth finding is usually the one past the
    // row limit, which no browser-side filter could reach (Д-16).
    let seen: unknown = 'never called';
    vi.mocked(createClientForServer).mockImplementationOnce(
      () =>
        ({
          listSites: async (params: unknown) => {
            seen = params;
            return {items: [], failures: [], truncations: []};
          },
        }) as never,
    );

    await listSitesAction(serverId, 'shop.example.com');
    expect(seen).toMatchObject({search: 'shop.example.com'});
  });

  it('passes a partial answer through instead of presenting it as whole', async () => {
    // ADR-0003. A source that refused, and one that had more rows than were
    // read, both reach the interface rather than being smoothed into a short
    // list that looks complete.
    vi.mocked(createClientForServer).mockImplementationOnce(
      () =>
        ({
          listSites: async () => ({
            items: [],
            failures: [{source: 'sites', kind: 'timeout', message: 'Request timed out'}],
            truncations: [{source: 'sites', shown: 1000, total: 1200}],
          }),
        }) as never,
    );

    const res = await listSitesAction(serverId);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.failures).toHaveLength(1);
      expect(res.truncations).toEqual([{source: 'sites', shown: 1000, total: 1200}]);
    }
  });

  it('refuses an unauthenticated caller without touching the panel', async () => {
    guard.authenticated = false;
    const callsBefore = vi.mocked(createClientForServer).mock.calls.length;

    const res = await listSitesAction(serverId);

    expect(res.ok).toBe(false);
    // No credentials are decrypted and no request leaves for a stranger's
    // machine on behalf of someone who is not logged in.
    expect(vi.mocked(createClientForServer).mock.calls.length).toBe(callsBefore);
  });
});

describe('getSiteLogsAction', () => {
  it('treats an empty log as an answer, not as a failure', async () => {
    // A site with no traffic yet. Turning this into an error would send an
    // operator hunting for a problem that does not exist.
    const res = await getSiteLogsAction(serverId, 'shop.example.com');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.logs).toBe('');
  });
});
