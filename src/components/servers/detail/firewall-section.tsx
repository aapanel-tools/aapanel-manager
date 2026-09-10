'use client';

import {useState, useTransition} from 'react';
import {useTranslations} from 'next-intl';
import {RefreshCw, ShieldAlert} from 'lucide-react';
import type {FirewallOverviewResult, FirewallRulesResult} from '@/server/actions/firewall';
import {getFirewallOverviewAction, listFirewallRulesAction} from '@/server/actions/firewall';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {Separator} from '@/components/ui/separator';
import {ListIntegrityNotice} from '@/components/servers/detail/list-integrity-notice';
import {ListSearch} from '@/components/servers/detail/list-search';
import {useSearchableList} from '@/components/servers/detail/use-searchable-list';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export interface FirewallSectionProps {
  id: string;
  initialOverview: FirewallOverviewResult;
  initialRules: FirewallRulesResult;
}

/**
 * A server's firewall, read-only.
 *
 * Read-only is the whole design, not a first step waiting to be finished. A
 * wrong port rule locks everyone out of the machine — the panel included — so
 * the writing side of this API was deliberately never exercised on a live host
 * and has no captured request to build on. What is here answers the question a
 * fleet operator actually asks: is this thing on, and what is open.
 *
 * The summary and the rules are fetched separately because they change for
 * different reasons and cost different amounts. Typing in the search box
 * re-reads the rules only; the refresh button re-reads both.
 */
