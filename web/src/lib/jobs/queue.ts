import 'server-only';
import type {AaPanelClient} from '@/lib/aapanel';
import {recordAudit} from '@/lib/audit';
import {prisma} from '@/lib/db/prisma';
import {mapLimit} from '@/lib/utils/concurrency';
import {jobKind} from './kinds';
import {log} from '@/log';

/**
 * The bulk-job queue (ADR-0005).
 *
 * A job lives in the database because it outlasts the request that created it: the
 * tab may close and the process may restart, but "where did it get to" must still
 * have an answer. Exactly one process runs jobs — the same leader that runs the
 * poller, elected by a Postgres advisory lock.
 */

/** Ceiling on servers per job. Not a technical limit — a deliberate speed bump. */
export const DEFAULT_MAX_SERVERS_PER_JOB = 50;

export interface CreateJobInput {
  kind: string;
  params: unknown;
  /** Servers in execution order; the first one is the canary. */
  serverIds: string[];
  createdById: string;
  stopOnError?: boolean;
  maxServers?: number;
}

export class JobRejected extends Error {
  constructor(readonly reason: 'unknown-kind' | 'no-servers' | 'too-many-servers' | 'missing-servers') {
    super(reason);
    this.name = 'JobRejected';
  }
}

/**
 * Records a job and its per-server items.
 *
 * Server names are copied in: the report has to survive the server being deleted
 * from the app afterwards. Nothing is executed here — the leader picks it up.
 */
export async function createJob(input: CreateJobInput): Promise<{id: string}> {
  const kind = jobKind(input.kind);
  if (!kind) throw new JobRejected('unknown-kind');
  const params = kind.parse(input.params);

  const ids = [...new Set(input.serverIds)];
  if (ids.length === 0) throw new JobRejected('no-servers');
  const ceiling = input.maxServers ?? DEFAULT_MAX_SERVERS_PER_JOB;
  if (ids.length > ceiling) throw new JobRejected('too-many-servers');

  const servers = await prisma.server.findMany({
    where: {id: {in: ids}},
    select: {id: true, name: true},
  });
  // A server that vanished between choosing and confirming must not silently drop
  // out of a list the operator already approved.
  if (servers.length !== ids.length) throw new JobRejected('missing-servers');
  const nameById = new Map(servers.map((s) => [s.id, s.name]));

  const job = await prisma.job.create({
    data: {
      kind: kind.kind,
      params: params as object,
      createdById: input.createdById,
      stopOnError: input.stopOnError ?? true,
      items: {
        create: ids.map((serverId, position) => ({
          serverId,
          serverName: nameById.get(serverId) ?? serverId,
          position,
        })),
      },
    },
    select: {id: true},
  });
  return job;
}

/** Asks a job to stop. Returns false when it had already finished. */
export async function requestCancel(jobId: string): Promise<boolean> {
  const {count} = await prisma.job.updateMany({
    where: {id: jobId, status: {in: ['pending', 'running']}, cancelRequestedAt: null},
    data: {cancelRequestedAt: new Date()},
  });
  return count > 0;
}

export interface JobRunnerDeps {
  /** Builds a panel client for a server. Injected so tests need no network. */
  clientFor(serverId: string): Promise<AaPanelClient>;
  /** How many servers to work on at once, after the canary. */
  concurrency: number;
}

/**
 * Claims the oldest pending job and runs it. Returns false when there was nothing.
 *
 * The claim is a conditional update: if it changed exactly one row, the job is ours.
 * Two leaders overlapping during a handover therefore cannot run the same job twice.
 */
export async function runNextJob(deps: JobRunnerDeps): Promise<boolean> {
  const candidate = await prisma.job.findFirst({
    where: {status: 'pending'},
    orderBy: {createdAt: 'asc'},
    select: {id: true},
  });
  if (!candidate) return false;

  const claimed = await prisma.job.updateMany({
    where: {id: candidate.id, status: 'pending'},
    data: {status: 'running', startedAt: new Date()},
  });
  if (claimed.count !== 1) return false;

  await runClaimedJob(candidate.id, deps);
  return true;
}

/** True when an operator has asked this job to stop. Re-read before each server. */
async function cancelRequested(jobId: string): Promise<boolean> {
  const row = await prisma.job.findUnique({
    where: {id: jobId},
    select: {cancelRequestedAt: true},
  });
  return Boolean(row?.cancelRequestedAt);
}

