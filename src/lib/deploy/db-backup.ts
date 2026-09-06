import 'server-only';
import {execFile} from 'node:child_process';
import {mkdir, stat} from 'node:fs/promises';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);

/** Raised when `pg_dump` is not installed — the caller decides whether to block. */
export class PgDumpNotAvailableError extends Error {
  constructor() {
    super('pg_dump is not available on this host');
    this.name = 'PgDumpNotAvailableError';
  }
}

/**
 * Maps a PostgreSQL connection URL to libpq env vars. We pass credentials via
 * the child's environment (PGPASSWORD etc.) rather than argv so the password
 * never appears in the process table (`ps`). Pure.
 */
export function pgConnEnv(databaseUrl: string): Record<string, string> {
  const u = new URL(databaseUrl);
  const env: Record<string, string> = {
    PGHOST: u.hostname,
    PGPORT: u.port || '5432',
    PGDATABASE: decodeURIComponent(u.pathname.replace(/^\//, '')),
  };
  if (u.username) env.PGUSER = decodeURIComponent(u.username);
  if (u.password) env.PGPASSWORD = decodeURIComponent(u.password);
  const sslmode = u.searchParams.get('sslmode');
  if (sslmode) env.PGSSLMODE = sslmode;
  return env;
}

/** pg_dump args (DB selected via env). Plain SQL, restorable, no ownership noise. */
export function pgDumpArgs(outFile: string): string[] {
  return ['--no-owner', '--no-privileges', '--clean', '--if-exists', '-f', outFile];
}

/** True if `pg_dump` can be executed. */
export async function isPgDumpAvailable(): Promise<boolean> {
  try {
    await execFileAsync('pg_dump', ['--version']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Dumps the database to `outFile`. Throws {@link PgDumpNotAvailableError} when
 * pg_dump is missing so the caller can require explicit confirmation instead.
 */
export async function runDbBackup(
  databaseUrl: string,
  outFile: string,
  backupsDir: string,
): Promise<{path: string; bytes: number}> {
  await mkdir(backupsDir, {recursive: true});
  try {
    await execFileAsync('pg_dump', pgDumpArgs(outFile), {
      env: {...process.env, ...pgConnEnv(databaseUrl)},
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    if ((err as {code?: string}).code === 'ENOENT') throw new PgDumpNotAvailableError();
    throw new Error(`Database backup failed: ${err instanceof Error ? err.message : 'pg_dump error'}`);
  }
  const {size} = await stat(outFile);
  return {path: outFile, bytes: size};
}
