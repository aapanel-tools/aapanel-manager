'use server';
import {revalidatePath} from 'next/cache';
import {requireAdmin, AuthError} from '@/lib/auth/guards';
import {getCurrentVersion, type CurrentVersion} from '@/lib/version/current';
import {
  getUpdateSettings,
  saveUpdateSettings,
  getGithubConfig,
  getSelfRestartConfig,
  getVersionHistory,
  recordVersionIfNew,
  ensureSelfTlsPin,
} from '@/lib/version/settings';
import {fetchReleases, pickLatestStable, GithubError, type GithubRelease} from '@/lib/version/github';
import {isNewer} from '@/lib/version/semver';
import {buildUpgradeCommand} from '@/lib/version/upgrade-command';
import {updateSettingsSchema} from '@/lib/validation/update-settings';
import type {UpdateSettingsView, DeploymentMode} from '@/lib/version/types';
import {recordAudit} from '@/lib/audit';
import {parseEnv} from '@/env';
import {getDeployAdapter, type StageStep, type DeployAdapter} from '@/lib/deploy';
import {findBundleAssets} from '@/lib/deploy/bundle-assets';
import {gitRepoRoot, updatePaths, acquireUpdateLock, releaseUpdateLock, launchGitUpdate, readUpdateStatus} from '@/lib/deploy/git';
import type {UpdateStatus} from '@/lib/deploy/update-status';
import {createClientForServer} from '@/lib/aapanel';
import {log} from '@/log';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface LatestRelease {
  version: string;
  name: string;
  body: string;
  publishedAt: string | null;
  htmlUrl: string;
}

export type UpdateStatusResult =
  | {
      ok: true;
      current: CurrentVersion;
      configured: boolean;
      latest: LatestRelease | null;
      updateAvailable: boolean;
      releases: GithubRelease[];
      upgradeCommand: string;
      history: {version: string; installedAt: string}[];
      /** Non-fatal GitHub error (network/rate-limit/etc.); current version still shown. */
      error: string | null;
      /** Configured deployment mode (drives which one-click flow the UI shows). */
      deploymentMode: DeploymentMode;
      /** A release that was downloaded+migrated and awaits activation, or null. */
      stagedVersion: string | null;
      /** The version active before the last activation — the rollback target, or null. */
      previousVersion: string | null;
      /** True when one-click staging is wired for this mode + APP_RELEASE_ROOT is set. */
      stagingSupported: boolean;
      /** True when the panel's own aaPanel self-restart target is fully configured. */
      selfRestartConfigured: boolean;
      /** True when the latest release ships a standalone bundle the panel can stage. */
      bundleAvailable: boolean;
    }
  | {ok: false; message: string};

export type UpdateSettingsDataResult =
  | {ok: true; settings: UpdateSettingsView}
  | {ok: false; message: string};

export type SaveSettingsResult =
  | {ok: true}
  | {ok: false; error: string; fieldErrors?: Record<string, string[]>};

function collectFieldErrors(issues: {path: PropertyKey[]; message: string}[]): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of issues) {
    const key = issue.path.join('.');
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return fieldErrors;
}

// ---------------------------------------------------------------------------
// Actions (admin only)
// ---------------------------------------------------------------------------

