'use client';
import {useEffect, useState, useTransition} from 'react';
import {useRouter} from 'next/navigation';
import {useTranslations} from 'next-intl';
import {toast} from 'sonner';
import {cancelJobAction} from '@/server/actions/jobs';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

/** How often a running job re-reads itself. Jobs are minutes long, not seconds. */
const REFRESH_MS = 3_000;

export interface JobDetailView {
  id: string;
  kind: string;
  status: string;
  stopOnError: boolean;
  cancelRequested: boolean;
  createdByEmail: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  summary: string;
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  items: Array<{
    id: string;
    position: number;
    serverName: string;
    status: string;
    message: string | null;
  }>;
}

const ACTIVE = new Set(['pending', 'running']);

function tone(status: string): 'secondary' | 'destructive' | 'outline' {
  if (status === 'succeeded') return 'secondary';
  if (status === 'failed') return 'destructive';
  return 'outline';
}

export function JobDetail({job}: {job: JobDetailView}) {
  const t = useTranslations('jobs');
  const router = useRouter();
  const [pending, start] = useTransition();
  const [cancelling, setCancelling] = useState(false);
  const active = ACTIVE.has(job.status);

  // Poll while the job is alive, and stop the moment it is not — a finished job
  // never changes again, so refreshing it is pure waste. Paused on a hidden tab
  // for the same reason the server overview pauses.
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      if (!document.hidden) router.refresh();
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [active, router]);

  function cancel(): void {
    setCancelling(true);
    start(async () => {
      const res = await cancelJobAction(job.id);
      if (res.ok) toast.success(t('cancelRequested'));
      else toast.error(t(`error.${res.message}`));
      setCancelling(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={tone(job.status)}>{t(`status.${job.status}`)}</Badge>
        <span className="text-sm text-muted-foreground">{job.summary}</span>
        <span className="text-sm text-muted-foreground">
          {t('tally', {
            succeeded: job.succeeded,
            failed: job.failed,
            skipped: job.skipped,
            total: job.total,
          })}
        </span>
        {active ? (
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            disabled={pending || cancelling || job.cancelRequested}
            onClick={cancel}
          >
            {job.cancelRequested ? t('cancelPending') : t('cancel')}
          </Button>
        ) : null}
      </div>

      {job.cancelRequested && active ? (
        // Stopping means "start no more servers"; the one in flight is left to finish.
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          {t('cancelNote')}
        </p>
      ) : null}

      <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-muted-foreground">{t('createdBy')}</dt>
          <dd>{job.createdByEmail ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t('createdAt')}</dt>
          <dd className="font-mono text-xs">{job.createdAt}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t('finishedAt')}</dt>
          <dd className="font-mono text-xs">{job.finishedAt ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t('stopOnError')}</dt>
          <dd>{job.stopOnError ? t('yes') : t('no')}</dd>
        </div>
      </dl>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[3rem]">#</TableHead>
              <TableHead>{t('server')}</TableHead>
              <TableHead className="w-[8rem]">{t('result')}</TableHead>
              <TableHead>{t('message')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {job.items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="text-muted-foreground">{item.position + 1}</TableCell>
                <TableCell>
                  {item.serverName}
                  {item.position === 0 ? (
                    <span className="ml-2 text-xs text-muted-foreground">{t('canaryTag')}</span>
                  ) : null}
                </TableCell>
                <TableCell>
                  <Badge variant={tone(item.status)}>{t(`itemStatus.${item.status}`)}</Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{item.message ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
