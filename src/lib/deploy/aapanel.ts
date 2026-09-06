import 'server-only';
import path from 'node:path';
import {mkdir, rm, rename, symlink, readlink, stat} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {log} from '@/log';
import {setStagedVersion, recordActivation} from '@/lib/version/settings';
import type {
  DeployAdapter,
  PreflightResult,
  StageInput,
  StageResult,
  StageStep,
  ActivateInput,
  ActivateResult,
} from './adapter';
import {releaseLayout, sanitizeVersion, bundleAssetName} from './layout';
import {findBundleAssets, parseChecksumFile} from './bundle-assets';
import {downloadToFile, verifyFileChecksum, extractTarGz} from './bundle';
import {runDbBackup, isPgDumpAvailable, PgDumpNotAvailableError} from './db-backup';
import {runMigrations} from './migrate';

const execFileAsync = promisify(execFile);

/**
 * Self-update adapter for the "aaPanel Node project" deployment mode.
 * - stage(): download → verify → unpack → DB backup → migrate, while the OLD
 *   code keeps running (everything reversible until activation).
 * - activate()/rollback(): atomically repoint the `current` symlink and restart
 *   the panel's own Node project via the aaPanel API.
 */
export class AaPanelDeployAdapter implements DeployAdapter {
  readonly mode = 'aapanel' as const;

  constructor(private readonly releaseRoot: string | undefined) {}

  async preflight(): Promise<PreflightResult> {
    const issues: string[] = [];
    if (!this.releaseRoot) {
      issues.push('APP_RELEASE_ROOT is not set — self-update staging is disabled');
    } else {
      try {
        await mkdir(path.posix.join(this.releaseRoot.replace(/\\/g, '/'), 'releases'), {recursive: true});
      } catch (err) {
        issues.push(`Release root is not writable: ${err instanceof Error ? err.message : 'fs error'}`);
      }
    }
    if (!(await isTarAvailable())) {
      issues.push('`tar` is not available on this host');
    }
    const pgDumpAvailable = await isPgDumpAvailable();
    return {ok: issues.length === 0, issues, pgDumpAvailable};
  }

  async stage(input: StageInput): Promise<StageResult> {
    const steps: StageStep[] = [];
    const record = (name: string, ok: boolean, detail?: string): void => {
      steps.push({name, ok, detail});
    };
    let backupPath: string | null = null;
    const version = sanitizeVersion(input.release.version);

    try {
      const pre = await this.preflight();
      if (!pre.ok) {
        record('preflight', false, pre.issues.join('; '));
        return {ok: false, version, steps, message: pre.issues.join('; ')};
      }
      record('preflight', true);

      const root = this.releaseRoot!;
      const layout = releaseLayout(root, version);

      const assets = findBundleAssets(input.release, version);
      if (!assets) {
        const msg = `Release ${input.release.version} has no standalone bundle (${bundleAssetName(version)})`;
        record('locate-bundle', false, msg);
        return {ok: false, version, steps, message: msg};
      }
      record('locate-bundle', true, assets.bundle.name);

      // 1) Download the bundle to scratch space.
      const tarPath = path.posix.join(layout.tmpDir, bundleAssetName(version));
      await downloadToFile(assets.bundle.downloadUrl, tarPath, {token: input.githubToken});
      record('download', true, `${assets.bundle.size} bytes`);

      // 2) Verify integrity against the published checksum (when present).
      if (assets.checksum) {
        const expected = parseChecksumFile(await fetchText(assets.checksum.downloadUrl, input.githubToken));
        if (!expected) throw new Error('Published checksum file has no SHA-256 digest');
        await verifyFileChecksum(tarPath, expected);
        record('verify-checksum', true);
      } else {
        record('verify-checksum', true, 'no checksum published — integrity not verified');
      }

      // 3) Unpack atomically: extract to a temp dir, then swap it into place.
      const stagingDir = `${layout.releaseDir}.partial`;
      await rm(stagingDir, {recursive: true, force: true});
      await extractTarGz(tarPath, stagingDir);
      await rm(layout.releaseDir, {recursive: true, force: true});
      await mkdir(path.posix.dirname(layout.releaseDir), {recursive: true});
      await rename(stagingDir, layout.releaseDir);
      record('extract', true, layout.releaseDir);

      // 4) Back up the DB before any migration (rollback safety net).
      try {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const out = path.posix.join(layout.backupsDir, `pre-${version}-${stamp}.sql`);
        const res = await runDbBackup(input.databaseUrl, out, layout.backupsDir);
        backupPath = res.path;
        record('db-backup', true, `${res.bytes} bytes`);
      } catch (err) {
        if (err instanceof PgDumpNotAvailableError && input.allowBackupSkip) {
          record('db-backup', true, 'skipped — pg_dump not installed (override)');
        } else if (err instanceof PgDumpNotAvailableError) {
          const msg = 'pg_dump is not installed — install it or confirm staging without a backup';
          record('db-backup', false, msg);
          return {ok: false, version, steps, backupPath, message: msg};
        } else {
          throw err;
        }
      }

      // 5) Apply migrations (expand/contract — safe with the old code running).
      const migrateOut = await runMigrations(layout.releaseDir, input.databaseUrl);
      record('migrate', true, migrateOut.split('\n').slice(-1)[0] || undefined);

      // 6) Mark the release as staged (ready for activation in Phase 2b).
      await setStagedVersion(version);
      record('record-staged', true, version);

      // Best-effort scratch cleanup.
      await rm(tarPath, {force: true}).catch(() => undefined);

      return {ok: true, version, steps, backupPath};
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Staging failed';
      log.error({err, version}, 'aapanel stage failed');
      record('error', false, message);
      return {ok: false, version, steps, backupPath, message};
    }
  }

