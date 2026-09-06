import {describe, it, expect, vi, beforeEach} from 'vitest';

vi.mock('@/auth', () => ({auth: vi.fn(async () => null)}));

const guard = vi.hoisted(() => ({role: 'admin' as 'admin' | 'viewer'}));
vi.mock('@/lib/auth/guards', async (orig) => {
  const actual = await orig<typeof import('@/lib/auth/guards')>();
  return {
    ...actual,
    requireAdmin: vi.fn(async () => {
      if (guard.role !== 'admin') throw new actual.AuthError('forbidden');
      return {id: 'u1', email: 'a@b.c', role: 'admin' as const};
    }),
  };
});

vi.mock('next/cache', () => ({revalidatePath: vi.fn()}));
vi.mock('@/lib/audit', () => ({recordAudit: vi.fn(async () => null)}));
vi.mock('@/lib/version/current', () => ({
  getCurrentVersion: () => ({version: '1.0.0', commit: null, buildTime: null}),
}));

const settingsMock = vi.hoisted(() => ({
  getUpdateSettings: vi.fn(),
  saveUpdateSettings: vi.fn(async () => undefined),
  setStagedVersion: vi.fn(async () => undefined),
  getGithubConfig: vi.fn(async () => ({owner: 'acme', repo: 'panel', token: null})),
  getSelfRestartConfig: vi.fn(
    async () =>
      null as null | {
        baseUrl: string;
        apiSkEnc: string;
        tlsMode: 'PINNED' | 'VERIFY';
        tlsPinSha256: string | null;
        project: string;
      },
  ),
  ensureSelfTlsPin: vi.fn(async () => null as string | null),
  getVersionHistory: vi.fn(async () => [] as {version: string; installedAt: Date}[]),
  recordVersionIfNew: vi.fn(async () => undefined),
}));
vi.mock('@/lib/version/settings', () => settingsMock);

const githubMock = vi.hoisted(() => ({fetchReleases: vi.fn()}));
vi.mock('@/lib/version/github', async (orig) => {
  const actual = await orig<typeof import('@/lib/version/github')>();
  return {...actual, fetchReleases: githubMock.fetchReleases};
});

const deployMock = vi.hoisted(() => ({getDeployAdapter: vi.fn()}));
vi.mock('@/lib/deploy', () => ({getDeployAdapter: deployMock.getDeployAdapter}));

const prismaMock = vi.hoisted(() => ({server: {findUnique: vi.fn()}}));
vi.mock('@/lib/db/prisma', () => ({prisma: prismaMock}));

const aapanelMock = vi.hoisted(() => ({batchOperation: vi.fn(async () => ({msg: '', msg_list: []}))}));
vi.mock('@/lib/aapanel', () => ({createClientForServer: vi.fn(() => aapanelMock)}));

vi.mock('@/lib/servers/query', () => ({
  listServerOptions: vi.fn(async () => [{id: 's1', name: 'srv', tag: null}]),
}));

import {
  getUpdateStatusAction,
  getUpdateSettingsAction,
  saveUpdateSettingsAction,
  stageUpdateAction,
  activateUpdateAction,
  rollbackUpdateAction,
} from './updates';

const CONFIGURED = {
  deploymentMode: 'docker' as const,
  githubOwner: 'acme',
  githubRepo: 'panel',
  hasToken: false,
  selfBaseUrl: null,
  hasSelfKey: false,
  selfTlsMode: 'PINNED' as const,
  selfTlsPinSha256: null,
  selfProject: null,
  aapanelServerId: null,
  aapanelProject: null,
  startScript: null,
  serviceName: 'app',
  stagedVersion: null,
  stagedAt: null,
  previousVersion: null,
};

beforeEach(() => {
  guard.role = 'admin';
  settingsMock.getUpdateSettings.mockResolvedValue(CONFIGURED);
  settingsMock.getVersionHistory.mockResolvedValue([]);
  githubMock.fetchReleases.mockReset();
  deployMock.getDeployAdapter.mockReset();
  deployMock.getDeployAdapter.mockReturnValue(null);
});

