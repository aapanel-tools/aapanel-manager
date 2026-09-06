import Link from 'next/link';
import type {Route} from 'next';
import {redirect} from 'next/navigation';
import {getTranslations} from 'next-intl/server';
import {requireUser} from '@/lib/auth/guards';
import {listJobs} from '@/lib/jobs/query';
import {jobListParamsSchema} from '@/lib/validation/job';
import {Badge} from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const fmt = (d: Date): string => d.toISOString().slice(0, 19).replace('T', ' ');

function tone(status: string): 'secondary' | 'destructive' | 'outline' {
  if (status === 'succeeded') return 'secondary';
  if (status === 'failed') return 'destructive';
  return 'outline';
}

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  // A job says who did what to which customer machines: administrative information.
  if (user.role !== 'admin') redirect('/servers');

  const params = jobListParamsSchema.parse(await searchParams);
  const {rows, total} = await listJobs(params);
  const t = await getTranslations('jobs');

  const lastShown = Math.min(params.page * params.pageSize, total);
  const hasPrev = params.page > 1;
  const hasNext = lastShown < total;
  const pageHref = (page: number): Route =>
    (page > 1 ? `/jobs?page=${page}` : '/jobs') as Route;

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">{t('listTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('listSubtitle')}</p>
      </div>

      {rows.length === 0 ? (
        <p className="text-muted-foreground">{t('empty')}</p>
      ) : (
        <div className="space-y-3">
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[170px]">{t('createdAt')}</TableHead>
                  <TableHead>{t('kind')}</TableHead>
                  <TableHead>{t('createdBy')}</TableHead>
                  <TableHead className="w-[110px]">{t('statusColumn')}</TableHead>
                  <TableHead>{t('resultColumn')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                      <Link href={`/jobs/${r.id}` as Route} className="underline underline-offset-2">
                        {fmt(r.createdAt)}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.kind}</TableCell>
                    <TableCell>{r.createdByEmail ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant={tone(r.status)}>{t(`status.${r.status}`)}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {t('tally', {
                        succeeded: r.succeeded,
                        failed: r.failed,
                        skipped: r.skipped,
                        total: r.total,
                      })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>{t('range', {from: (params.page - 1) * params.pageSize + 1, to: lastShown, total})}</span>
            <div className="flex gap-3">
              {hasPrev ? (
                <Link href={pageHref(params.page - 1)} className="underline underline-offset-2">
                  {t('prev')}
                </Link>
              ) : (
                <span className="opacity-50">{t('prev')}</span>
              )}
              {hasNext ? (
                <Link href={pageHref(params.page + 1)} className="underline underline-offset-2">
                  {t('next')}
                </Link>
              ) : (
                <span className="opacity-50">{t('next')}</span>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