export function FirewallSection({id, initialOverview, initialRules}: FirewallSectionProps) {
  const t = useTranslations('firewall');
  const [overview, setOverview] = useState<FirewallOverviewResult>(initialOverview);
  const [overviewPending, startOverview] = useTransition();

  const {result, search, setSearch, applied, pending, reload} =
    useSearchableList<FirewallRulesResult>(initialRules, (term) =>
      listFirewallRulesAction(id, term),
    );

  function refreshAll() {
    startOverview(async () => {
      setOverview(await getFirewallOverviewAction(id));
    });
    void reload();
  }

  const busy = pending || overviewPending;

  const header = (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-base font-semibold">{t('title')}</h2>
      <div className="flex items-center gap-2">
        <ListSearch
          value={search}
          onChange={setSearch}
          placeholder={t('searchPlaceholder')}
          busy={pending}
        />
        <Button variant="outline" size="sm" disabled={busy} onClick={refreshAll}>
          <RefreshCw className="mr-1 h-3.5 w-3.5" />
          {t('refresh')}
        </Button>
      </div>
    </div>
  );

  const fact = (label: string, value: React.ReactNode) => (
    <div className="flex items-baseline justify-between gap-4 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );

  const summary = overview.ok ? (
    <div className="mb-4">
      {/* A firewall that is off is a finding about a client's machine, not a
          field in a table — so it is said once, loudly, and only when the panel
          actually said so. `null` means the panel would not answer, and showing
          that as "off" would raise a false alarm about someone else's server. */}
      {overview.overview.enabled === false && (
        <div
          className="mb-3 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          role="alert"
        >
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div>
            <p className="font-medium">{t('offTitle')}</p>
            <p className="mt-0.5 text-xs opacity-80">{t('offHint')}</p>
          </div>
        </div>
      )}

      {/* Which half of the summary did not arrive, and why. */}
      <ListIntegrityNotice
        failures={overview.overview.failures}
        truncations={[]}
        failuresTitle={t('summaryPartial')}
        labelSource={(s) => (s === 'firewallStatus' ? t('partState') : t('partCounts'))}
      />

      <div className="rounded-md border p-3">
        {fact(
          t('state'),
          overview.overview.enabled === null ? (
            <span className="text-muted-foreground">{t('unknown')}</span>
          ) : (
            <Badge
              variant="secondary"
              className={
                overview.overview.enabled
                  ? 'border-0 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                  : 'border-0 bg-destructive/15 text-destructive'
              }
            >
              {overview.overview.enabled ? t('on') : t('off')}
            </Badge>
          ),
        )}
        {/* The panel's own word for the backend: ufw, firewalld, iptables — and
            whatever a distribution we have not seen calls its own. */}
        {fact(
          t('backend'),
          overview.overview.backend ? (
            <span className="font-mono text-xs">{overview.overview.backend}</span>
          ) : (
            <span className="text-muted-foreground">{t('unknown')}</span>
          ),
        )}
        {fact(
          t('ping'),
          overview.overview.ping === null ? (
            <span className="text-muted-foreground">{t('unknown')}</span>
          ) : (
            <span>{overview.overview.ping ? t('yes') : t('no')}</span>
          ),
        )}
        {overview.overview.counts && (
          <>
            <Separator className="my-2" />
            <div className="grid grid-cols-2 gap-x-6 sm:grid-cols-3">
              {fact(t('countPort'), <span className="tabular-nums">{overview.overview.counts.port}</span>)}
              {fact(t('countIp'), <span className="tabular-nums">{overview.overview.counts.ip}</span>)}
              {fact(t('countTrans'), <span className="tabular-nums">{overview.overview.counts.trans}</span>)}
              {fact(t('countCountry'), <span className="tabular-nums">{overview.overview.counts.country}</span>)}
              {fact(t('countBanned'), <span className="tabular-nums">{overview.overview.counts.banned}</span>)}
            </div>
          </>
        )}
        {overview.overview.updatedAt && (
          <p className="mt-2 text-xs text-muted-foreground">
            {t('updatedAt', {when: overview.overview.updatedAt})}
          </p>
        )}
      </div>
    </div>
  ) : (
    <div
      className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
      role="alert"
    >
      <p className="font-medium">{t('summaryFailed')}</p>
      <p className="mt-1 text-xs opacity-80">{overview.message}</p>
    </div>
  );

  if (!result.ok) {
    return (
      <div>
        {header}
        {summary}
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

  // A rules list that came back short but looks whole is a false statement
  // about what is open on a client's machine (ADR-0003, Д-16).
  const partial = (
    <ListIntegrityNotice
      failures={result.failures}
      truncations={result.truncations}
      labelSource={() => t('rules')}
    />
  );

  return (
    <div>
      {header}
      {summary}
      {partial}

      {result.rules.length === 0 ? (
        result.failures.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {applied ? t('noMatches', {query: applied}) : t('noRules')}
          </p>
        )
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('port')}</TableHead>
              <TableHead>{t('protocol')}</TableHead>
              <TableHead>{t('family')}</TableHead>
              <TableHead>{t('strategy')}</TableHead>
              <TableHead>{t('chain')}</TableHead>
              <TableHead>{t('address')}</TableHead>
              <TableHead>{t('note')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.rules.map((rule, index) => (
              // The panel writes id 0 for its built-in system ports, so the id
              // alone does not identify a row.
              <TableRow key={`${rule.id}-${rule.chain}-${rule.protocol}-${rule.port}-${index}`}>
                <TableCell className="font-medium tabular-nums">{rule.port || '—'}</TableCell>
                <TableCell className="font-mono text-xs">{rule.protocol || '—'}</TableCell>
                <TableCell className="font-mono text-xs">{rule.family || '—'}</TableCell>
                <TableCell>
                  {/* The panel's own word, uncoloured on purpose: `accept` is
                      not "good" and `drop` is not "bad" — which is which
                      depends entirely on the port, and a green badge next to an
                      open 3306 would say otherwise. */}
                  <Badge variant="secondary" className="border-0">
                    {rule.strategy || '—'}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono text-xs">{rule.chain || '—'}</TableCell>
                <TableCell className="font-mono text-xs">{rule.address || '—'}</TableCell>
                <TableCell className="max-w-[18rem] truncate" title={rule.note}>
                  {rule.note || '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
