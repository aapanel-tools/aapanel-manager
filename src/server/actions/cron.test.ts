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
    requireAdmin: vi.fn(async () => {
      if (!guard.authenticated) throw new actual.AuthError('unauthenticated');
      if (guard.user.role !== 'admin') throw new actual.AuthError('forbidden');
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
      runCronTask: async () => undefined,
      setCronTaskEnabled: async () => 'changed',
      deleteCronTask: async () => undefined,
    })),
  };
});

// Next cache no-op
vi.mock('next/cache', () => ({revalidatePath: vi.fn()}));

import {prisma} from '@/lib/db/prisma';
import {createClientForServer} from '@/lib/aapanel';
import {
  listCronTasksAction,
  getCronLogsAction,
  runCronTaskAction,
  setCronTaskEnabledAction,
  deleteCronTaskAction,
} from './cron';

/** Builds a FormData from a plain object, the way the dialogs do. */
function fd(obj: Record<string, string>): FormData {
  const form = new FormData();
  for (const [k, v] of Object.entries(obj)) form.append(k, v);
  return form;
}

const cleanupServerIds: string[] = [];
const cleanupAuditIds: string[] = [];
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
  if (cleanupAuditIds.length) await prisma.auditLog.deleteMany({where: {id: {in: cleanupAuditIds}}});
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

describe('runCronTaskAction', () => {
  it('runs the task and journals it', async () => {
    const name = `run-${uniq()}`;
    const res = await runCronTaskAction(serverId, fd({id: '1', name}));
    expect(res.ok).toBe(true);

    const audit = await prisma.auditLog.findFirst({where: {action: 'cron.run', target: name}});
    expect(audit?.result).toBe('ok');
    if (audit) cleanupAuditIds.push(audit.id);
  });

  it('journals the intent before the panel is touched, then the outcome (Д-19)', async () => {
    // Running a task cannot be undone — the script has run — and this is the
    // entry someone will be looking for months later when they ask who told a
    // client's server to run a script at 15:00. Read from inside the panel
    // call, the only moment that can tell the two orderings apart.
    const name = `run-order-${uniq()}`;
    let resultDuringCall = 'no audit row at all';

    vi.mocked(createClientForServer).mockImplementationOnce(
      () =>
        ({
          runCronTask: async () => {
            const row = await prisma.auditLog.findFirst({
              where: {action: 'cron.run', target: name},
              orderBy: {createdAt: 'desc'},
            });
            resultDuringCall = row ? row.result : 'no audit row at all';
          },
        }) as never,
    );

    const res = await runCronTaskAction(serverId, fd({id: '1', name}));

    expect(res.ok).toBe(true);
    expect(resultDuringCall).toBe('started');

    const after = await prisma.auditLog.findFirst({
      where: {action: 'cron.run', target: name},
      orderBy: {createdAt: 'desc'},
    });
    expect(after?.result).toBe('ok');
    if (after) cleanupAuditIds.push(after.id);
  });

  it('refuses to run when the journal cannot be written, and spares the panel (Д-19)', async () => {
    // Forced the honest way: the acting user does not exist, so the AuditLog
    // foreign key rejects the row. An operator loses one retry; the alternative
    // is a script run on a client's machine with nobody named against it.
    const callsBefore = vi.mocked(createClientForServer).mock.calls.length;
    const realUser = guard.user.id;
    guard.user.id = 'no-such-user-id';
    try {
      const res = await runCronTaskAction(serverId, fd({id: '1', name: 'whatever'}));
      expect(res.ok).toBe(false);
    } finally {
      guard.user.id = realUser;
    }
    expect(vi.mocked(createClientForServer).mock.calls.length).toBe(callsBefore);
  });

  it('refuses a viewer without touching the panel', async () => {
    guard.user.role = 'viewer';
    const callsBefore = vi.mocked(createClientForServer).mock.calls.length;

    const res = await runCronTaskAction(serverId, fd({id: '1', name: 'nightly'}));

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('forbidden');
    expect(vi.mocked(createClientForServer).mock.calls.length).toBe(callsBefore);
  });

  it('names an unnamed task by its number in the journal', async () => {
    // The panel allows a task with no name. "Someone ran «»" is not a journal
    // entry anybody can act on.
    const res = await runCronTaskAction(serverId, fd({id: '77', name: ''}));
    expect(res.ok).toBe(true);

    const audit = await prisma.auditLog.findFirst({where: {action: 'cron.run', target: '#77'}});
    expect(audit).not.toBeNull();
    if (audit) cleanupAuditIds.push(audit.id);
  });
});

