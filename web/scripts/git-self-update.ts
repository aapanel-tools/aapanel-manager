// Detached git self-update runner (git deployment mode).
//
// Launched by gitUpdateAction/gitRollbackAction via launchGitUpdate() as a
// DETACHED process so it survives the panel restart it triggers at the end.
// Run with tsx + tsconfig.worker.json (so `@/` paths resolve and `server-only`
// is a no-op outside Next), cwd = the web app dir:
//
//   tsx --env-file-if-exists=.env --tsconfig tsconfig.worker.json \
//       scripts/git-self-update.ts <update|rollback> <X.Y.Z>
//
// Pipeline: backup DB → git fetch → checkout vX.Y.Z → pnpm install →
//           prisma migrate deploy → pnpm build → record history → restart.
// All output is appended to <repoRoot>/.update.log; the single-flight lock at
// <repoRoot>/.update.lock is released in finally. On any failure BEFORE the
// restart, the old version keeps running (we never restart a broken build).

import {execFile} from 'node:child_process';
import {appendFileSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {gitRepoRoot, updatePaths, releaseUpdateLock, writeUpdateStatus} from '@/lib/deploy/git';
import {initialStatus, advanceTo, markDone, markFailed, type UpdateStep} from '@/lib/deploy/update-status';
import {runDbBackup, PgDumpNotAvailableError} from '@/lib/deploy/db-backup';
import {runMigrations} from '@/lib/deploy/migrate';
import {ensureSelfTlsPin, getSelfRestartConfig, recordActivation} from '@/lib/version/settings';
import {getCurrentVersion} from '@/lib/version/current';
import {createClientForServer} from '@/lib/aapanel';
import {prisma} from '@/lib/db/prisma';

const execFileAsync = promisify(execFile);
const BIG = 64 * 1024 * 1024;

// Package manager is configurable so the button works with whatever is installed
// on the server. Default npm — aaPanel servers ship npm with node but usually
// NOT pnpm/corepack (verified on a live panel). APP_PKG_MANAGER=pnpm|yarn opts
// out; APP_PKG_BIN overrides the binary name/path.
const PM = ((): 'npm' | 'pnpm' | 'yarn' => {
  const v = (process.env.APP_PKG_MANAGER || 'npm').toLowerCase();
  return v === 'pnpm' || v === 'yarn' ? v : 'npm';
})();
const PM_BIN = process.env.APP_PKG_BIN || PM;
// npm/yarn install from package.json; pnpm honours its committed lockfile.
const INSTALL_ARGS = PM === 'pnpm' ? ['install', '--frozen-lockfile'] : ['install'];

async function main(): Promise<void> {
  const kind = process.argv[2] === 'rollback' ? 'rollback' : 'update';
  const target = (process.argv[3] || '').trim().replace(/^v/, '');
  const webDir = process.cwd();

  // Guarantee the node bin dir is on PATH for EVERY child we spawn. npm, prisma
  // and next are node scripts with a `#!/usr/bin/env node` shebang — without node
  // on PATH they die with "node: not found". process.execPath is the node running
  // us (on aaPanel: /www/server/nodejs/<v>/bin/node); npm lives right beside it.
  const nodeDir = path.dirname(process.execPath);
  process.env.PATH = `${nodeDir}${path.delimiter}${process.env.PATH ?? ''}`;

  const repoRoot = await gitRepoRoot(webDir);
  if (!repoRoot) {
    // Cannot resolve paths/lock without the repo root — fail loudly to stderr.
    console.error('git-self-update: not a git checkout');
    process.exitCode = 1;
    return;
  }
  const paths = updatePaths(repoRoot);
  const log = (msg: string) => {
    appendFileSync(paths.log, `[${new Date().toISOString()}] ${msg}\n`);
  };
  const run = async (file: string, args: string[], cwd: string) => {
    const {stdout, stderr} = await execFileAsync(file, args, {cwd, env: process.env, maxBuffer: BIG});
    const out = `${stdout}${stderr}`.trim();
    if (out) log(out);
  };

  if (!target) {
    log('FAILED: no target version');
    releaseUpdateLock(paths.lock);
    process.exitCode = 1;
    return;
  }

  // Structured progress the UI polls: download → install → migrate → build → restart.
  let status = initialStatus(kind, target, Date.now());
  writeUpdateStatus(paths.status, status);
  const setStep = (step: UpdateStep) => {
    status = advanceTo(status, step, Date.now());
    writeUpdateStatus(paths.status, status);
  };

  try {
    log(`=== ${kind} → v${target} (start) ===`);
    log(`package manager: ${PM} (${PM_BIN})`);

    const self = await getSelfRestartConfig();
    if (!self) throw new Error('self-restart is not configured');
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL is not set');

    const previous = getCurrentVersion().version;
    log(`current version: ${previous}`);

    // 1) DOWNLOAD: DB backup (best-effort) + fetch + checkout the target tag.
    setStep('download');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    try {
      const backup = await runDbBackup(
        databaseUrl,
        path.join(paths.backupsDir, `pre-${target}-${stamp}.sql`),
        paths.backupsDir,
      );
      log(`db backup: ${backup.path} (${backup.bytes} bytes)`);
    } catch (err) {
      if (err instanceof PgDumpNotAvailableError) log('db backup SKIPPED: pg_dump not available');
      else throw err;
    }
    log('git fetch --tags');
    await run('git', ['-C', repoRoot, 'fetch', '--tags', '--force'], repoRoot);
    log(`git checkout v${target}`);
    await run('git', ['-C', repoRoot, 'checkout', '-f', `v${target}`], repoRoot);

    // 2) INSTALL: dependencies + generate the Prisma client (the build needs it).
    setStep('install');
    log(`${PM_BIN} ${INSTALL_ARGS.join(' ')}`);
    await run(PM_BIN, INSTALL_ARGS, webDir);
    log(`${PM_BIN} run db:generate`);
    await run(PM_BIN, ['run', 'db:generate'], webDir);

    // 3) MIGRATE: apply pending migrations (expand/contract — old code still runs).
    setStep('migrate');
    log('prisma migrate deploy');
    log(await runMigrations(webDir, databaseUrl));

    // 4) BUILD: compile the new version (on failure the OLD version keeps running).
    setStep('build');
    log(`${PM_BIN} run build`);
    await run(PM_BIN, ['run', 'build'], webDir);

    // Record history (previous version becomes the rollback target) before restart.
    await recordActivation(target, previous);
    log('history recorded');

    // 5) RESTART: bounce the panel's own Node project via the aaPanel API (LAST).
    setStep('restart');
    log(`restart project "${self.project}" via aaPanel`);
    const selfClient = await createClientForServer({
      baseUrl: self.baseUrl,
      apiSkEnc: self.apiSkEnc,
      tlsMode: self.tlsMode,
      tlsPinSha256: await ensureSelfTlsPin(self),
    });
    await selfClient.batchOperation([self.project], 'restart');

    status = markDone(status, Date.now());
    writeUpdateStatus(paths.status, status);
    log(`=== ${kind} → v${target} (done) ===`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`FAILED: ${msg}`);
    try {
      status = markFailed(status, msg, Date.now());
      writeUpdateStatus(paths.status, status);
    } catch {
      /* status file is best-effort */
    }
    process.exitCode = 1;
  } finally {
    releaseUpdateLock(paths.lock);
    await prisma.$disconnect().catch(() => undefined);
  }
}

void main();
