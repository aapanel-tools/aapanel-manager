import {config} from 'dotenv';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Fails the whole run once, with a readable reason, when the test database is
 * not there (Д-8).
 *
 * A third of this suite talks to a real PostgreSQL. Without this check a machine
 * with no database produces 49 failures across 12 files, every one of them a
 * connection error buried under a stack trace — and the reader's first guess is
 * that they broke something. One line up front costs ~100 ms and answers the
 * question the 49 failures never did.
 *
 * It refuses rather than skipping on purpose: a run that reports success while a
 * third of it never executed is worse than a run that stops. Skipping would make
 * "352 passed" mean "303 passed and 49 unknown", and that difference matters on
 * the day it is a real regression rather than a stopped cluster.
 *
 * `SKIP_DB_CHECK=1` bypasses it for a deliberate run of the database-free tests.
 * An explicit opt-out is not the same as a silent skip: it leaves a trace in the
 * command that produced the result.
 */
export default async function setup(): Promise<void> {
  if (process.env.SKIP_DB_CHECK === '1') return;

  config({path: path.resolve(__dirname, '../.env')});
  const url = process.env.DATABASE_URL;
  if (!url) throw stopRun('DATABASE_URL is not set', '(no DATABASE_URL)');

  // A real connection, not a port probe: a listening socket proves nothing about
  // credentials or whether the database exists, and both fail the same 12 files.
  const client = new Client({connectionString: url, connectionTimeoutMillis: 5_000});
  try {
    await client.connect();
    await client.query('SELECT 1');
  } catch (err) {
    throw stopRun(err instanceof Error ? err.message : 'connection failed', target(url));
  } finally {
    await client.end().catch(() => undefined);
  }
}

/**
 * The refusal, with its stack replaced by the message itself.
 *
 * The frames here point at this file and at vitest's internals — they say
 * nothing about why the database is missing, and printing twenty of them would
 * rebuild the wall of noise this check exists to remove.
 */
function stopRun(reason: string, where: string): Error {
  const err = new Error(explain(reason, where));
  err.stack = err.message;
  return err;
}

/** host:port from the connection string, for the message. Never throws or leaks credentials. */
function target(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || '5432'}${u.pathname}`;
  } catch {
    return '(unparseable DATABASE_URL)';
  }
}

function explain(reason: string, where: string): string {
  return [
    '',
    `Test database is not reachable at ${where}`,
    `  ${reason}`,
    '',
    '  12 test files run against a real PostgreSQL. They are not mocked on purpose:',
    '  they cover migrations, advisory locks and transactions, which a mock cannot.',
    '',
    '  Start a database and point DATABASE_URL (.env) at it, then re-run:',
    '    docker compose up -d postgres',
    '',
    '  To run only the tests that need no database:',
    '    SKIP_DB_CHECK=1 pnpm test',
    '',
  ].join('\n');
}