describe('getUpdateStatusAction', () => {
  it('checks the built-in repo by default even when owner/repo are blank', async () => {
    // Blank owner/repo no longer means "unconfigured": getGithubConfig() resolves
    // the app's own repo, so the status check still runs against GitHub.
    settingsMock.getUpdateSettings.mockResolvedValueOnce({...CONFIGURED, githubOwner: '', githubRepo: ''});
    githubMock.fetchReleases.mockResolvedValueOnce([
      {version: 'v1.2.0', name: '1.2.0', body: '', prerelease: false, publishedAt: null, htmlUrl: 'u'},
    ]);
    const res = await getUpdateStatusAction();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.configured).toBe(true);
      expect(res.updateAvailable).toBe(true);
      expect(res.current.version).toBe('1.0.0');
      expect(res.upgradeCommand).toContain('docker compose');
    }
    expect(githubMock.fetchReleases).toHaveBeenCalled();
  });

  it('flags an available update when the latest release is newer', async () => {
    githubMock.fetchReleases.mockResolvedValueOnce([
      {version: 'v1.2.0', name: '1.2.0', body: 'notes', prerelease: false, publishedAt: '2026-06-10', htmlUrl: 'u'},
    ]);
    const res = await getUpdateStatusAction();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.configured).toBe(true);
      expect(res.latest?.version).toBe('v1.2.0');
      expect(res.updateAvailable).toBe(true);
    }
  });

  it('does not flag an update when latest equals current', async () => {
    githubMock.fetchReleases.mockResolvedValueOnce([
      {version: 'v1.0.0', name: '1.0.0', body: '', prerelease: false, publishedAt: null, htmlUrl: 'u'},
    ]);
    const res = await getUpdateStatusAction();
    expect(res.ok && res.updateAvailable).toBe(false);
  });

  it('surfaces a GitHub error without failing, still returning the current version', async () => {
    githubMock.fetchReleases.mockRejectedValueOnce(new Error('rate limited'));
    const res = await getUpdateStatusAction();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.error).toContain('rate limited');
      expect(res.current.version).toBe('1.0.0');
      expect(res.updateAvailable).toBe(false);
    }
  });

  it('forbids non-admins', async () => {
    guard.role = 'viewer';
    const res = await getUpdateStatusAction();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toBe('forbidden');
  });
});

describe('getUpdateSettingsAction', () => {
  it('returns the update settings', async () => {
    const res = await getUpdateSettingsAction();
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.settings.deploymentMode).toBe('docker');
  });
});

describe('saveUpdateSettingsAction', () => {
  it('saves valid settings', async () => {
    const fd = new FormData();
    fd.set('deploymentMode', 'docker');
    fd.set('githubOwner', 'acme');
    fd.set('githubRepo', 'panel');
    const res = await saveUpdateSettingsAction(fd);
    expect(res.ok).toBe(true);
    expect(settingsMock.saveUpdateSettings).toHaveBeenCalled();
  });

  it('rejects an unknown deployment mode with a validation error', async () => {
    const fd = new FormData();
    fd.set('deploymentMode', 'k8s');
    const res = await saveUpdateSettingsAction(fd);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('validation');
  });

  it('forbids non-admins', async () => {
    guard.role = 'viewer';
    const fd = new FormData();
    fd.set('deploymentMode', 'docker');
    const res = await saveUpdateSettingsAction(fd);
    expect(res.ok).toBe(false);
  });
});

describe('stageUpdateAction', () => {
  const RELEASE = {
    version: 'v1.2.0',
    name: '1.2.0',
    body: '',
    prerelease: false,
    publishedAt: null,
    htmlUrl: '',
    assets: [],
  };

  it('forbids non-admins', async () => {
    guard.role = 'viewer';
    const res = await stageUpdateAction('1.2.0');
    expect(res).toEqual({ok: false, error: 'forbidden'});
  });

  it('returns unsupported-mode when no adapter exists for the mode', async () => {
    deployMock.getDeployAdapter.mockReturnValue(null);
    const res = await stageUpdateAction('1.2.0');
    expect(res).toEqual({ok: false, error: 'unsupported-mode'});
  });

  it('returns release-not-found when the version is not among releases', async () => {
    deployMock.getDeployAdapter.mockReturnValue({mode: 'aapanel', preflight: vi.fn(), stage: vi.fn()});
    githubMock.fetchReleases.mockResolvedValueOnce([RELEASE]);
    const res = await stageUpdateAction('9.9.9');
    expect(res).toEqual({ok: false, error: 'release-not-found'});
  });

  it('stages the matching release and audits success (v-prefix tolerant)', async () => {
    const stage = vi.fn(async () => ({
      ok: true as const,
      version: '1.2.0',
      steps: [{name: 'download', ok: true}],
      backupPath: '/b/pre.sql',
    }));
    deployMock.getDeployAdapter.mockReturnValue({mode: 'aapanel', preflight: vi.fn(), stage});
    githubMock.fetchReleases.mockResolvedValueOnce([RELEASE]);

    const res = await stageUpdateAction('1.2.0');
    expect(res).toEqual({ok: true, version: '1.2.0', steps: [{name: 'download', ok: true}], backupPath: '/b/pre.sql'});
    // the v-prefixed release tag matched the un-prefixed request
    expect(stage).toHaveBeenCalledWith(expect.objectContaining({release: RELEASE}));
  });

  it('reports a staging failure with its steps', async () => {
    const stage = vi.fn(async () => ({
      ok: false as const,
      version: '1.2.0',
      steps: [{name: 'verify-checksum', ok: false, detail: 'mismatch'}],
      message: 'Checksum mismatch',
    }));
    deployMock.getDeployAdapter.mockReturnValue({mode: 'aapanel', preflight: vi.fn(), stage});
    githubMock.fetchReleases.mockResolvedValueOnce([RELEASE]);

    const res = await stageUpdateAction('v1.2.0');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe('stage-failed');
      expect(res.message).toContain('Checksum');
      expect(res.steps?.[0]?.ok).toBe(false);
    }
  });
});

