import 'server-only';
import {Client} from 'pg';
import {parseEnv} from '@/env';
import {prisma} from '@/lib/db/prisma';
import {refreshServerStatus} from '@/lib/servers/status';
import {runPollCycle} from '@/worker/poll-cycle';
import {startJobRunner, stopJobRunner} from '@/lib/jobs/runner';
import {errInfo} from '@/lib/safe-error';
import {log} from '@/log';

// A single app-wide Postgres advisory lock (scoped to the database). Only the
// process holding it runs the poll loop, so any number of app replicas — and an
// optional dedicated worker — can run while exactly one polls. If the leader
// dies, its session ends, the lock is released, and another process takes over.
const POLLER_LOCK_KEY = 911_019;
const LEADER_RETRY_MS = 10_000;

type Globals = typeof globalThis & {__serverPoller?: ServerPoller};

export interface StartPollerOptions {
  /** Dedicated worker process: exit the process on SIGINT/SIGTERM after cleanup.
   *  The embedded (web) poller leaves process lifecycle to the HTTP server. */
  exitOnShutdown?: boolean;
}

class ServerPoller {
  private started = false;
  private stopped = false;
  private isLeader = false;
  private connecting = false;
  private lockClient?: Client;
  private acquireTimer?: ReturnType<typeof setTimeout>;
  private tickTimer?: ReturnType<typeof setTimeout>;
  private inFlight: Promise<void> = Promise.resolve();
  private intervalMs = 60_000;
  private concurrency = 16;
  private exitOnShutdown = false;

  start(opts: StartPollerOptions): void {
    if (this.started) return;
    this.started = true;
    const env = parseEnv();
    this.intervalMs = env.POLL_INTERVAL_MS;
    this.concurrency = env.WORKER_CONCURRENCY;
    this.exitOnShutdown = opts.exitOnShutdown ?? false;
    this.registerSignals();
    log.info({interval: this.intervalMs, concurrency: this.concurrency}, 'poller: starting (leader election)');
    void this.tryBecomeLeader();
  }

  private scheduleAcquire(): void {
    if (this.acquireTimer || this.stopped || this.isLeader || this.connecting) return;
    this.acquireTimer = setTimeout(() => {
      this.acquireTimer = undefined;
      void this.tryBecomeLeader();
    }, LEADER_RETRY_MS);
  }

  private async tryBecomeLeader(): Promise<void> {
    if (this.stopped || this.isLeader || this.connecting) return;
    this.connecting = true;
    const client = new Client({connectionString: process.env.DATABASE_URL});
    // Attach handlers before connect so a connection error never becomes an
    // unhandled 'error' event (which would crash the process).
    client.on('error', (err) => {
      log.error({err: errInfo(err)}, 'poller: lock connection error');
      this.loseLeadership();
    });
    client.on('end', () => this.loseLeadership());
    try {
      await client.connect();
      const res = await client.query<{locked: boolean}>(
        'SELECT pg_try_advisory_lock($1::bigint) AS locked',
        [POLLER_LOCK_KEY],
      );
      if (res.rows[0]?.locked === true) {
        this.lockClient = client;
        this.isLeader = true;
        this.connecting = false;
        log.info('poller: leadership acquired; polling active');
        // The leader also drains the job queue (ADR-0005): one election, one
        // process doing background work, no second advisory lock.
        startJobRunner();
        this.inFlight = this.tick();
        return;
      }
      // Lock is held by another process — stay a follower and retry later.
      this.connecting = false;
      await client.end().catch(() => undefined);
      this.scheduleAcquire();
    } catch (err) {
      this.connecting = false;
      log.error({err: errInfo(err)}, 'poller: leadership acquisition failed; retrying');
      await client.end().catch(() => undefined);
      this.scheduleAcquire();
    }
  }

  private loseLeadership(): void {
    const wasLeader = this.isLeader;
    this.isLeader = false;
    void stopJobRunner();
    if (this.tickTimer) {
      clearTimeout(this.tickTimer);
      this.tickTimer = undefined;
    }
    const client = this.lockClient;
    this.lockClient = undefined;
    if (client) client.end().catch(() => undefined);
    if (wasLeader) log.warn('poller: leadership lost; will try to re-acquire');
    this.scheduleAcquire();
  }

  private async tick(): Promise<void> {
    if (this.stopped || !this.isLeader) return;
    try {
      const servers = await prisma.server.findMany({select: {id: true}});
      const res = await runPollCycle(
        servers.map((s) => s.id),
        this.concurrency,
        async (id) => {
          const r = await refreshServerStatus(id);
          return {ok: r.ok, online: r.online};
        },
      );
      log.info(res, 'poller: cycle complete');
    } catch (err) {
      log.error({err: errInfo(err)}, 'poller: cycle failed');
    } finally {
      if (!this.stopped && this.isLeader) {
        this.tickTimer = setTimeout(() => {
          this.inFlight = this.tick();
        }, this.intervalMs);
      }
    }
  }

  private registerSignals(): void {
    const shutdown = async (sig: string): Promise<void> => {
      if (this.stopped) return;
      this.stopped = true;
      log.info({sig}, 'poller: shutting down');
      if (this.acquireTimer) clearTimeout(this.acquireTimer);
      if (this.tickTimer) clearTimeout(this.tickTimer);
      await this.inFlight.catch(() => undefined); // let an in-flight cycle finish
      const client = this.lockClient;
      this.lockClient = undefined;
      if (client) {
        await client.query('SELECT pg_advisory_unlock($1::bigint)', [POLLER_LOCK_KEY]).catch(() => undefined);
        await client.end().catch(() => undefined);
      }
      if (this.exitOnShutdown) {
        await prisma.$disconnect().catch(() => undefined);
        process.exit(0);
      }
    };
    process.once('SIGINT', () => void shutdown('SIGINT'));
    process.once('SIGTERM', () => void shutdown('SIGTERM'));
  }
}

/** Start the background poll loop in this process. Idempotent: a process-wide
 *  singleton ensures a single loop even if called more than once (e.g. dev HMR).
 *  A Postgres advisory lock guarantees exactly one active poller across all
 *  processes, so this is safe to run in every app replica. */
export function startServerPoller(opts: StartPollerOptions = {}): void {
  const g = globalThis as Globals;
  g.__serverPoller ??= new ServerPoller();
  g.__serverPoller.start(opts);
}