/** Current vs latest version + changelog + history. Requires admin role. */
export async function getUpdateStatusAction(): Promise<UpdateStatusResult> {
  try {
    await requireAdmin();
  } catch {
    return {ok: false, message: 'forbidden'};
  }

  const current = getCurrentVersion();
  // Best-effort history record — never block the status on it.
  try {
    await recordVersionIfNew(current.version);
  } catch (err) {
    log.warn({err}, 'recordVersionIfNew failed');
  }

  const settings = await getUpdateSettings();
  const upgradeCommand = buildUpgradeCommand(settings.deploymentMode, {serviceName: settings.serviceName});
  const history = (await getVersionHistory()).map((h) => ({
    version: h.version,
    installedAt: h.installedAt.toISOString(),
  }));

  const env = parseEnv();
  const stagingSupported =
    Boolean(env.APP_RELEASE_ROOT) && getDeployAdapter(settings.deploymentMode, env.APP_RELEASE_ROOT) !== null;
  const base = {
    deploymentMode: settings.deploymentMode,
    stagedVersion: settings.stagedVersion,
    previousVersion: settings.previousVersion,
    stagingSupported,
    selfRestartConfigured: Boolean(settings.selfBaseUrl && settings.hasSelfKey && settings.selfProject),
  };

  // The app always knows its own repo (HOME_REPO), so it is "configured" out of
  // the box; getGithubConfig() resolves a fork override when the admin set one.
  try {
    const cfg = await getGithubConfig();
    const releases = await fetchReleases(cfg);
    const latestRel = pickLatestStable(releases);
    const latest: LatestRelease | null = latestRel
      ? {
          version: latestRel.version,
          name: latestRel.name,
          body: latestRel.body,
          publishedAt: latestRel.publishedAt,
          htmlUrl: latestRel.htmlUrl,
        }
      : null;
    const updateAvailable = latest ? isNewer(latest.version, current.version) : false;
    const bundleAvailable = latestRel ? findBundleAssets(latestRel, latestRel.version) !== null : false;
    return {ok: true, current, configured: true, latest, updateAvailable, releases, upgradeCommand, history, error: null, ...base, bundleAvailable};
  } catch (err) {
    const message = err instanceof GithubError || err instanceof Error ? err.message : 'Update check failed';
    log.error({err}, 'getUpdateStatusAction GitHub check failed');
    return {ok: true, current, configured: true, latest: null, updateAvailable: false, releases: [], upgradeCommand, history, error: message, ...base, bundleAvailable: false};
  }
}

/** Loads the update settings. Requires admin role. */
export async function getUpdateSettingsAction(): Promise<UpdateSettingsDataResult> {
  try {
    await requireAdmin();
  } catch {
    return {ok: false, message: 'forbidden'};
  }
  const settings = await getUpdateSettings();
  return {ok: true, settings};
}

/** Saves update settings. Requires admin role. Records audit on both paths. */
export async function saveUpdateSettingsAction(formData: FormData): Promise<SaveSettingsResult> {
  let userId: string;
  try {
    const user = await requireAdmin();
    userId = user.id;
  } catch (e) {
    return {ok: false, error: e instanceof AuthError ? e.code : 'forbidden'};
  }

  const parsed = updateSettingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {ok: false, error: 'validation', fieldErrors: collectFieldErrors(parsed.error.issues)};
  }

  try {
    await saveUpdateSettings(parsed.data);
    await recordAudit({userId, action: 'updates.settings', result: 'ok'});
    revalidatePath('/settings');
    return {ok: true};
  } catch (err) {
    log.error({err}, 'saveUpdateSettingsAction failed');
    await recordAudit({userId, action: 'updates.settings', result: 'error'});
    return {ok: false, error: err instanceof Error ? err.message : 'Failed to save settings'};
  }
}

// ---------------------------------------------------------------------------
// Phase 2a — stage an update (download + verify + DB backup + migrate). No
// self-restart: the staged release is activated separately in Phase 2b.
// ---------------------------------------------------------------------------

export type StageActionResult =
  | {ok: true; version: string; steps: StageStep[]; backupPath: string | null}
  | {ok: false; error: string; steps?: StageStep[]; message?: string};

/**
 * Downloads, verifies, backs up and migrates the requested release into the
 * release directory, leaving it ready for activation. Admin only; audited.
 * `allowBackupSkip` proceeds even when pg_dump is unavailable.
 */
export async function stageUpdateAction(
  targetVersion: string,
  opts: {allowBackupSkip?: boolean} = {},
): Promise<StageActionResult> {
  let userId: string;
  try {
    const user = await requireAdmin();
    userId = user.id;
  } catch {
    return {ok: false, error: 'forbidden'};
  }

  const env = parseEnv();
  const settings = await getUpdateSettings();
  const adapter = getDeployAdapter(settings.deploymentMode, env.APP_RELEASE_ROOT);
  if (!adapter) {
    return {ok: false, error: 'unsupported-mode'};
  }

  try {
    const cfg = await getGithubConfig();
    const releases = await fetchReleases(cfg);
    const want = targetVersion.trim().replace(/^v/, '');
    const release = releases.find((r) => r.version.replace(/^v/, '') === want);
    if (!release) {
      return {ok: false, error: 'release-not-found'};
    }

    const result = await adapter.stage({
      release,
      databaseUrl: env.DATABASE_URL,
      githubToken: cfg.token,
      allowBackupSkip: opts.allowBackupSkip,
    });

    await recordAudit({
      userId,
      action: 'updates.stage',
      target: result.version,
      result: result.ok ? 'ok' : 'error',
    });
    revalidatePath('/settings');

    if (result.ok) {
      return {ok: true, version: result.version, steps: result.steps, backupPath: result.backupPath ?? null};
    }
    return {ok: false, error: 'stage-failed', steps: result.steps, message: result.message};
  } catch (err) {
    log.error({err}, 'stageUpdateAction failed');
    await recordAudit({userId, action: 'updates.stage', target: targetVersion, result: 'error'});
    return {ok: false, error: err instanceof Error ? err.message : 'Staging failed'};
  }
}