  async activate(input: ActivateInput): Promise<ActivateResult> {
    return this.swapAndRestart(input, 'activate');
  }

  async rollback(input: ActivateInput): Promise<ActivateResult> {
    return this.swapAndRestart(input, 'rollback');
  }

  /**
   * Shared activate/rollback: point `current` at the target release, commit the
   * DB state, then restart. The restart is LAST because it can kill this process
   * (aaPanel stops+starts our own Node project) — by then the symlink + DB are
   * already consistent, so the new process boots correctly.
   */
  private async swapAndRestart(input: ActivateInput, kind: 'activate' | 'rollback'): Promise<ActivateResult> {
    const steps: StageStep[] = [];
    const record = (name: string, ok: boolean, detail?: string): void => {
      steps.push({name, ok, detail});
    };
    const version = sanitizeVersion(input.version);
    let previousVersion: string | null = null;

    try {
      if (!this.releaseRoot) {
        const msg = 'APP_RELEASE_ROOT is not set';
        record('preflight', false, msg);
        return {ok: false, version, previousVersion, steps, message: msg};
      }
      const layout = releaseLayout(this.releaseRoot, version);

      // The target release must already be on disk (staged for activate; a prior
      // release for rollback) — never restart into a missing directory.
      if (!(await isDir(layout.releaseDir))) {
        const msg = `Release directory not found: ${layout.releaseDir} (was it staged?)`;
        record('locate-release', false, msg);
        return {ok: false, version, previousVersion, steps, message: msg};
      }
      record('locate-release', true, layout.releaseDir);

      // The version active right now becomes the rollback target going forward.
      previousVersion = (await currentTargetVersion(layout.currentLink)) ?? input.runningVersion ?? null;

      // Atomic swap: make a temp symlink → target, then rename it over `current`.
      await swapSymlink(layout.currentLink, layout.releaseDir);
      record('swap-current', true, `current → ${version}`);

      // Commit DB state BEFORE the restart so the rebooted process is consistent.
      await recordActivation(version, previousVersion);
      record('record', true, kind);

      // Restart LAST — may terminate this process; the caller's UI polls /api/health.
      await input.restart();
      record('restart', true, 'restart triggered via aaPanel');

      return {ok: true, version, previousVersion, steps};
    } catch (err) {
      const message = err instanceof Error ? err.message : `${kind} failed`;
      log.error({err, version, kind}, `aapanel ${kind} failed`);
      record('error', false, message);
      return {ok: false, version, previousVersion, steps, message};
    }
  }
}

/** True if the path exists and is a directory. */
async function isDir(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/** Version (last path segment) the `current` symlink points at, or null. */
async function currentTargetVersion(currentLink: string): Promise<string | null> {
  try {
    const target = await readlink(currentLink);
    const base = target.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? '';
    return base || null;
  } catch {
    return null;
  }
}

/** Atomically repoints a symlink: create a temp link, then rename over it. */
async function swapSymlink(linkPath: string, targetDir: string): Promise<void> {
  const tmp = `${linkPath}.tmp-${Date.now()}`;
  await rm(tmp, {force: true}).catch(() => undefined);
  await symlink(targetDir, tmp);
  await rename(tmp, linkPath);
}

async function isTarAvailable(): Promise<boolean> {
  try {
    await execFileAsync('tar', ['--version']);
    return true;
  } catch {
    return false;
  }
}

/** Fetches a small text resource (the checksum file) with optional auth. */
async function fetchText(url: string, token: string | null): Promise<string> {
  const headers: Record<string, string> = {'User-Agent': 'aapanel-manager', Accept: 'application/octet-stream'};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, {headers, redirect: 'follow'});
  if (!res.ok) throw new Error(`Failed to fetch checksum: HTTP ${res.status}`);
  return res.text();
}
