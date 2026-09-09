import Link from 'next/link';
import type {Route} from 'next';
import {getTranslations} from 'next-intl/server';
import {requireUser} from '@/lib/auth/guards';
import {getFleetOverview} from '@/lib/servers/overview';
import {listJobs} from '@/lib/jobs/query';
import {jobListParamsSchema} from '@/lib/validation/job';
import {listAuditLog} from '@/lib/audit';
import {formatTimestamp} from '@/lib/format/datetime';
import {auditListParamsSchema} from '@/lib/validation/audit';
import {ServersLive} from '@/components/servers/servers-live';
import {FleetCounts} from '@/components/overview/fleet-counts';
import {AttentionList} from '@/components/overview/attention-list';

/**
 * The fleet summary (Ф-7): the first screen of the day.
 *
 * Every number here comes from the local cache — no panel is contacted to draw
 * it. Opening the app must not turn into a burst of requests against every
 * customer machine at once, and the poller has already asked; asking again
 * would be both slower and ruder (ADR-0004).
 *
 * The four reads run in parallel because none depends on another, and the page
 * is only as fast as its slowest one.
 */
export default async function Home() {
  await requireUser();
  const t = await getTranslations('fleet');

  const [overview, active, recent] = await Promise.all([
    getFleetOverview(),
    listJobs(jobListParamsSchema.parse({status: 'active', pageSize: '10'})),
    listAuditLog(auditListParamsSchema.parse({pageSize: '10'})),
  ]);

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
      </div>

      {/* Same subscription the servers table uses: one stream, one refresh path. */}
      <ServersLive />

      <FleetCounts counts={overview.counts} />

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">{t('attention.title')}</h2>
        <AttentionList rows={overview.attention} staleAfterMs={overview.thresholds.staleAfterMs} />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-2">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-medium text-muted-foreground">{t('active.title')}</h2>
            <Link href={'/jobs' as Route} className="text-xs text-muted-foreground hover:underline">
              {t('active.all')}
            </Link>
          </div>
          {active.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('active.none')}</p>
          ) : (
            <ul className="divide-y divide-foreground/10 rounded-xl bg-card ring-1 ring-foreground/10">
              {active.rows.map((j) => (
                <li key={j.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <Link href={`/jobs/${j.id}` as Route} className="truncate text-sm hover:underline">
                    {j.kind}
                  </Link>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {t('active.progress', {done: j.succeeded + j.failed + j.skipped, total: j.total})}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-2">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-medium text-muted-foreground">{t('recent.title')}</h2>
            <Link href={'/audit' as Route} className="text-xs text-muted-foreground hover:underline">
              {t('recent.all')}
            </Link>
          </div>
          {recent.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('recent.none')}</p>
          ) : (
            <ul className="divide-y divide-foreground/10 rounded-xl bg-card ring-1 ring-foreground/10">
              {recent.rows.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0 text-sm">
                    <span className={a.result === 'ok' ? '' : 'text-red-600 dark:text-red-400'}>
                      {a.action}
                    </span>
                    {/* A deleted server leaves its lines behind on purpose: the
                        journal is evidence, and evidence that disappears with
                        its subject proves nothing. */}
                    {a.serverName ? (
                      <span className="ml-2 text-muted-foreground">{a.serverName}</span>
                    ) : null}
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {formatTimestamp(a.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </section>
  );
}
