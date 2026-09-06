import {describe, it, expect, vi, beforeEach} from 'vitest';

const prismaMock = vi.hoisted(() => ({updateSettings: {findUnique: vi.fn()}}));
vi.mock('@/lib/db/prisma', () => ({prisma: prismaMock}));
vi.mock('@/lib/crypto/secret-box', () => ({
  encryptSecret: vi.fn(() => 'enc'),
  decryptSecret: vi.fn(() => 'decrypted-token'),
}));
vi.mock('@/lib/config/secrets', () => ({getEncryptionKey: vi.fn(() => Buffer.alloc(32))}));

import {getGithubConfig, getSelfRestartConfig} from './settings';
import {HOME_REPO} from './home-repo';

beforeEach(() => {
  prismaMock.updateSettings.findUnique.mockReset();
});

describe('getGithubConfig', () => {
  it('falls back to the app home repo when no settings row exists', async () => {
    prismaMock.updateSettings.findUnique.mockResolvedValue(null);
    const cfg = await getGithubConfig();
    expect(cfg).toEqual({owner: HOME_REPO.owner, repo: HOME_REPO.repo, token: null});
  });

  it('falls back to the home repo when the stored owner/repo are blank', async () => {
    prismaMock.updateSettings.findUnique.mockResolvedValue({
      githubOwner: '   ',
      githubRepo: '',
      githubTokenEnc: null,
    });
    const cfg = await getGithubConfig();
    expect(cfg.owner).toBe(HOME_REPO.owner);
    expect(cfg.repo).toBe(HOME_REPO.repo);
  });

  it('uses a stored fork owner/repo and decrypts the token when set', async () => {
    prismaMock.updateSettings.findUnique.mockResolvedValue({
      githubOwner: 'someone',
      githubRepo: 'their-fork',
      githubTokenEnc: 'cipher',
    });
    const cfg = await getGithubConfig();
    expect(cfg).toEqual({owner: 'someone', repo: 'their-fork', token: 'decrypted-token'});
  });
});

describe('getSelfRestartConfig', () => {
  it('returns null when the self-restart fields are incomplete', async () => {
    prismaMock.updateSettings.findUnique.mockResolvedValue({
      selfBaseUrl: 'https://127.0.0.1:8888',
      selfApiKeyEnc: null,
      selfTlsMode: 'PINNED',
      selfTlsPinSha256: null,
      selfProject: 'panel',
    });
    expect(await getSelfRestartConfig()).toBeNull();
  });

  it('returns the encrypted config (no decryption here) when all fields are present', async () => {
    prismaMock.updateSettings.findUnique.mockResolvedValue({
      selfBaseUrl: 'https://127.0.0.1:8888',
      selfApiKeyEnc: 'cipher',
      selfTlsMode: 'VERIFY',
      selfTlsPinSha256: null,
      selfProject: 'panel',
    });
    expect(await getSelfRestartConfig()).toEqual({
      baseUrl: 'https://127.0.0.1:8888',
      apiSkEnc: 'cipher',
      tlsMode: 'VERIFY',
      tlsPinSha256: null,
      project: 'panel',
    });
  });
});
