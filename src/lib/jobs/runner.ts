import 'server-only';
import type {AaPanelClient} from '@/lib/aapanel';
import {createClientForServer} from '@/lib/aapanel';
import {prisma} from '@/lib/db/prisma';
import {parseEnv} from '@/env';
import {errInfo} from '@/lib/safe-error';
import {log} from '@/log';
import {reapInterruptedJobs, runNextJob} from './queue';

/**
 * Drains the job queue in the leader process (ADR-0005).
 *
 * Leadership is not decided here: the poller already elects exactly one process
 * through a Postgres advisory lock, and it starts and stops this runner along with
 * itself. Electing separately would mean a second lock and a copy of the same
 * machinery for no gain.
 */

/** Idle poll of the queue. Short enough that a job starts promptly, cheap enough
 *  to run forever: one indexed lookup against an almost always empty set. */
const IDLE_INTERVAL_MS = 5_000;

let running = false;
let stopped = true;
let timer: ReturnType<typeof setTimeout> | undefined;
let inFlight: Promise<void> = Promise.resolve();

/** Builds a panel client for one server, decrypting its key server-side. */
async function clientForServer(serverId: string): Promise<AaPanelClient> {
  const server = await prisma.server.findUniqueOrThrow({
    where: {id: serverId},
    select: {id: true, baseUrl: true, apiSkEnc: true, tlsMode: true, tlsPinSha256: true},
  });
  return createClientForServer(server);
}

async function drain(): Promise<void> {
  if (stopped) return;
  try {
    // Keep taking jobs while there are any: a queue that woke up should empty,
    // not release one job per interval.
    let ranSomething = true;
    while (ranSomething && !stopped) {
      ranSomething = await runNextJob({
        clientFor: clientForServer,
        concurrency: parseEnv().WORKER_CONCURRENCY,
      });
    }
  } catch (err) {
    log.error({err: errInfo(err)}, 'jobs: run failed');
  } finally {
    if (!stopped) timer = setTimeout(() => void (inFlight = drain()), IDLE_INTERVAL_MS);
  }
}

/** Starts draining. Called when this process becomes the leader. */
export function startJobRunner(): void {
  if (running) return;
  running = true;
  stopped = false;
  log.info('jobs: runner started');
  // A job left mid-flight by a dead process is nobody's work but still claims to
  // be in progress. Clear that before taking anything new.
  inFlight = reapInterruptedJobs()
    .catch((err: unknown) => {
      log.error({err: errInfo(err)}, 'jobs: reaping interrupted jobs failed');
      return 0;
    })
    .then(() => drain());
}

/** Stops draining. Called when leadership is lost or the process shuts down. */
export async function stopJobRunner(): Promise<void> {
  if (!running) return;
  stopped = true;
  running = false;
  if (timer) {
    clearTimeout(timer);
    timer = undefined;
  }
  // A server already being worked on is never abandoned half-done.
  await inFlight.catch(() => undefined);
  log.info('jobs: runner stopped');
}
