import 'server-only';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);

/** Path to the Prisma CLI bundled inside a release directory. Pure. */
export function migrateBinPath(releaseDir: string): string {
  return path.posix.join(releaseDir.replace(/\\/g, '/'), 'node_modules', '.bin', 'prisma');
}

/**
 * Applies pending migrations from a staged release against the live database
 * (`prisma migrate deploy`). Run during staging while the OLD code is still
 * serving — migrations MUST be backward-compatible (expand/contract) so the
 * running version keeps working until activation.
 *
 * DATABASE_URL is passed explicitly so it does not depend on a .env inside the
 * release. Returns the CLI output for the audit/log trail.
 */
export async function runMigrations(releaseDir: string, databaseUrl: string): Promise<string> {
  try {
    const {stdout, stderr} = await execFileAsync(migrateBinPath(releaseDir), ['migrate', 'deploy'], {
      cwd: releaseDir,
      env: {...process.env, DATABASE_URL: databaseUrl},
      maxBuffer: 16 * 1024 * 1024,
    });
    return `${stdout}${stderr}`.trim();
  } catch (err) {
    const e = err as {stderr?: string; stdout?: string; message?: string};
    const detail = (e.stderr || e.stdout || e.message || 'migrate deploy failed').trim();
    throw new Error(`Migrations failed: ${detail}`);
  }
}