async function runClaimedJob(jobId: string, deps: JobRunnerDeps): Promise<void> {
  const job = await prisma.job.findUniqueOrThrow({
    where: {id: jobId},
    include: {items: {orderBy: {position: 'asc'}}},
  });

  const kind = jobKind(job.kind);
  if (!kind) {
    // A job naming a kind this build no longer has cannot be run and must not hang.
    await finish(jobId, 'failed');
    await prisma.jobItem.updateMany({
      where: {jobId, status: 'pending'},
      data: {status: 'skipped', message: `Unknown job kind "${job.kind}"`},
    });
    log.error({jobId, kind: job.kind}, 'job refers to an unknown kind');
    return;
  }

  let halted = false;

  const runItem = async (item: (typeof job.items)[number]): Promise<boolean> => {
    if (halted || (await cancelRequested(jobId))) return false;

    await prisma.jobItem.update({
      where: {id: item.id},
      data: {status: 'running', startedAt: new Date()},
    });
    try {
      if (!item.serverId) throw new Error('Server was removed before this step ran');
      const client = await deps.clientFor(item.serverId);
      const message = await kind.runOn({client, serverName: item.serverName}, job.params);
      await prisma.jobItem.update({
        where: {id: item.id},
        data: {status: 'succeeded', message: message.slice(0, 500), finishedAt: new Date()},
      });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.jobItem.update({
        where: {id: item.id},
        data: {status: 'failed', message: message.slice(0, 500), finishedAt: new Date()},
      });
      if (job.stopOnError) halted = true;
      return false;
    }
  };

  // The canary goes first, alone: a mistake in the parameters reaches one machine
  // instead of fifty, and the run stops before touching the rest.
  const [canary, ...rest] = job.items;
  if (canary) await runItem(canary);
  if (!halted && rest.length > 0) {
    await mapLimit(rest, deps.concurrency, (item) => runItem(item));
  }

  // Whatever never started says so plainly: not a success, not a failure.
  const cancelled = await cancelRequested(jobId);
  await prisma.jobItem.updateMany({
    where: {jobId, status: 'pending'},
    data: {
      status: 'skipped',
      message: cancelled ? 'Cancelled before this server' : 'Run stopped before this server',
      finishedAt: new Date(),
    },
  });

  const failures = await prisma.jobItem.count({where: {jobId, status: 'failed'}});
  const status = cancelled ? 'cancelled' : failures > 0 ? 'failed' : 'succeeded';
  await finish(jobId, status);

  // One journal line per job, not per server: the per-server detail lives in the
  // job's own report, and flooding the journal would bury everything else (§16).
  const succeeded = job.items.length - failures;
  await recordAudit({
    userId: job.createdById ?? undefined,
    action: `job.${job.kind}`,
    target: `${succeeded}/${job.items.length} servers`,
    result: status === 'succeeded' ? 'ok' : status,
  });
}

async function finish(jobId: string, status: 'succeeded' | 'failed' | 'cancelled'): Promise<void> {
  await prisma.job.update({where: {id: jobId}, data: {status, finishedAt: new Date()}});
}

/**
 * Clears jobs left mid-flight by a process that died.
 *
 * Called when a leader starts. A server whose step was interrupted is reported as
 * failed with an explicit note: we genuinely do not know what happened on it, and
 * claiming success or silence would both be lies.
 */
export async function reapInterruptedJobs(): Promise<number> {
  const stuck = await prisma.job.findMany({where: {status: 'running'}, select: {id: true}});
  if (stuck.length === 0) return 0;
  const ids = stuck.map((j) => j.id);

  await prisma.jobItem.updateMany({
    where: {jobId: {in: ids}, status: 'running'},
    data: {
      status: 'failed',
      message: 'Interrupted: the process stopped while this server was being worked on',
      finishedAt: new Date(),
    },
  });
  await prisma.jobItem.updateMany({
    where: {jobId: {in: ids}, status: 'pending'},
    data: {status: 'skipped', message: 'Interrupted before this server', finishedAt: new Date()},
  });
  await prisma.job.updateMany({
    where: {id: {in: ids}},
    data: {status: 'failed', finishedAt: new Date()},
  });
  log.warn({count: ids.length}, 'reaped jobs interrupted by a restart');
  return ids.length;
}
