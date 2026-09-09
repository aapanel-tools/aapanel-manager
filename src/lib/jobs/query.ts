import 'server-only';
import type {Prisma} from '@prisma/client';
import {prisma} from '@/lib/db/prisma';
import type {JobListParams} from '@/lib/validation/job';

/** A job as the list shows it: what it was, how it ended, how far it got. */
export interface JobRow {
  id: string;
  kind: string;
  status: string;
  createdAt: Date;
  finishedAt: Date | null;
  createdByEmail: string | null;
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
}

export interface ListJobsResult {
  rows: JobRow[];
  total: number;
}

/** One server's outcome inside a job. Survives that server being deleted. */
export interface JobItemRow {
  id: string;
  position: number;
  serverId: string | null;
  serverName: string;
  status: string;
  message: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export interface JobDetail extends JobRow {
  params: unknown;
  stopOnError: boolean;
  cancelRequested: boolean;
  startedAt: Date | null;
  items: JobItemRow[];
}

function tally(items: Array<{status: string}>): Pick<JobRow, 'total' | 'succeeded' | 'failed' | 'skipped'> {
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  for (const i of items) {
    if (i.status === 'succeeded') succeeded += 1;
    else if (i.status === 'failed') failed += 1;
    else if (i.status === 'skipped') skipped += 1;
  }
  return {total: items.length, succeeded, failed, skipped};
}

export async function listJobs(p: JobListParams): Promise<ListJobsResult> {
  const where: Prisma.JobWhereInput =
    p.status === 'all'
      ? {}
      : p.status === 'active'
        ? {status: {in: ['pending', 'running']}}
        : {status: p.status};
  const [records, total] = await Promise.all([
    prisma.job.findMany({
      where,
      orderBy: {createdAt: 'desc'},
      skip: (p.page - 1) * p.pageSize,
      take: p.pageSize,
      select: {
        id: true,
        kind: true,
        status: true,
        createdAt: true,
        finishedAt: true,
        createdBy: {select: {email: true}},
        items: {select: {status: true}},
      },
    }),
    prisma.job.count({where}),
  ]);

  const rows: JobRow[] = records.map((r) => ({
    id: r.id,
    kind: r.kind,
    status: r.status,
    createdAt: r.createdAt,
    finishedAt: r.finishedAt,
    createdByEmail: r.createdBy?.email ?? null,
    ...tally(r.items),
  }));
  return {rows, total};
}

export async function getJob(id: string): Promise<JobDetail | null> {
  const job = await prisma.job.findUnique({
    where: {id},
    select: {
      id: true,
      kind: true,
      params: true,
      status: true,
      stopOnError: true,
      cancelRequestedAt: true,
      createdAt: true,
      startedAt: true,
      finishedAt: true,
      createdBy: {select: {email: true}},
      items: {
        orderBy: {position: 'asc'},
        select: {
          id: true,
          position: true,
          serverId: true,
          serverName: true,
          status: true,
          message: true,
          startedAt: true,
          finishedAt: true,
        },
      },
    },
  });
  if (!job) return null;

  return {
    id: job.id,
    kind: job.kind,
    params: job.params,
    status: job.status,
    stopOnError: job.stopOnError,
    cancelRequested: job.cancelRequestedAt !== null,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    createdByEmail: job.createdBy?.email ?? null,
    items: job.items,
    ...tally(job.items),
  };
}