describe('setCronTaskEnabledAction', () => {
  it('stops a task and journals which way it went', async () => {
    const name = `toggle-${uniq()}`;
    const res = await setCronTaskEnabledAction(serverId, fd({id: '1', name, enabled: 'false'}));
    expect(res.ok).toBe(true);

    const audit = await prisma.auditLog.findFirst({where: {action: 'cron.disable', target: name}});
    expect(audit?.result).toBe('ok');
    if (audit) cleanupAuditIds.push(audit.id);
  });

  it('asks the client for the state that was requested, not for a flip', async () => {
    // The panel's endpoint toggles; the app's contract is "make it so". If this
    // ever degrades into passing a direction, a stale screen starts stopping
    // backups it meant to start.
    let seen: unknown = 'never called';
    vi.mocked(createClientForServer).mockImplementationOnce(
      () =>
        ({
          setCronTaskEnabled: async (id: number, enabled: boolean) => {
            seen = {id, enabled};
            return 'changed';
          },
        }) as never,
    );

    await setCronTaskEnabledAction(serverId, fd({id: '9', name: 'x', enabled: 'true'}));
    expect(seen).toEqual({id: 9, enabled: true});
  });

  it('passes "already" through instead of claiming it changed something', async () => {
    // It means this screen and that panel had disagreed, which is worth saying.
    vi.mocked(createClientForServer).mockImplementationOnce(
      () => ({setCronTaskEnabled: async () => 'already'}) as never,
    );

    const res = await setCronTaskEnabledAction(
      serverId,
      fd({id: '1', name: 'nightly', enabled: 'true'}),
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.message).toBe('already');
  });

  it('journals the failure too', async () => {
    const name = `toggle-fail-${uniq()}`;
    vi.mocked(createClientForServer).mockImplementationOnce(
      () =>
        ({
          setCronTaskEnabled: async () => {
            throw new Error('panel said no');
          },
        }) as never,
    );

    const res = await setCronTaskEnabledAction(serverId, fd({id: '1', name, enabled: 'false'}));
    expect(res.ok).toBe(false);

    const audit = await prisma.auditLog.findFirst({where: {action: 'cron.disable', target: name}});
    expect(audit?.result).toBe('error');
    if (audit) cleanupAuditIds.push(audit.id);
  });

  it('refuses a viewer without touching the panel', async () => {
    guard.user.role = 'viewer';
    const callsBefore = vi.mocked(createClientForServer).mock.calls.length;

    const res = await setCronTaskEnabledAction(
      serverId,
      fd({id: '1', name: 'nightly', enabled: 'false'}),
    );

    expect(res.ok).toBe(false);
    expect(vi.mocked(createClientForServer).mock.calls.length).toBe(callsBefore);
  });
});

describe('deleteCronTaskAction', () => {
  it('deletes when the typed phrase matches, and journals it', async () => {
    const name = `del-${uniq()}`;
    const res = await deleteCronTaskAction(serverId, fd({id: '1', name, confirm: name}));
    expect(res.ok).toBe(true);

    const audit = await prisma.auditLog.findFirst({where: {action: 'cron.delete', target: name}});
    expect(audit?.result).toBe('ok');
    if (audit) cleanupAuditIds.push(audit.id);
  });

  it('re-checks the typed phrase on the server, and spares the panel when it is wrong', async () => {
    // A server action is a public endpoint. A confirmation only the browser
    // enforces is decoration.
    const callsBefore = vi.mocked(createClientForServer).mock.calls.length;

    const res = await deleteCronTaskAction(
      serverId,
      fd({id: '1', name: 'nightly', confirm: 'nightl'}),
    );

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('confirm');
    expect(vi.mocked(createClientForServer).mock.calls.length).toBe(callsBefore);
  });

  it('accepts the number as the phrase for a task with no name', async () => {
    const res = await deleteCronTaskAction(serverId, fd({id: '42', name: '', confirm: '#42'}));
    expect(res.ok).toBe(true);

    const audit = await prisma.auditLog.findFirst({where: {action: 'cron.delete', target: '#42'}});
    expect(audit).not.toBeNull();
    if (audit) cleanupAuditIds.push(audit.id);
  });

  it('journals the intent before the panel is touched (Д-19)', async () => {
    const name = `del-order-${uniq()}`;
    let resultDuringCall = 'no audit row at all';

    vi.mocked(createClientForServer).mockImplementationOnce(
      () =>
        ({
          deleteCronTask: async () => {
            const row = await prisma.auditLog.findFirst({
              where: {action: 'cron.delete', target: name},
              orderBy: {createdAt: 'desc'},
            });
            resultDuringCall = row ? row.result : 'no audit row at all';
          },
        }) as never,
    );

    const res = await deleteCronTaskAction(serverId, fd({id: '1', name, confirm: name}));

    expect(res.ok).toBe(true);
    expect(resultDuringCall).toBe('started');

    const after = await prisma.auditLog.findFirst({
      where: {action: 'cron.delete', target: name},
      orderBy: {createdAt: 'desc'},
    });
    expect(after?.result).toBe('ok');
    if (after) cleanupAuditIds.push(after.id);
  });

  it('refuses a viewer without touching the panel', async () => {
    guard.user.role = 'viewer';
    const callsBefore = vi.mocked(createClientForServer).mock.calls.length;

    const res = await deleteCronTaskAction(
      serverId,
      fd({id: '1', name: 'nightly', confirm: 'nightly'}),
    );

    expect(res.ok).toBe(false);
    expect(vi.mocked(createClientForServer).mock.calls.length).toBe(callsBefore);
  });

  it('never writes the script into the journal', async () => {
    // Backup scripts on a hosting panel routinely carry a database password in
    // plain text, and the journal is read by more people and kept far longer
    // than any screen (§16).
    const name = `del-secret-${uniq()}`;
    await deleteCronTaskAction(serverId, fd({id: '1', name, confirm: name}));

    const rows = await prisma.auditLog.findMany({where: {action: 'cron.delete', target: name}});
    expect(rows).toHaveLength(1);
    expect(rows[0]!.target).toBe(name);
    cleanupAuditIds.push(rows[0]!.id);
  });
});
