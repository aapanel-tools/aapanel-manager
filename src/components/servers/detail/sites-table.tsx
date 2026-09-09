'use client';

import {useState, useTransition} from 'react';
import {useTranslations} from 'next-intl';
import {RefreshCw, ShieldCheck, ShieldOff} from 'lucide-react';
import type {SiteListResult} from '@/server/actions/sites';
import {listSitesAction} from '@/server/actions/sites';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export interface SitesTableProps {
  id: string;
  initial: SiteListResult;
}

/**
 * The sites on one server, read-only for now.
 *
 * Creating and deleting are deliberately absent rather than merely unfinished:
 * the panel's DeleteSite takes flags that also remove the document root, the
 * FTP account and the database. An operation that destroys three things beyond
 * the one named needs its own preview and confirmation, not a trash icon added
 * alongside a listing (PROJECT_RULES.md §16).
 */
export function SitesTable({id, initial}: SitesTableProps) {
  const t = useTranslations('sites');
  const [result, setResult] = useState<SiteListResult>(initial);
  const [pending, startTransition] = useTransition();

  function refetch() {
    startTransition(async () => {
      setResult(await listSitesAction(id));
    });
  }

  const header = (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-base font-semibold">{t('title')}</h2>
      <Button variant="outline" size="sm" disabled={pending} onClick={refetch}>
        <RefreshCw className="mr-1 h-3.5 w-3.5" />
        {t('refresh')}
      </Button>
    </div>
  );

  // A source that did not answer stays visible: a shorter list looks complete,
  // and then "no sites" reads the same as "the panel refused" (ADR-0003).
  const partial =
    result.ok && result.failures.length > 0 ? (
      <div
        className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
        role="status"
      >
        <p className="font-medium">{t('partialTitle')}</p>
        <ul className="mt-1 space-y-0.5 text-xs opacity-80">
          {result.failures.map((f) => (
            <li key={f.source}>{t('partialLine', {source: f.source, reason: f.message})}</li>
          ))}
        </ul>
      </div>
    ) : null;

  if (!result.ok) {
    return (
      <div>
        {header}
        <div
          className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
          role="alert"
        >
          <p className="font-medium">{t('loadFailed')}</p>
          <p className="mt-1 text-xs opacity-80">{result.message}</p>
        </div>
      </div>
    );
  }

  if (result.sites.length === 0) {
    return (
      <div>
        {header}
        {partial}
        <p className="text-sm text-muted-foreground">{t('noSites')}</p>
      </div>
    );
  }

  return (
    <div>
      {header}
      {partial}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('domain')}</TableHead>
            <TableHead>{t('type')}</TableHead>
            <TableHead>{t('php')}</TableHead>
            <TableHead>{t('ssl')}</TableHead>
            <TableHead>{t('domains')}</TableHead>
            <TableHead>{t('path')}</TableHead>
            <TableHead>{t('status')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.sites.map((s) => (
            <TableRow key={s.id}>
              <TableCell className="font-medium">{s.name}</TableCell>
              <TableCell>
                {/* The panel's own word for the type, whatever it is: an
                    unrecognised one is information, not a rendering problem. */}
                <Badge variant="secondary" className="border-0">
                  {s.type || '—'}
                </Badge>
              </TableCell>
              <TableCell className="tabular-nums">{s.phpVersion || '—'}</TableCell>
              <TableCell>
                {s.sslEnabled ? (
                  <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                    <ShieldCheck className="h-4 w-4" />
                    <span className="sr-only">{t('sslOn')}</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                    <ShieldOff className="h-4 w-4" />
                    <span className="sr-only">{t('sslOff')}</span>
                  </span>
                )}
              </TableCell>
              <TableCell className="tabular-nums">{s.domainCount}</TableCell>
              <TableCell className="max-w-[22rem] truncate font-mono text-xs" title={s.path}>
                {s.path || '—'}
              </TableCell>
              <TableCell>
                <Badge
                  variant="secondary"
                  className={
                    s.running
                      ? 'border-0 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                      : 'border-0 bg-muted text-muted-foreground'
                  }
                >
                  {s.running ? t('running') : t('stopped')}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
