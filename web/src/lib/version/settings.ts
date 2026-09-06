import 'server-only';
import {prisma} from '@/lib/db/prisma';
import {encryptSecret, decryptSecret} from '@/lib/crypto/secret-box';
import {getEncryptionKey} from '@/lib/config/secrets';
import {probeCertificate, type TlsMode} from '@/lib/aapanel/tls';
import {DEPLOYMENT_MODES, type DeploymentMode, type UpdateSettingsView} from './types';
import {HOME_REPO} from './home-repo';

const SINGLETON_ID = 'singleton';

function toMode(v: string): DeploymentMode {
  return (DEPLOYMENT_MODES as readonly string[]).includes(v) ? (v as DeploymentMode) : 'manual';
}

const DEFAULTS: UpdateSettingsView = {
  deploymentMode: 'manual',
  githubOwner: '',
  githubRepo: '',
  hasToken: false,
  selfBaseUrl: null,
  hasSelfKey: false,
  selfTlsMode: 'PINNED',
  selfTlsPinSha256: null,
  selfProject: null,
  aapanelServerId: null,
  aapanelProject: null,
  startScript: null,
  serviceName: null,
  stagedVersion: null,
  stagedAt: null,
  previousVersion: null,
};

/** Reads the singleton settings (defaults when no row exists yet — no write). */
export async function getUpdateSettings(): Promise<UpdateSettingsView> {
  const row = await prisma.updateSettings.findUnique({where: {id: SINGLETON_ID}});
  if (!row) return {...DEFAULTS};
  return {
    deploymentMode: toMode(row.deploymentMode),
    githubOwner: row.githubOwner,
    githubRepo: row.githubRepo,
    hasToken: Boolean(row.githubTokenEnc),
    selfBaseUrl: row.selfBaseUrl,
    hasSelfKey: Boolean(row.selfApiKeyEnc),
    selfTlsMode: row.selfTlsMode,
    selfTlsPinSha256: row.selfTlsPinSha256,
    selfProject: row.selfProject,
    aapanelServerId: row.aapanelServerId,
    aapanelProject: row.aapanelProject,
    startScript: row.startScript,
    serviceName: row.serviceName,
    stagedVersion: row.stagedVersion,
    stagedAt: row.stagedAt ? row.stagedAt.toISOString() : null,
    previousVersion: row.previousVersion,
  };
}

export interface SaveUpdateSettingsInput {
  deploymentMode: DeploymentMode;
  githubOwner: string;
  githubRepo: string;
  /** New token; blank/undefined keeps the existing one. */
  githubToken?: string;
  /** Self-restart: the panel's own aaPanel. */
  selfBaseUrl?: string | null;
  /** New self-restart api_sk; blank/undefined keeps the existing one. */
  selfApiKey?: string;
  selfTlsMode?: TlsMode;
  selfProject?: string | null;
  serviceName?: string | null;
}

/** Upserts the singleton settings. A blank token/api-key preserves the stored one. */
export async function saveUpdateSettings(input: SaveUpdateSettingsInput): Promise<void> {
  const data = {
    deploymentMode: input.deploymentMode,
    githubOwner: input.githubOwner,
    githubRepo: input.githubRepo,
    selfBaseUrl: input.selfBaseUrl ?? null,
    selfTlsMode: input.selfTlsMode ?? 'PINNED',
    selfProject: input.selfProject ?? null,
    serviceName: input.serviceName ?? null,
  };

  const key = getEncryptionKey();
  const token = input.githubToken?.trim();
  const tokenData = token ? {githubTokenEnc: encryptSecret(token, key)} : {};
  const selfKey = input.selfApiKey?.trim();
  const selfKeyData = selfKey ? {selfApiKeyEnc: encryptSecret(selfKey, key)} : {};

  await prisma.updateSettings.upsert({
    where: {id: SINGLETON_ID},
    create: {id: SINGLETON_ID, ...data, ...tokenData, ...selfKeyData},
    update: {...data, ...tokenData, ...selfKeyData},
  });
}

/**
 * Records (or clears) the staged release version awaiting activation. Pass null
 * to clear. Upserts the singleton so it works before any settings are saved.
 */
