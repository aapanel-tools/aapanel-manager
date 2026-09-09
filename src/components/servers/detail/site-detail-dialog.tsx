'use client';

import {useState, useTransition} from 'react';
import {useTranslations} from 'next-intl';
import {RefreshCw, ShieldCheck, ShieldOff} from 'lucide-react';
import type {Site, SiteDetail} from '@/lib/aapanel';
import {getSiteDetailAction, getSiteLogsAction} from '@/server/actions/sites';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {Separator} from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {ListIntegrityNotice} from '@/components/servers/detail/list-integrity-notice';

export interface SiteDetailDialogProps {
  id: string;
  site: Site;
  trigger: React.ReactElement;
}

/**
 * Read-only card for one site: domains, directory, SSL, PHP version, log.
 *
 * Sections stacked rather than tabbed: the UI kit has no tabs component, and
 * adding one to show four short blocks would be a dependency bought for
 * decoration. The log is the exception — it is fetched on request, because it
 * is the only part that can be large and it costs a slot on a production panel
 * (ADR-0004).
 *
 * Nothing here changes anything. Editing a site's domains or certificate is a
 * later slice with its own confirmations; a card that reads is finished work,
 * a card that half-edits is not.
 */
export function SiteDetailDialog({id, site, trigger}: SiteDetailDialogProps) {
  const t = useTranslations('sites');
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<SiteDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string | null>(null);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [logsPending, startLogsTransition] = useTransition();

  function load() {
    startTransition(async () => {
      const res = await getSiteDetailAction(id, {id: site.id, name: site.name, path: site.path});
      if (res.ok) {
        setDetail(res.detail);
        setError(null);
      } else {
        setDetail(null);
        setError(res.message);
      }
    });
  }

  function loadLogs() {
    startLogsTransition(async () => {
      const res = await getSiteLogsAction(id, site.name);
      if (res.ok) {
        setLogs(res.logs);
        setLogsError(null);
      } else {
        setLogs(null);
        setLogsError(res.message);
      }
    });
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    // Fetched on open, not on mount: the table renders one of these per row,
    // and a card nobody opened must not call the panel.
    if (next && !detail && !pending) load();
  }

  const row = (label: string, value: React.ReactNode) => (
    <div className="flex items-baseline justify-between gap-4 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );

  const yesNo = (value: boolean) => (value ? t('yes') : t('no'));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={trigger} />
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="break-all">{site.name}</DialogTitle>
        </DialogHeader>

        {error && (
          <div
            className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
            role="alert"
          >
            <p className="font-medium">{t('detailFailed')}</p>
            <p className="mt-1 text-xs opacity-80">{error}</p>
          </div>
        )}

        {pending && !detail && <p className="text-sm text-muted-foreground">{t('loading')}</p>}

        {detail && (
          <div className="space-y-4">
            {/* Which parts of the card did not load, and why. A section that
                silently renders empty is how an operator concludes a site has
                no domains (ADR-0003). */}
            <ListIntegrityNotice
              failures={detail.failures}
              truncations={[]}
              failuresTitle={t('detailPartial')}
              labelSource={(s) => t(`part.${s}` as 'part.domains')}
            />

            <section>
              <h3 className="mb-1 text-sm font-semibold">{t('domainsSection')}</h3>
              {detail.domains === null ? (
                <p className="text-xs text-muted-foreground">{t('notLoaded')}</p>
              ) : detail.domains.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t('noDomains')}</p>
              ) : (
                <ul className="space-y-1">
                  {detail.domains.map((d) => (
                    <li key={d.id} className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="break-all font-mono text-xs">{d.name}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">:{d.port}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <Separator />

            <section>
              <h3 className="mb-1 text-sm font-semibold">{t('directorySection')}</h3>
              {row('root', <span className="break-all font-mono text-xs">{site.path || '—'}</span>)}
              {detail.directory === null ? (
                <p className="text-xs text-muted-foreground">{t('notLoaded')}</p>
              ) : (
                <>
                  {/* The served subdirectory, not the root: a framework install
                      points this at /public, and confusing the two is how one
                      ends up staring at a directory listing. */}
                  {row(
                    t('runPath'),
                    <span className="font-mono text-xs">{detail.directory.runPath}</span>,
                  )}
                  {row(t('userIni'), yesNo(detail.directory.userIniProtected))}
                  {row(t('accessLog'), yesNo(detail.directory.accessLogEnabled))}
                  {row(t('passwordProtected'), yesNo(detail.directory.passwordProtected))}
                </>
              )}
            </section>

            <Separator />

            <section>
              <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold">
                {t('sslSection')}
                {detail.ssl?.enabled ? (
                  <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <ShieldOff className="h-4 w-4 text-muted-foreground" />
                )}
              </h3>
              {detail.ssl === null ? (
                <p className="text-xs text-muted-foreground">{t('notLoaded')}</p>
              ) : (
                <>
                  {row(t('sslEnabled'), yesNo(detail.ssl.enabled))}
                  {row(t('forceHttps'), yesNo(detail.ssl.forceHttps))}
                  {row(t('autoRenew'), yesNo(detail.ssl.autoRenew))}
                  {row(
                    t('tlsVersions'),
                    <span className="flex flex-wrap justify-end gap-1">
                      {Object.entries(detail.ssl.tlsVersions)
                        .filter(([, on]) => on)
                        .map(([name]) => (
                          <Badge key={name} variant="secondary" className="border-0">
                            {name}
                          </Badge>
                        ))}
                    </span>,
                  )}
                </>
              )}
            </section>

            <Separator />

            <section>
              <h3 className="mb-1 text-sm font-semibold">{t('phpSection')}</h3>
              {detail.phpVersion === null ? (
                <p className="text-xs text-muted-foreground">{t('notLoaded')}</p>
              ) : (
                row(t('php'), detail.phpVersion || '—')
              )}
            </section>

            <Separator />

            <section>
              <div className="mb-1 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">{t('logSection')}</h3>
                <Button variant="outline" size="sm" disabled={logsPending} onClick={loadLogs}>
                  <RefreshCw className="mr-1 h-3.5 w-3.5" />
                  {logs === null ? t('loadLog') : t('refresh')}
                </Button>
              </div>
              {logsError && <p className="text-xs text-destructive">{logsError}</p>}
              {logs !== null &&
                // An empty log is a site with no traffic yet, not a failure —
                // saying so beats an empty box that looks broken.
                (logs.trim() === '' ? (
                  <p className="text-xs text-muted-foreground">{t('logEmpty')}</p>
                ) : (
                  <pre className="max-h-64 overflow-auto rounded-md bg-muted p-2 text-xs">
                    {logs}
                  </pre>
                ))}
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
