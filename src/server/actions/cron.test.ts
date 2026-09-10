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
      listCronTasks: async () => ({
        items: [
          {
            id: 1,
            name: 'nightly-backup',
            cycle: 'Once a day at 1:30',
            type: 'day',
            typeLabel: 'Per Day',
            interval: '1',
            hour: 1,
            minute: 30,
            kind: 'toShell',
            target: 'ALL',
            user: 'root',
            enabled: true,
            script: 'echo hello',
          },
        ],
        failures: [],
        truncations: [],
      }),
      getCronLogs: async () => '',
    })),
  };
});

import {prisma} from '@/lib/db/prisma';
import {createClientForServer} from '@/lib/aapanel';
import {listCronTasksAction, getCronLogsAction} from './cron';

const cleanupServerIds: string[] = [];
let userId = '';
let serverId = '';
const uniq = () => Math.random().toString(36).slice(2, 8);

beforeEach(async () => {
  guard.authenticated = true;
  guard.user.role = 'admin';
  if (!userId) {
    const u = await prisma.user.create({
      data: {email: `cron-actor-${uniq()}@t.c`, passwordHash: 'x', role: 'admin'},
    });
    userId = u.id;
    guard.user.id = u.id;
  }
  if (!serverId) {
    const s = await prisma.server.create({
      data: {name: `cron-srv-${uniq()}`, baseUrl: 'http://h:1', apiSkEnc: 'enc'},
    });
    serverId = s.id;
    cleanupServerIds.push(serverId);
  }
});

afterAll(async () => {
  await prisma.server.deleteMany({where: {id: {in: cleanupServerIds}}});
  if (userId) await prisma.user.delete({where: {id: userId}}).catch(() => {});
});

describe('listCronTasksAction', () => {
  it('returns the tasks the panel reported', async () => {
    const res = await listCronTasksAction(serverId);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.tasks).toHaveLength(1);
      expect(res.tasks[0]!.name).toBe('nightly-backup');
      expect(res.tasks[0]!.enabled).toBe(true);
      expect(res.failures).toEqual([]);
      expect(res.truncations).toEqual([]);
    }
  });

  it('carries a search term through to the panel', async () => {
    let seen: unknown = 'never called';
    vi.mocked(createClientForServer).mockImplementationOnce(
      () =>
        ({
          listCronTasks: async (params: unknown) => {
            seen = params;
            return {items: [], failures: [], truncations: []};
          },
        }) as never,
    );

    await listCronTasksAction(serverId, 'backup');
    expect(seen).toMatchObject({search: 'backup'});
  });

  it('passes a refusal through instead of presenting an empty schedule', async () => {
    // ADR-0003. "This server has no scheduled tasks" and "the panel would not
    // say" look identical on screen, and the first reading is how a backup
    // that stopped running goes unnoticed for months.
    vi.mocked(createClientForServer).mockImplementationOnce(
      () =>
        ({
          listCronTasks: async () => ({
            items: [],
            failures: [{source: 'cron', kind: 'timeout', message: 'Request timed out'}],
            truncations: [],
          }),
        }) as never,
    );

    const res = await listCronTasksAction(serverId);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.tasks).toEqual([]);
      expect(res.failures).toHaveLength(1);
    }
  });

  it('refuses an unauthenticated caller without touching the panel', async () => {
    guard.authenticated = false;
    const callsBefore = vi.mocked(createClientForServer).mock.calls.length;

    const res = await listCronTasksAction(serverId);

    expect(res.ok).toBe(false);
    // No credentials are decrypted and no request leaves for a stranger's
    // machine on behalf of someone who is not logged in.
    expect(vi.mocked(createClientForServer).mock.calls.length).toBe(callsBefore);
  });

  it('writes no journal entry for a read', async () => {
    // The journal records what changed on someone else's production machine.
    // A line per page view would bury the entries that matter (§16).
    const before = await prisma.auditLog.count({where: {serverId}});
    await listCronTasksAction(serverId);
    expect(await prisma.auditLog.count({where: {serverId}})).toBe(before);
  });
});

describe('getCronLogsAction', () => {
  it('treats an empty output as an answer, not a failure', async () => {
    // A task that has never run yet. Turning this into an error would send an
    // operator hunting for a problem that does not exist.
    const res = await getCronLogsAction(serverId, 1);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.logs).toBe('');
  });

  it('refuses an unauthenticated caller without touching the panel', async () => {
    guard.authenticated = false;
    const callsBefore = vi.mocked(createClientForServer).mock.calls.length;

    const res = await getCronLogsAction(serverId, 1);

    expect(res.ok).toBe(false);
    expect(vi.mocked(createClientForServer).mock.calls.length).toBe(callsBefore);
  });
});
