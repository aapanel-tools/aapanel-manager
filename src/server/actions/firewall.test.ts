import {describe, it, expect, vi, beforeEach, afterAll} from 'vitest';

// Mock @/auth so next-auth does not try to import 'next/server' in vitest.
vi.mock('@/auth', () => ({auth: vi.fn(async () => null)}));

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
      getFirewallOverview: async () => ({
        enabled: true,
        backend: 'ufw',
        ping: true,
        counts: {port: 24, ip: 0, trans: 0, country: 0, banned: 0},
        updatedAt: '2026-06-05 16:30:09',
        failures: [],
      }),
      listFirewallRules: async () => ({
        items: [
          {
            port: '8080',
            protocol: 'tcp',
            family: 'ipv4',
            strategy: 'accept',
            chain: 'INPUT',
            address: 'all',
            note: '',
            addtime: '2026-02-27 05:27:05',
            id: 6,
          },
        ],
        failures: [],
        truncations: [],
      }),
    })),
  };
});

import {prisma} from '@/lib/db/prisma';
import {createClientForServer} from '@/lib/aapanel';
import {getFirewallOverviewAction, listFirewallRulesAction} from './firewall';

const cleanupServerIds: string[] = [];
let userId = '';
let serverId = '';
const uniq = () => Math.random().toString(36).slice(2, 8);

beforeEach(async () => {
  guard.authenticated = true;
  guard.user.role = 'admin';
  if (!userId) {
    const u = await prisma.user.create({
      data: {email: `fw-actor-${uniq()}@t.c`, passwordHash: 'x', role: 'admin'},
    });
    userId = u.id;
    guard.user.id = u.id;
  }
  if (!serverId) {
    const s = await prisma.server.create({
      data: {name: `fw-srv-${uniq()}`, baseUrl: 'http://h:1', apiSkEnc: 'enc'},
    });
    serverId = s.id;
    cleanupServerIds.push(serverId);
  }
});

afterAll(async () => {
  await prisma.server.deleteMany({where: {id: {in: cleanupServerIds}}});
  if (userId) await prisma.user.delete({where: {id: userId}}).catch(() => {});
});

describe('getFirewallOverviewAction', () => {
  it('returns what the panel said about the firewall', async () => {
    const res = await getFirewallOverviewAction(serverId);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.overview.enabled).toBe(true);
      expect(res.overview.backend).toBe('ufw');
      expect(res.overview.counts?.port).toBe(24);
    }
  });

  it('passes a half-answer through rather than filling the gap', async () => {
    // `enabled: null` reaches the interface as "the panel did not say", which
    // is a different statement from "the firewall is off" — and only one of
    // them is an alarm about a client's machine.
    vi.mocked(createClientForServer).mockImplementationOnce(
      () =>
        ({
          getFirewallOverview: async () => ({
            enabled: null,
            backend: 'ufw',
            ping: true,
            counts: null,
            updatedAt: null,
            failures: [{source: 'firewallStatus', kind: 'timeout', message: 'Request timed out'}],
          }),
        }) as never,
    );

    const res = await getFirewallOverviewAction(serverId);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.overview.enabled).toBeNull();
      expect(res.overview.failures).toHaveLength(1);
    }
  });

  it('refuses an unauthenticated caller without touching the panel', async () => {
    guard.authenticated = false;
    const callsBefore = vi.mocked(createClientForServer).mock.calls.length;

    const res = await getFirewallOverviewAction(serverId);

    expect(res.ok).toBe(false);
    expect(vi.mocked(createClientForServer).mock.calls.length).toBe(callsBefore);
  });
});

describe('listFirewallRulesAction', () => {
  it('returns the rules the panel reported', async () => {
    const res = await listFirewallRulesAction(serverId);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.rules).toHaveLength(1);
      expect(res.rules[0]!.port).toBe('8080');
      expect(res.truncations).toEqual([]);
    }
  });

  it('carries a search term through to the panel', async () => {
    let seen: unknown = 'never called';
    vi.mocked(createClientForServer).mockImplementationOnce(
      () =>
        ({
          listFirewallRules: async (params: unknown) => {
            seen = params;
            return {items: [], failures: [], truncations: []};
          },
        }) as never,
    );

    await listFirewallRulesAction(serverId, '8080');
    expect(seen).toMatchObject({search: '8080'});
  });

  it('passes a truncated answer through instead of presenting it as whole', async () => {
    vi.mocked(createClientForServer).mockImplementationOnce(
      () =>
        ({
          listFirewallRules: async () => ({
            items: [],
            failures: [],
            truncations: [{source: 'firewall', shown: 1000, total: 1200}],
          }),
        }) as never,
    );

    const res = await listFirewallRulesAction(serverId);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.truncations).toHaveLength(1);
  });

  it('writes no journal entry for a read', async () => {
    const before = await prisma.auditLog.count({where: {serverId}});
    await listFirewallRulesAction(serverId);
    await getFirewallOverviewAction(serverId);
    expect(await prisma.auditLog.count({where: {serverId}})).toBe(before);
  });

  it('refuses an unauthenticated caller without touching the panel', async () => {
    guard.authenticated = false;
    const callsBefore = vi.mocked(createClientForServer).mock.calls.length;

    const res = await listFirewallRulesAction(serverId);

    expect(res.ok).toBe(false);
    expect(vi.mocked(createClientForServer).mock.calls.length).toBe(callsBefore);
  });
});
