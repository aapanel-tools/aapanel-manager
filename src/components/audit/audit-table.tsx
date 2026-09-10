import Link from 'next/link';
import {formatTimestamp} from '@/lib/format/datetime';
import type {Route} from 'next';
import {getTranslations} from 'next-intl/server';
import {AUDIT_STARTED, type AuditRow} from '@/lib/audit';
import type {AuditListParams} from '@/lib/validation/audit';
import {Badge} from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const DEFAULT_PAGE_SIZE = 50;

/**
 * What an outcome says and how it looks.
 *
 * The column used to be printed raw, so an English token out of the database
 * appeared in the middle of a translated interface, and `cancelled` was painted
 * red along with everything that is not a plain success — telling an operator
 * that a batch they stopped on purpose had gone wrong. `started` is its own
 * state for the reason given where it is defined: the line worth chasing, not
 * a shade of failure (Д-19, Д-20).
 *
 * A word from outside the vocabulary is shown rather than hidden. The journal
 * outlives the code that wrote it, and a row this version has no name for is
 * information, not a rendering problem.
 */
function resultBadge(
  result: string,
  t: (key: string) => string,
): {variant: 'secondary' | 'destructive'; className?: string; label: string} {
  switch (result) {
    case 'ok':
      return {variant: 'secondary', label: t('ok')};
    case 'error':
      return {variant: 'destructive', label: t('error')};
    case 'failed':
      return {variant: 'destructive', label: t('failed')};
    case 'cancelled':
      return {
        variant: 'secondary',
        className: 'border-0 bg-muted text-muted-foreground',
        label: t('cancelled'),
      };
    case AUDIT_STARTED:
      return {
        variant: 'secondary',
        className: 'border-0 bg-amber-500/15 text-amber-700 dark:text-amber-400',
        label: t('started'),
      };
    default:
      return {variant: 'destructive', label: result};
  }
}

/** Rebuilds the URL for another page, carrying every active filter along. */
function pageHref(params: AuditListParams, page: number): Route {
  const sp = new URLSearchParams();
  if (params.q) sp.set('q', params.q);
  if (params.serverId) sp.set('serverId', params.serverId);
  if (params.userId) sp.set('userId', params.userId);
  if (params.result !== 'all') sp.set('result', params.result);
  if (params.from) sp.set('from', params.from.toISOString().slice(0, 10));
  if (params.to) sp.set('to', params.to.toISOString().slice(0, 10));
  if (params.pageSize !== DEFAULT_PAGE_SIZE) sp.set('pageSize', String(params.pageSize));
  if (page > 1) sp.set('page', String(page));
  const qs = sp.toString();
  return (qs ? `/audit?${qs}` : '/audit') as Route;
}

export interface AuditTableProps {
  rows: AuditRow[];
  total: number;
  params: AuditListParams;
}

export async function AuditTable({rows, total, params}: AuditTableProps) {
  const t = await getTranslations('audit');
  if (rows.length === 0) return <p className="text-muted-foreground">{t('empty')}</p>;

  const firstShown = (params.page - 1) * params.pageSize + 1;
  const lastShown = Math.min(params.page * params.pageSize, total);
  const hasPrev = params.page > 1;
  const hasNext = lastShown < total;

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[170px]">{t('when')}</TableHead>
              <TableHead>{t('who')}</TableHead>
              <TableHead>{t('server')}</TableHead>
              <TableHead>{t('action')}</TableHead>
              <TableHead>{t('target')}</TableHead>
              <TableHead className="w-[110px]">{t('result')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const outcome = resultBadge(r.result, t);
              return (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                    {formatTimestamp(r.createdAt)}
                  </TableCell>
                  <TableCell>
                    {r.userEmail ?? <span className="text-muted-foreground">{t('gone')}</span>}
                  </TableCell>
                  <TableCell>
                    {r.serverName && r.serverId ? (
                      <Link href={`/servers/${r.serverId}` as Route} className="underline underline-offset-2">
                        {r.serverName}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">{r.serverId ? t('gone') : '—'}</span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.action}</TableCell>
                  <TableCell className="max-w-[24rem] truncate" title={r.target ?? undefined}>
                    {r.target ?? '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={outcome.variant} className={outcome.className}>
                      {outcome.label}
                    </Badge>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{t('range', {from: firstShown, to: lastShown, total})}</span>
        <div className="flex gap-3">
          {hasPrev ? (
            <Link href={pageHref(params, params.page - 1)} className="underline underline-offset-2">
              {t('prev')}
            </Link>
          ) : (
            <span className="opacity-50">{t('prev')}</span>
          )}
          {hasNext ? (
            <Link href={pageHref(params, params.page + 1)} className="underline underline-offset-2">
              {t('next')}
            </Link>
          ) : (
            <span className="opacity-50">{t('next')}</span>
          )}
        </div>
      </div>
    </div>
  );
}