export async function setStagedVersion(version: string | null): Promise<void> {
  const stagedAt = version ? new Date() : null;
  await prisma.updateSettings.upsert({
    where: {id: SINGLETON_ID},
    create: {id: SINGLETON_ID, stagedVersion: version, stagedAt},
    update: {stagedVersion: version, stagedAt},
  });
}

/**
 * Records an activation (or rollback) of a release: appends it to the version
 * history, stores the version that was active before it (the rollback target),
 * and clears any staged marker. Done before the restart so the new process sees
 * the correct state on boot.
 */
export async function recordActivation(activatedVersion: string, previousVersion: string | null): Promise<void> {
  await prisma.$transaction([
    prisma.updateSettings.upsert({
      where: {id: SINGLETON_ID},
      create: {id: SINGLETON_ID, previousVersion, stagedVersion: null, stagedAt: null},
      update: {previousVersion, stagedVersion: null, stagedAt: null},
    }),
    prisma.versionHistory.create({data: {version: activatedVersion}}),
  ]);
}

/**
 * Server-only: the effective GitHub source for release checks, with the decrypted
 * token. Falls back to the app's own repo ({@link HOME_REPO}) so a stock install
 * checks for its own updates with no configuration; a stored owner/repo (a fork)
 * overrides it.
 */
export async function getGithubConfig(): Promise<{owner: string; repo: string; token: string | null}> {
  const row = await prisma.updateSettings.findUnique({where: {id: SINGLETON_ID}});
  const owner = row?.githubOwner?.trim() || HOME_REPO.owner;
  const repo = row?.githubRepo?.trim() || HOME_REPO.repo;
  let token: string | null = null;
  if (row?.githubTokenEnc) {
    try {
      token = decryptSecret(row.githubTokenEnc, getEncryptionKey());
    } catch {
      token = null; // a stale/invalid ciphertext must not break the check
    }
  }
  return {owner, repo, token};
}

/**
 * Server-only: the panel's own aaPanel self-restart config, including the
 * encrypted api_sk (for {@link createClientForServer}). Returns null when any
 * required field is missing — the caller then reports "not configured".
 */
export async function getSelfRestartConfig(): Promise<
  {baseUrl: string; apiSkEnc: string; tlsMode: TlsMode; tlsPinSha256: string | null; project: string} | null
> {
  const row = await prisma.updateSettings.findUnique({where: {id: SINGLETON_ID}});
  if (!row?.selfBaseUrl || !row.selfApiKeyEnc || !row.selfProject) return null;
  return {
    baseUrl: row.selfBaseUrl,
    apiSkEnc: row.selfApiKeyEnc,
    tlsMode: row.selfTlsMode,
    tlsPinSha256: row.selfTlsPinSha256,
    project: row.selfProject,
  };
}

/**
 * Fingerprint of the panel's own certificate, recorded on first use.
 *
 * Same trust-on-first-use rule as managed servers (ADR-0002): the self-restart
 * connection carries api_sk too, so it must not go to an unidentified peer.
 */
export async function ensureSelfTlsPin(cfg: {
  baseUrl: string;
  tlsMode: TlsMode;
  tlsPinSha256: string | null;
}): Promise<string | null> {
  if (cfg.tlsMode !== 'PINNED' || cfg.tlsPinSha256) return cfg.tlsPinSha256;
  if (!cfg.baseUrl.startsWith('https:')) return null; // nothing to pin over plain http
  const {fingerprint} = await probeCertificate(cfg.baseUrl);
  await prisma.updateSettings.update({
    where: {id: SINGLETON_ID},
    data: {selfTlsPinSha256: fingerprint},
  });
  return fingerprint;
}

/** Appends the version to history if it differs from the most recent entry. */
export async function recordVersionIfNew(version: string): Promise<void> {
  const last = await prisma.versionHistory.findFirst({orderBy: {installedAt: 'desc'}});
  if (last?.version === version) return;
  await prisma.versionHistory.create({data: {version}});
}

export async function getVersionHistory(limit = 20): Promise<{version: string; installedAt: Date}[]> {
  return prisma.versionHistory.findMany({
    orderBy: {installedAt: 'desc'},
    take: limit,
    select: {version: true, installedAt: true},
  });
}
