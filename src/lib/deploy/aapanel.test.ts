import {describe, it, expect, vi, beforeEach} from 'vitest';

// Mock the filesystem layer so activate/rollback are testable on any OS (no real
// symlinks, which need privileges on Windows). aapanel.ts imports these names.
const fsm = vi.hoisted(() => ({
  mkdir: vi.fn(async () => undefined),
  rm: vi.fn(async () => undefined),
  rename: vi.fn(async () => undefined),
  symlink: vi.fn(async () => undefined),
  readlink: vi.fn(async () => '/root/releases/1.0.0'),
  stat: vi.fn(async () => ({isDirectory: () => true})),
}));
vi.mock('node:fs/promises', () => fsm);

const settingsMock = vi.hoisted(() => ({
  setStagedVersion: vi.fn(async () => undefined),
  recordActivation: vi.fn(async () => undefined),
}));
vi.mock('@/lib/version/settings', () => settingsMock);
vi.mock('@/log', () => ({log: {info: vi.fn(), warn: vi.fn(), error: vi.fn()}}));

import {AaPanelDeployAdapter} from './aapanel';

describe('AaPanelDeployAdapter activate/rollback', () => {
  beforeEach(() => {
    for (const f of Object.values(fsm)) f.mockClear();
    settingsMock.recordActivation.mockClear();
    fsm.stat.mockResolvedValue({isDirectory: () => true});
    fsm.readlink.mockResolvedValue('/root/releases/1.0.0');
  });

  it('activates: swaps current → release, records DB state, then restarts (in order)', async () => {
    const restart = vi.fn(async () => undefined);
    const adapter = new AaPanelDeployAdapter('/root');

    const res = await adapter.activate({version: '1.2.0', runningVersion: '1.0.0', restart});

    expect(res.ok).toBe(true);
    expect(res.version).toBe('1.2.0');
    expect(res.previousVersion).toBe('1.0.0'); // from the current symlink target
    expect(fsm.symlink).toHaveBeenCalled();
    expect(fsm.rename).toHaveBeenCalled();
    expect(settingsMock.recordActivation).toHaveBeenCalledWith('1.2.0', '1.0.0');
    expect(restart).toHaveBeenCalled();
    // order: symlink swap (rename) → recordActivation → restart (restart LAST)
    const renameAt = fsm.rename.mock.invocationCallOrder[0]!;
    const recordAt = settingsMock.recordActivation.mock.invocationCallOrder[0]!;
    const restartAt = restart.mock.invocationCallOrder[0]!;
    expect(renameAt).toBeLessThan(recordAt);
    expect(recordAt).toBeLessThan(restartAt);
  });

  it('falls back to runningVersion when there is no current symlink yet', async () => {
    fsm.readlink.mockRejectedValueOnce(new Error('ENOENT'));
    const adapter = new AaPanelDeployAdapter('/root');
    const res = await adapter.activate({version: '1.2.0', runningVersion: '0.9.9', restart: vi.fn(async () => undefined)});
    expect(res.previousVersion).toBe('0.9.9');
    expect(settingsMock.recordActivation).toHaveBeenCalledWith('1.2.0', '0.9.9');
  });

  it('fails without restarting when the target release dir is missing', async () => {
    fsm.stat.mockRejectedValueOnce(new Error('ENOENT'));
    const restart = vi.fn(async () => undefined);
    const adapter = new AaPanelDeployAdapter('/root');

    const res = await adapter.activate({version: '1.2.0', runningVersion: '1.0.0', restart});

    expect(res.ok).toBe(false);
    expect(restart).not.toHaveBeenCalled();
    expect(settingsMock.recordActivation).not.toHaveBeenCalled();
    expect(fsm.rename).not.toHaveBeenCalled();
  });

  it('rollback swaps to the target release and restarts', async () => {
    const restart = vi.fn(async () => undefined);
    const adapter = new AaPanelDeployAdapter('/root');

    const res = await adapter.rollback({version: 'v0.9.0', runningVersion: '1.2.0', restart});

    expect(res.ok).toBe(true);
    expect(res.version).toBe('0.9.0'); // v-prefix sanitized
    expect(settingsMock.recordActivation).toHaveBeenCalledWith('0.9.0', '1.0.0');
    expect(restart).toHaveBeenCalled();
  });

  it('errors when APP_RELEASE_ROOT is not set', async () => {
    const adapter = new AaPanelDeployAdapter(undefined);
    const res = await adapter.activate({version: '1.2.0', runningVersion: '1.0.0', restart: vi.fn(async () => undefined)});
    expect(res.ok).toBe(false);
  });
});
