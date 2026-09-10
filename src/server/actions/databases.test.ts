import {describe, it, expect, vi, beforeEach, afterAll} from 'vitest';

// Mock @/auth so next-auth doesn't try to import 'next/server' in vitest.
vi.mock('@/auth', () => ({auth: vi.fn(async () => null)}));

// Mock auth guards so we control the acting user/role.
const guard = vi.hoisted(() => ({user: {id: '', email: 'a@b.c', role: 'admin' as 'admin' | 'viewer'}}));
vi.mock('@/lib/auth/guards', async (orig) => {
  const actual = await orig<typeof import('@/lib/auth/guards')>();
  return {
    ...actual,
    requireUser: vi.fn(async () => guard.user),
    requireAdmin: vi.fn(async () => {
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
      listDatabases: async () => ({
        items: [
          {
            engine: 'pgsql',
            id: 2,
            name: 'test22',
            username: 'test22',
            access: '127.0.0.1/32',
            note: '',
            addtime: '2024-01-01',
            backupCount: 0,
          },
        ],
        failures: [],
        truncations: [],
      }),
      createDatabase: async () => undefined,
      deleteDatabase: async () => undefined,
    })),
  };
});

// Next cache no-op
vi.mock('next/cache', () => ({revalidatePath: vi.fn()}));

import {prisma} from '@/lib/db/prisma';
import {createClientForServer} from '@/lib/aapanel';
import {listDatabasesAction, createDatabaseAction, deleteDatabaseAction} from './databases';

const cleanupServerIds: string[] = [];
const cleanupAuditIds: string[] = [];
let userId = '';
let serverId = '';
const uniq = () => Math.random().toString(36).slice(2, 8);

/** Helper: build a FormData from a plain object. */
function fd(obj: Record<string, string>): FormData {
  const form = new FormData();
  for (const [k, v] of Object.entries(obj)) form.append(k, v);
  return form;
}

beforeEach(async () => {
  guard.user.role = 'admin';
  if (!userId) {
    const u = await prisma.user.create({
      data: {email: `db-actor-${uniq()}@t.c`, passwordHash: 'x', role: 'admin'},
    });
    userId = u.id;
    guard.user.id = u.id;
  }
  if (!serverId) {
    const s = await prisma.server.create({
      data: {name: `db-srv-${uniq()}`, baseUrl: 'http://h:1', apiSkEnc: 'enc'},
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

describe('listDatabasesAction', () => {
  it('returns ok with databases list from the panel', async () => {
    const res = await listDatabasesAction(serverId);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.databases).toHaveLength(1);
      expect(res.databases[0]!.name).toBe('test22');
      expect(res.databases[0]!.engine).toBe('pgsql');
      expect(res.failures).toEqual([]);
    }
  });

  it('carries a search term through to the panel', async () => {
    // Ф-14. Both engines sit behind this one client call, so a term reaching
    // it reaches both; that the two shapes of request each carry it is proven
    // against the client itself.
    let seen: unknown = 'never called';
    vi.mocked(createClientForServer).mockImplementationOnce(
      () =>
        ({
          listDatabases: async (params: unknown) => {
            seen = params;
            return {items: [], failures: [], truncations: []};
          },
        }) as never,
    );

    await listDatabasesAction(serverId, 'wp_main');
    expect(seen).toMatchObject({search: 'wp_main'});
  });

  // The point of ADR-0003: an engine that did not answer reaches the interface,
  // instead of the list quietly looking complete.
  it('passes a partial result through with its failures', async () => {
    vi.mocked(createClientForServer).mockResolvedValueOnce({
      listDatabases: async () => ({
        items: [],
        failures: [{source: 'mysql', kind: 'timeout', message: 'Request timed out'}],
        truncations: [],
      }),
    } as never);

    const res = await listDatabasesAction(serverId);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.databases).toEqual([]);
      expect(res.failures).toEqual([
        {source: 'mysql', kind: 'timeout', message: 'Request timed out'},
      ]);
    }
  });
});

describe('createDatabaseAction', () => {
  it('admin + valid input → ok:true + audit row db.create', async () => {
    guard.user.role = 'admin';
    const res = await createDatabaseAction(
      serverId,
      fd({engine: 'pgsql', name: 'apptest', user: 'apptest', password: 'secret123'}),
    );
    expect(res.ok).toBe(true);

    const audit = await prisma.auditLog.findFirst({
      where: {action: 'db.create', target: {contains: 'apptest'}, result: 'ok'},
    });
    expect(audit).not.toBeNull();
    if (audit) cleanupAuditIds.push(audit.id);
  });

  it('viewer → ok:false and createDatabase not called', async () => {
    guard.user.role = 'viewer';

    const mockCreateClient = vi.mocked(createClientForServer);
    const callsBefore = mockCreateClient.mock.calls.length;

    const res = await createDatabaseAction(
      serverId,
      fd({engine: 'pgsql', name: 'apptest', user: 'apptest', password: 'secret123'}),
    );
    expect(res.ok).toBe(false);
    // createClientForServer was not called (no panel contact)
    expect(mockCreateClient.mock.calls.length).toBe(callsBefore);
  });

  it('invalid name → ok:false with fieldErrors.name', async () => {
    guard.user.role = 'admin';
    const res = await createDatabaseAction(
      serverId,
      fd({engine: 'pgsql', name: 'bad name!', user: 'apptest', password: 'secret123'}),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.fieldErrors).toBeDefined();
      expect(res.fieldErrors!['name']).toBeDefined();
    }
  });
});

describe('deleteDatabaseAction', () => {
  it('admin + confirm===name → ok:true + audit db.delete', async () => {
    guard.user.role = 'admin';
    const res = await deleteDatabaseAction(
      serverId,
      fd({engine: 'pgsql', id: '2', name: 'apptest', confirm: 'apptest'}),
    );
    expect(res.ok).toBe(true);

    const audit = await prisma.auditLog.findFirst({
      where: {action: 'db.delete', target: {contains: 'apptest'}, result: 'ok'},
    });
    expect(audit).not.toBeNull();
    if (audit) cleanupAuditIds.push(audit.id);
  });

  it('admin + confirm!==name → ok:false and deleteDatabase not called', async () => {
    guard.user.role = 'admin';

    const mockCreateClient = vi.mocked(createClientForServer);
    const callsBefore = mockCreateClient.mock.calls.length;

    const res = await deleteDatabaseAction(
      serverId,
      fd({engine: 'pgsql', id: '2', name: 'apptest', confirm: 'WRONG'}),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('confirm');
    // deleteDatabase must not be called
    expect(mockCreateClient.mock.calls.length).toBe(callsBefore);
  });
});