// ---------------------------------------------------------------------------
// Phase 2b — activate a staged release / roll back. Repoints the `current`
// symlink and restarts the panel's own Node project via the aaPanel API.
// ---------------------------------------------------------------------------

export type ActivateActionResult =
  | {ok: true; version: string; previousVersion: string | null; steps: StageStep[]}
  | {ok: false; error: string; steps?: StageStep[]; message?: string};

/**
 * Builds the aaPanel adapter plus a restart() that bounces the panel's OWN Node
 * project through its OWN aaPanel API. The self-restart target is configured once
 * (Settings → self-restart), independent of the managed-servers list.
 */
async function prepareSelfRestart(): Promise<
  | {ok: true; adapter: DeployAdapter; restart: () => Promise<void>; runningVersion: string; settings: UpdateSettingsView}
  | {ok: false; error: string}
> {
  const env = parseEnv();
  const settings = await getUpdateSettings();
  const adapter = getDeployAdapter(settings.deploymentMode, env.APP_RELEASE_ROOT);
  if (!adapter) return {ok: false, error: 'unsupported-mode'};
  const self = await getSelfRestartConfig();
  if (!self) return {ok: false, error: 'self-restart-not-configured'};
  const client = await createClientForServer({
    baseUrl: self.baseUrl,
    apiSkEnc: self.apiSkEnc,
    tlsMode: self.tlsMode,
    tlsPinSha256: await ensureSelfTlsPin(self),
  });
  const restart = async (): Promise<void> => {
    await client.batchOperation([self.project], 'restart');
  };
  return {ok: true, adapter, restart, runningVersion: getCurrentVersion().version, settings};
}

/** Activates the staged release (atomic symlink swap + self-restart). Admin only; audited. */
export async function activateUpdateAction(): Promise<ActivateActionResult> {
  let userId: string;
  try {
    userId = (await requireAdmin()).id;
  } catch {
    return {ok: false, error: 'forbidden'};
  }

  const prep = await prepareSelfRestart();
  if (!prep.ok) return {ok: false, error: prep.error};

  const version = prep.settings.stagedVersion;
  if (!version) return {ok: false, error: 'nothing-staged'};

  try {
    const result = await prep.adapter.activate({
      version,
      runningVersion: prep.runningVersion,
      restart: prep.restart,
    });
    await recordAudit({userId, action: 'updates.activate', target: result.version, result: result.ok ? 'ok' : 'error'});
    revalidatePath('/settings');
    return result.ok
      ? {ok: true, version: result.version, previousVersion: result.previousVersion, steps: result.steps}
      : {ok: false, error: 'activate-failed', steps: result.steps, message: result.message};
  } catch (err) {
    log.error({err}, 'activateUpdateAction failed');
    await recordAudit({userId, action: 'updates.activate', target: version, result: 'error'});
    return {ok: false, error: err instanceof Error ? err.message : 'Activation failed'};
  }
}

/** Rolls back to a previously-installed release directory (symlink swap + self-restart). */
export async function rollbackUpdateAction(toVersion: string): Promise<ActivateActionResult> {
  let userId: string;
  try {
    userId = (await requireAdmin()).id;
  } catch {
    return {ok: false, error: 'forbidden'};
  }

  const target = toVersion.trim().replace(/^v/, '');
  if (!target) return {ok: false, error: 'no-target'};

  const prep = await prepareSelfRestart();
  if (!prep.ok) return {ok: false, error: prep.error};

  try {
    const result = await prep.adapter.rollback({
      version: target,
      runningVersion: prep.runningVersion,
      restart: prep.restart,
    });
    await recordAudit({userId, action: 'updates.rollback', target: result.version, result: result.ok ? 'ok' : 'error'});
    revalidatePath('/settings');
    return result.ok
      ? {ok: true, version: result.version, previousVersion: result.previousVersion, steps: result.steps}
      : {ok: false, error: 'rollback-failed', steps: result.steps, message: result.message};
  } catch (err) {
    log.error({err}, 'rollbackUpdateAction failed');
    await recordAudit({userId, action: 'updates.rollback', target, result: 'error'});
    return {ok: false, error: err instanceof Error ? err.message : 'Rollback failed'};
  }
}

