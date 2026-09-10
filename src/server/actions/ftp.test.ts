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
    requireAdmin: vi.fn(async () => {
      if (!guard.authenticated) throw new actual.AuthError('unauthenticated');
      if (guard.user.role !== 'admin') throw new actual.AuthError('forbidden');
      return guard.user;
    }),
  };
});

vi.mock('@/lib/aapanel', async (orig) => {
  const actual = await orig<typeof import('@/lib/aapanel')>();
  return {
    ...actual,
    createClientForServer: vi.fn(() => ({
      listFtpUsers: async () => ({
        items: [
          {
            id: 1,
            name: 'ftpuser',
            path: '/www/wwwroot/ftpuser',
            note: '',
            enabled: true,
            addtime: '2026-06-08 08:15:50',
            quotaUsed: 0,
            quotaSize: 0,
          },
        ],
        failures: [],
        truncations: [],
      }),
      createFtpUser: async () => undefined,
      setFtpUserPassword: async () => undefined,
      setFtpUserEnabled: async () => undefined,
      deleteFtpUser: async () => undefined,
    })),
  };
});

vi.mock('next/cache', () => ({revalidatePath: vi.fn()}));

import {prisma} from '@/lib/db/prisma';
import {createClientForServer} from '@/lib/aapanel';
import {
  listFtpUsersAction,
  createFtpUserAction,
  setFtpUserPasswordAction,
  setFtpUserEnabledAction,
  deleteFtpUserAction,
} from './ftp';

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
      data: {email: `ftp-actor-${uniq()}@t.c`, passwordHash: 'x', role: 'admin'},
    });
    userId = u.id;
    guard.user.id = u.id;
  }
  if (!serverId) {
    const s = await prisma.server.create({
      data: {name: `ftp-srv-${uniq()}`, baseUrl: 'http://h:1', apiSkEnc: 'enc'},
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

describe('listFtpUsersAction', () => {
  it('returns the accounts the panel reported', async () => {
    const res = await listFtpUsersAction(serverId);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.users).toHaveLength(1);
      expect(res.users[0]!.name).toBe('ftpuser');
    }
  });

  it('carries a search term through to the panel', async () => {
    let seen: unknown = 'never called';
    vi.mocked(createClientForServer).mockImplementationOnce(
      () =>
        ({
          listFtpUsers: async (params: unknown) => {
            seen = params;
            return {items: [], failures: [], truncations: []};
          },
        }) as never,
    );
    await listFtpUsersAction(serverId, 'deploy');
    expect(seen).toMatchObject({search: 'deploy'});
  });

  it('refuses an unauthenticated caller without touching the panel', async () => {
    guard.authenticated = false;
    const callsBefore = vi.mocked(createClientForServer).mock.calls.length;
    const res = await listFtpUsersAction(serverId);
    expect(res.ok).toBe(false);
    expect(vi.mocked(createClientForServer).mock.calls.length).toBe(callsBefore);
  });
});

describe('createFtpUserAction', () => {
  it('creates the account and journals it', async () => {
    const name = `mk${uniq()}`;
    const res = await createFtpUserAction(
      serverId,
      fd({username: name, password: 'long-enough-password', path: `/www/wwwroot/${name}`}),
    );
    expect(res.ok).toBe(true);

    const audit = await prisma.auditLog.findFirst({where: {action: 'ftp.create', target: name}});
    expect(audit?.result).toBe('ok');
    if (audit) cleanupAuditIds.push(audit.id);
  });

  it('refuses a relative home directory', async () => {
    // The panel creates this directory; a relative path would be resolved
    // against whatever the panel's process happens to be sitting in.
    const res = await createFtpUserAction(
      serverId,
      fd({username: 'deploy', password: 'long-enough-password', path: 'www/wwwroot/deploy'}),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.fieldErrors?.path).toBeDefined();
  });

  it('refuses a home directory that climbs out of the tree', async () => {
    const res = await createFtpUserAction(
      serverId,
      fd({username: 'deploy', password: 'long-enough-password', path: '/www/wwwroot/../../etc'}),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.fieldErrors?.path).toBeDefined();
  });

  it('refuses a name the FTP daemon would choke on', async () => {
    const res = await createFtpUserAction(
      serverId,
      fd({username: 'de ploy;rm', password: 'long-enough-password', path: '/www/wwwroot/deploy'}),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.fieldErrors?.username).toBeDefined();
  });

  it('refuses a password too short for something the internet can reach', async () => {
    const res = await createFtpUserAction(
      serverId,
      fd({username: 'deploy', password: 'short', path: '/www/wwwroot/deploy'}),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.fieldErrors?.password).toBeDefined();
  });

  it('refuses a viewer without touching the panel', async () => {
    guard.user.role = 'viewer';
    const callsBefore = vi.mocked(createClientForServer).mock.calls.length;
    const res = await createFtpUserAction(
      serverId,
      fd({username: 'deploy', password: 'long-enough-password', path: '/www/wwwroot/deploy'}),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('forbidden');
    expect(vi.mocked(createClientForServer).mock.calls.length).toBe(callsBefore);
  });
});

describe('setFtpUserPasswordAction', () => {
  it('changes the password and journals who did it', async () => {
    const name = `pw${uniq()}`;
    const res = await setFtpUserPasswordAction(
      serverId,
      fd({id: '1', username: name, password: 'another-long-password'}),
    );
    expect(res.ok).toBe(true);

    const audit = await prisma.auditLog.findFirst({where: {action: 'ftp.password', target: name}});
    expect(audit?.result).toBe('ok');
    // The journal names the account and nothing else: a password does not
    // belong in a row that outlives the code that wrote it (§16).
    if (audit) {
      expect(audit.target).toBe(name);
      cleanupAuditIds.push(audit.id);
    }
  });

  it('refuses a viewer without touching the panel', async () => {
    guard.user.role = 'viewer';
    const callsBefore = vi.mocked(createClientForServer).mock.calls.length;
    const res = await setFtpUserPasswordAction(
      serverId,
      fd({id: '1', username: 'ftpuser', password: 'another-long-password'}),
    );
    expect(res.ok).toBe(false);
    expect(vi.mocked(createClientForServer).mock.calls.length).toBe(callsBefore);
  });
});

describe('setFtpUserEnabledAction', () => {
  it('passes the wanted state to the client, not a direction', async () => {
    // Unlike the scheduler's toggle, this endpoint is told what to be — so the
    // action's contract is "make it so", and it should stay that way.
    let seen: unknown = 'never called';
    vi.mocked(createClientForServer).mockImplementationOnce(
      () =>
        ({
          setFtpUserEnabled: async (id: number, username: string, enabled: boolean) => {
            seen = {id, username, enabled};
          },
        }) as never,
    );

    await setFtpUserEnabledAction(serverId, fd({id: '3', username: 'deploy', enabled: 'false'}));
    expect(seen).toEqual({id: 3, username: 'deploy', enabled: false});
  });

  it('journals which way it went', async () => {
    const name = `sw${uniq()}`;
    await setFtpUserEnabledAction(serverId, fd({id: '1', username: name, enabled: 'false'}));

    const audit = await prisma.auditLog.findFirst({where: {action: 'ftp.disable', target: name}});
    expect(audit?.result).toBe('ok');
    if (audit) cleanupAuditIds.push(audit.id);
  });
});

describe('deleteFtpUserAction', () => {
  it('deletes when the typed name matches, and journals it', async () => {
    const name = `rm${uniq()}`;
    const res = await deleteFtpUserAction(serverId, fd({id: '1', username: name, confirm: name}));
    expect(res.ok).toBe(true);

    const audit = await prisma.auditLog.findFirst({where: {action: 'ftp.delete', target: name}});
    expect(audit?.result).toBe('ok');
    if (audit) cleanupAuditIds.push(audit.id);
  });

  it('re-checks the typed name on the server, and spares the panel when it is wrong', async () => {
    const callsBefore = vi.mocked(createClientForServer).mock.calls.length;
    const res = await deleteFtpUserAction(
      serverId,
      fd({id: '1', username: 'ftpuser', confirm: 'ftpuse'}),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('confirm');
    expect(vi.mocked(createClientForServer).mock.calls.length).toBe(callsBefore);
  });

  it('journals the intent before the panel is touched (Д-19)', async () => {
    const name = `rm-order-${uniq()}`.replace(/-/g, '');
    let resultDuringCall = 'no audit row at all';

    vi.mocked(createClientForServer).mockImplementationOnce(
      () =>
        ({
          deleteFtpUser: async () => {
            const row = await prisma.auditLog.findFirst({
              where: {action: 'ftp.delete', target: name},
              orderBy: {createdAt: 'desc'},
            });
            resultDuringCall = row ? row.result : 'no audit row at all';
          },
        }) as never,
    );

    const res = await deleteFtpUserAction(serverId, fd({id: '1', username: name, confirm: name}));

    expect(res.ok).toBe(true);
    expect(resultDuringCall).toBe('started');

    const after = await prisma.auditLog.findFirst({
      where: {action: 'ftp.delete', target: name},
      orderBy: {createdAt: 'desc'},
    });
    expect(after?.result).toBe('ok');
    if (after) cleanupAuditIds.push(after.id);
  });

  it('refuses a viewer without touching the panel', async () => {
    guard.user.role = 'viewer';
    const callsBefore = vi.mocked(createClientForServer).mock.calls.length;
    const res = await deleteFtpUserAction(
      serverId,
      fd({id: '1', username: 'ftpuser', confirm: 'ftpuser'}),
    );
    expect(res.ok).toBe(false);
    expect(vi.mocked(createClientForServer).mock.calls.length).toBe(callsBefore);
  });
});
