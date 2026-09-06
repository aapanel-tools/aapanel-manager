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
      getMetrics: async () => ({
        cpuPercent: 5,
        cores: 4,
        load: null,
        memUsedMb: 100,
        memTotalMb: 1000,
        memPercent: 10,
        diskPercent: 20,
        netUpKbps: 1,
        netDownKbps: 2,
      }),
      listProjects: async () => [{name: 'app', status: 'running', port: 3000, path: '/x', cpu: 1, mem: 50}],
      batchOperation: async () => ({}),
      getProjectLogs: async () => 'log line 1\nlog line 2',
      getProjectConfig: async () => ({
        name: 'app',
        cwd: '/www/node-projects/app/',
        script: 'start',
        port: 3000,
        runUser: 'www',
        nodejsVersion: 'v24.13.0',
        note: 'app',
        powerOn: true,
        maxMemoryLimit: 4096,
        domains: [],
      }),
      getRunList: async () => [
        {key: 'start', command: 'node server.js'},
        {key: 'dev', command: 'next dev'},
      ],
      getNodeVersions: async () => ['v24.13.0'],
      getCreateEnv: async () => ({
        nodejsVersions: ['v24.13.0'],
        packageManagers: ['pnpm', 'npm'],
        userList: ['www', 'root'],
        maximumMemory: 4096,
      }),
      createProject: async () => undefined,
      modifyProject: async () => undefined,
      deleteProject: async () => undefined,
      listDir: async () => ({path: '/www/node-projects', dirs: ['app', 'another']}),
    })),
  };
});

// Next cache no-op
vi.mock('next/cache', () => ({revalidatePath: vi.fn()}));

import {prisma} from '@/lib/db/prisma';
import {createClientForServer} from '@/lib/aapanel';
import {
  getServerMetricsAction,
  listNodeProjectsAction,
  projectControlAction,
  getProjectLogsAction,
  getProjectEditDataAction,
  getProjectCreateEnvAction,
  createProjectAction,
  modifyProjectAction,
  deleteProjectAction,
  listDirAction,
} from './projects';

/** Builds a valid create-project FormData. */
function createForm(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const base: Record<string, string> = {
    cwd: '/www/node-projects/newapp',
    name: 'newapp',
    script: 'start',
    port: '3005',
    runUser: 'www',
    nodejsVersion: 'v24.13.0',
    note: 'newapp',
    domains: '',
    bindExtranet: 'false',
    powerOn: 'true',
    maxMemoryLimit: '4096',
    env: '',
    ...overrides,
  };
  for (const [k, v] of Object.entries(base)) fd.set(k, v);
  return fd;
}

/** Builds a valid modify-project FormData. */
function modifyForm(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const base: Record<string, string> = {
    cwd: '/www/node-projects/app/',
    name: 'app',
    script: 'prod:start',
    port: '3000',
    runUser: 'www',
    nodejsVersion: 'v24.13.0',
    note: 'app',
    powerOn: 'false',
    ...overrides,
  };
  for (const [k, v] of Object.entries(base)) fd.set(k, v);
  return fd;
}

const cleanupServerIds: string[] = [];
const cleanupAuditIds: string[] = [];
let userId = '';
let serverId = '';
const uniq = () => Math.random().toString(36).slice(2, 8);

beforeEach(async () => {
  guard.user.role = 'admin';
  if (!userId) {
    const u = await prisma.user.create({data: {email: `proj-actor-${uniq()}@t.c`, passwordHash: 'x', role: 'admin'}});
    userId = u.id;
    guard.user.id = u.id;
  }
  if (!serverId) {
    const s = await prisma.server.create({
      data: {name: `proj-srv-${uniq()}`, baseUrl: 'http://h:1', apiSkEnc: 'enc'},
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

describe('getServerMetricsAction', () => {
  it('returns ok with metrics from the panel', async () => {
    const res = await getServerMetricsAction(serverId);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.metrics.cpuPercent).toBe(5);
      expect(res.metrics.cores).toBe(4);
      expect(res.metrics.memUsedMb).toBe(100);
    }
  });

  it('returns ok:false when getMetrics throws', async () => {
    const mockCreateClient = vi.mocked(createClientForServer);
    mockCreateClient.mockImplementationOnce(
      () =>
        ({
          getMetrics: async () => {
            throw new Error('panel down');
          },
          listProjects: async () => [],
          batchOperation: async () => ({}),
          getProjectLogs: async () => '',
        }) as never,
    );
    const res = await getServerMetricsAction(serverId);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toContain('panel down');
  });
});

describe('listNodeProjectsAction', () => {
  it('returns ok with projects list from the panel', async () => {
    const res = await listNodeProjectsAction(serverId);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.projects).toHaveLength(1);
      expect(res.projects[0]!.name).toBe('app');
      expect(res.projects[0]!.status).toBe('running');
    }
  });
});

describe('projectControlAction', () => {
  it('admin can stop a project and an audit row is created', async () => {
    guard.user.role = 'admin';
    const res = await projectControlAction(serverId, 'app', 'stop');
    expect(res.ok).toBe(true);

    const audit = await prisma.auditLog.findFirst({
      where: {action: 'project.stop', target: {contains: 'app'}, result: 'ok'},
    });
    expect(audit).not.toBeNull();
    if (audit) cleanupAuditIds.push(audit.id);
  });

  it('viewer is blocked, no audit success row and batchOperation not invoked', async () => {
    guard.user.role = 'viewer';

    // The action must be rejected at requireAdmin — createClientForServer
    // must never be called, so we simply check the call count stays unchanged.
    const mockCreateClient = vi.mocked(createClientForServer);
    const callsBefore = mockCreateClient.mock.calls.length;

    const before = await prisma.auditLog.count({where: {action: 'project.stop', result: 'ok'}});
    const res = await projectControlAction(serverId, 'app', 'stop');
    const after = await prisma.auditLog.count({where: {action: 'project.stop', result: 'ok'}});

    expect(res.ok).toBe(false);
    // createClientForServer was not called (no panel contact)
    expect(mockCreateClient.mock.calls.length).toBe(callsBefore);
    expect(after).toBe(before); // no new success audit row
  });

  it('surfaces a per-project failure (msg_list status false) as ok:false', async () => {
    guard.user.role = 'admin';
    vi.mocked(createClientForServer).mockImplementationOnce(
      () =>
        ({
          batchOperation: async () => ({msg: 'fail', msg_list: [{name: 'app', status: false, msg: 'boom'}]}),
        }) as never,
    );
    const res = await projectControlAction(serverId, 'app', 'restart');
    expect(res.ok).toBe(false);
    expect(res.message).toContain('boom');
  });
});

describe('getProjectLogsAction', () => {
  it('returns ok with logs string from the panel', async () => {
    const res = await getProjectLogsAction(serverId, 'app');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.logs).toBe('log line 1\nlog line 2');
    }
  });
});