describe('activateUpdateAction / rollbackUpdateAction', () => {
  const AAPANEL = {
    ...CONFIGURED,
    deploymentMode: 'aapanel' as const,
    selfBaseUrl: 'https://127.0.0.1:8888',
    hasSelfKey: true,
    selfProject: 'panel',
    stagedVersion: '1.2.0',
    previousVersion: '1.0.0',
  };
  const okAdapter = (overrides = {}) => ({
    mode: 'aapanel',
    preflight: vi.fn(),
    stage: vi.fn(),
    activate: vi.fn(async () => ({ok: true, version: '1.2.0', previousVersion: '1.0.0', steps: []})),
    rollback: vi.fn(async () => ({ok: true, version: '1.0.0', previousVersion: '1.2.0', steps: []})),
    ...overrides,
  });

  beforeEach(() => {
    settingsMock.getUpdateSettings.mockResolvedValue(AAPANEL);
    settingsMock.getSelfRestartConfig.mockResolvedValue({
      baseUrl: 'https://127.0.0.1:8888',
      apiSkEnc: 'enc',
      tlsMode: 'PINNED',
      tlsPinSha256: null,
      project: 'panel',
    });
    deployMock.getDeployAdapter.mockReturnValue(okAdapter());
    aapanelMock.batchOperation.mockClear();
  });

  it('forbids non-admins', async () => {
    guard.role = 'viewer';
    expect((await activateUpdateAction()).ok).toBe(false);
    expect((await rollbackUpdateAction('1.0.0')).ok).toBe(false);
  });

  it('errors when nothing is staged', async () => {
    settingsMock.getUpdateSettings.mockResolvedValue({...AAPANEL, stagedVersion: null});
    expect(await activateUpdateAction()).toEqual({ok: false, error: 'nothing-staged'});
  });

  it('errors when self-restart is not configured', async () => {
    settingsMock.getSelfRestartConfig.mockResolvedValue(null);
    expect(await activateUpdateAction()).toEqual({ok: false, error: 'self-restart-not-configured'});
  });

  it('activates the staged version and wires the aaPanel restart', async () => {
    const adapter = okAdapter({
      activate: vi.fn(async (input: {restart: () => Promise<void>}) => {
        await input.restart(); // adapter triggers the injected restart
        return {ok: true, version: '1.2.0', previousVersion: '1.0.0', steps: []};
      }),
    });
    deployMock.getDeployAdapter.mockReturnValue(adapter);

    const res = await activateUpdateAction();
    expect(res.ok).toBe(true);
    expect(adapter.activate).toHaveBeenCalledWith(
      expect.objectContaining({version: '1.2.0', runningVersion: '1.0.0'}),
    );
    // the injected restart bounces the panel's own project via aaPanel
    expect(aapanelMock.batchOperation).toHaveBeenCalledWith(['panel'], 'restart');
  });

  it('rolls back to the requested version', async () => {
    const res = await rollbackUpdateAction('v1.0.0');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.version).toBe('1.0.0');
  });

  it('rejects an empty rollback target', async () => {
    expect(await rollbackUpdateAction('   ')).toEqual({ok: false, error: 'no-target'});
  });
});
