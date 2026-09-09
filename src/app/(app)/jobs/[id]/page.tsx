import Link from 'next/link';
import {formatTimestampOrNull} from '@/lib/format/datetime';
import type {Route} from 'next';
import {notFound, redirect} from 'next/navigation';
import {getTranslations} from 'next-intl/server';
import {requireUser} from '@/lib/auth/guards';
import {getJob} from '@/lib/jobs/query';
import {projectControlParams} from '@/lib/jobs/kinds';
import {JobDetail, type JobDetailView} from '@/components/jobs/job-detail';

/**
 * One line describing what the job does.
 *
 * Stored parameters are validated here rather than trusted: they were written by a
 * different build at a different time, and what comes out of the database is
 * external data (PROJECT_RULES.md §16).
 */
function summarize(kind: string, params: unknown): string {
  if (kind === 'project.control') {
    const parsed = projectControlParams.safeParse(params);
    if (parsed.success) return `${parsed.data.operation} · ${parsed.data.project}`;
  }
  return kind;
}

export default async function JobPage({params}: {params: Promise<{id: string}>}) {
  const user = await requireUser();
  if (user.role !== 'admin') redirect('/servers');

  const {id} = await params;
  const job = await getJob(id);
  if (!job) notFound();

  const t = await getTranslations('jobs');
  const view: JobDetailView = {
    id: job.id,
    kind: job.kind,
    status: job.status,
    stopOnError: job.stopOnError,
    cancelRequested: job.cancelRequested,
    createdByEmail: job.createdByEmail,
    createdAt: formatTimestampOrNull(job.createdAt) ?? '',
    startedAt: formatTimestampOrNull(job.startedAt),
    finishedAt: formatTimestampOrNull(job.finishedAt),
    summary: summarize(job.kind, job.params),
    total: job.total,
    succeeded: job.succeeded,
    failed: job.failed,
    skipped: job.skipped,
    items: job.items.map((i) => ({
      id: i.id,
      position: i.position,
      serverName: i.serverName,
      status: i.status,
      message: i.message,
    })),
  };

  return (
    <section className="space-y-4">
      <div>
        <Link href={'/jobs' as Route} className="text-sm text-muted-foreground underline underline-offset-2">
          {t('backToList')}
        </Link>
        <h1 className="mt-1 text-xl font-semibold">{t('detailTitle')}</h1>
      </div>
      <JobDetail job={view} />
    </section>
  );
}