describe('getProjectEditDataAction', () => {
  it('admin gets config, run scripts and node versions', async () => {
    guard.user.role = 'admin';
    const res = await getProjectEditDataAction(serverId, 'app');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.config.name).toBe('app');
      expect(res.runScripts).toHaveLength(2);
      expect(res.nodeVersions).toEqual(['v24.13.0']);
    }
  });

  it('viewer is forbidden', async () => {
    guard.user.role = 'viewer';
    const res = await getProjectEditDataAction(serverId, 'app');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toBe('forbidden');
  });
});

describe('getProjectCreateEnvAction', () => {
  it('admin gets pre_env metadata', async () => {
    guard.user.role = 'admin';
    const res = await getProjectCreateEnvAction(serverId);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.preEnv.packageManagers).toContain('pnpm');
      expect(res.preEnv.userList).toContain('www');
    }
  });
});

describe('createProjectAction', () => {
  it('admin creates a project and an audit row is written', async () => {
    guard.user.role = 'admin';
    const res = await createProjectAction(serverId, createForm());
    expect(res.ok).toBe(true);

    const audit = await prisma.auditLog.findFirst({
      where: {action: 'project.create', target: 'newapp', result: 'ok'},
    });
    expect(audit).not.toBeNull();
    if (audit) cleanupAuditIds.push(audit.id);
  });

  it('rejects invalid input with field errors and no panel contact', async () => {
    guard.user.role = 'admin';
    const res = await createProjectAction(serverId, createForm({port: '70000'}));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe('validation');
      expect(res.fieldErrors?.port).toBeTruthy();
    }
  });

  it('viewer is blocked', async () => {
    guard.user.role = 'viewer';
    const res = await createProjectAction(serverId, createForm());
    expect(res.ok).toBe(false);
  });
});

describe('modifyProjectAction', () => {
  it('admin modifies a project and an audit row is written', async () => {
    guard.user.role = 'admin';
    const res = await modifyProjectAction(serverId, modifyForm());
    expect(res.ok).toBe(true);

    const audit = await prisma.auditLog.findFirst({
      where: {action: 'project.modify', target: 'app', result: 'ok'},
    });
    expect(audit).not.toBeNull();
    if (audit) cleanupAuditIds.push(audit.id);
  });

  it('rejects a non-absolute cwd', async () => {
    guard.user.role = 'admin';
    const res = await modifyProjectAction(serverId, modifyForm({cwd: 'relative'}));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('validation');
  });
});

describe('deleteProjectAction', () => {
  it('deletes when the typed confirmation matches the name', async () => {
    guard.user.role = 'admin';
    const fd = new FormData();
    fd.set('name', 'app');
    fd.set('confirm', 'app');
    const res = await deleteProjectAction(serverId, fd);
    expect(res.ok).toBe(true);

    const audit = await prisma.auditLog.findFirst({
      where: {action: 'project.delete', target: 'app', result: 'ok'},
    });
    expect(audit).not.toBeNull();
    if (audit) cleanupAuditIds.push(audit.id);
  });

  it('refuses when the confirmation does not match', async () => {
    guard.user.role = 'admin';
    const fd = new FormData();
    fd.set('name', 'app');
    fd.set('confirm', 'wrong');
    const res = await deleteProjectAction(serverId, fd);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('confirm');
  });

  it('viewer is blocked', async () => {
    guard.user.role = 'viewer';
    const fd = new FormData();
    fd.set('name', 'app');
    fd.set('confirm', 'app');
    const res = await deleteProjectAction(serverId, fd);
    expect(res.ok).toBe(false);
  });
});

describe('listDirAction', () => {
  it('admin lists directories', async () => {
    guard.user.role = 'admin';
    const res = await listDirAction(serverId, '/www/node-projects');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.path).toBe('/www/node-projects');
      expect(res.dirs).toEqual(['app', 'another']);
    }
  });

  it('viewer is forbidden', async () => {
    guard.user.role = 'viewer';
    const res = await listDirAction(serverId, '/www');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toBe('forbidden');
  });
});