// ---------------------------------------------------------------------------
// Git deployment mode — update/rollback in place: a detached runner does
// git fetch + checkout + install + migrate + build, then restarts the panel's
// own Node project via the aaPanel API. The action only validates + launches;
// the heavy work and the restart happen in the detached process (it outlives
// the restart). The UI then polls /api/health for the target version.
// ---------------------------------------------------------------------------

export type GitDeployActionResult = {ok: true; target: string} | {ok: false; error: string};

/** Validates git mode + self-restart + repo, takes the lock, launches the runner. */
async function launchGitDeploy(kind: 'update' | 'rollback', target: string): Promise<GitDeployActionResult> {
  const settings = await getUpdateSettings();
  if (settings.deploymentMode !== 'git') return {ok: false, error: 'unsupported-mode'};
  if (!(await getSelfRestartConfig())) return {ok: false, error: 'self-restart-not-configured'};

  const webDir = process.cwd();
  const repoRoot = await gitRepoRoot(webDir);
  if (!repoRoot) return {ok: false, error: 'not-a-git-repo'};

  const paths = updatePaths(repoRoot);
  const now = Date.now();
  if (!acquireUpdateLock(paths.lock, {kind, target, startedAt: now}, now)) {
    return {ok: false, error: 'update-in-progress'};
  }
  try {
    launchGitUpdate({webDir, logPath: paths.log, kind, target});
  } catch (err) {
    releaseUpdateLock(paths.lock); // launch failed — don't leave a stuck lock
    throw err;
  }
  return {ok: true, target};
}

/** Git mode: update in place to the latest stable release. Admin only; audited. */
export async function gitUpdateAction(): Promise<GitDeployActionResult> {
  let userId: string;
  try {
    userId = (await requireAdmin()).id;
  } catch {
    return {ok: false, error: 'forbidden'};
  }
  try {
    const cfg = await getGithubConfig();
    const releases = await fetchReleases(cfg);
    const latest = pickLatestStable(releases);
    if (!latest) return {ok: false, error: 'release-not-found'};
    const target = latest.version.replace(/^v/, '');
    if (!isNewer(target, getCurrentVersion().version)) return {ok: false, error: 'up-to-date'};

    const res = await launchGitDeploy('update', target);
    await recordAudit({userId, action: 'updates.git-update', target, result: res.ok ? 'ok' : 'error'});
    return res;
  } catch (err) {
    log.error({err}, 'gitUpdateAction failed');
    await recordAudit({userId, action: 'updates.git-update', result: 'error'});
    return {ok: false, error: err instanceof Error ? err.message : 'Git update failed'};
  }
}

/** Git mode: roll back in place to a previous release tag. Admin only; audited. */
export async function gitRollbackAction(toVersion: string): Promise<GitDeployActionResult> {
  let userId: string;
  try {
    userId = (await requireAdmin()).id;
  } catch {
    return {ok: false, error: 'forbidden'};
  }
  const target = toVersion.trim().replace(/^v/, '');
  if (!target) return {ok: false, error: 'no-target'};
  try {
    const res = await launchGitDeploy('rollback', target);
    await recordAudit({userId, action: 'updates.git-rollback', target, result: res.ok ? 'ok' : 'error'});
    return res;
  } catch (err) {
    log.error({err}, 'gitRollbackAction failed');
    await recordAudit({userId, action: 'updates.git-rollback', target, result: 'error'});
    return {ok: false, error: err instanceof Error ? err.message : 'Git rollback failed'};
  }
}

export type UpdateProgressResult =
  | {ok: true; status: UpdateStatus | null}
  | {ok: false; error: string};

/**
 * Live step-by-step progress of an in-flight (or last) git update, read from
 * the `.update.status` file the detached runner writes. The UI polls this while
 * an update runs to render the checklist. Admin only; never throws to the client.
 */
export async function getUpdateProgressAction(): Promise<UpdateProgressResult> {
  try {
    await requireAdmin();
  } catch {
    return {ok: false, error: 'forbidden'};
  }
  const repoRoot = await gitRepoRoot(process.cwd());
  if (!repoRoot) return {ok: true, status: null};
  return {ok: true, status: readUpdateStatus(updatePaths(repoRoot).status)};
}
