'use client';

import {useEffect, useRef, useState} from 'react';
import {useTranslations} from 'next-intl';
import {Button} from '@/components/ui/button';
import {MetricBar} from './metric-bar';
import {getServerMetricsAction} from '@/server/actions/projects';
import type {MetricsResult} from '@/server/actions/projects';
import {callAction, asMessage} from '@/components/call-action';
import type {ServerMetrics} from '@/lib/aapanel';
import {actionErrorCode, useActionError} from '@/components/use-action-error';
import {StaleNotice} from '@/components/stale-notice';
import {formatTimestamp} from '@/lib/format/datetime';
import {settled, settleRefresh, type Settled} from './settle-refresh';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 4_000;

function fmt(value: number | null, decimals = 1): string {
  return value !== null ? value.toFixed(decimals) : '—';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface ServerOverviewProps {
  id: string;
  initial: Awaited<ReturnType<typeof getServerMetricsAction>>;
}

export function ServerOverview({id, initial}: ServerOverviewProps) {
  const t = useTranslations('overview');
  const actionError = useActionError();

  // The newest readings with data, why the latest poll brought nothing, and when
  // the readings on screen arrived. A poll that fails no longer wipes them: at
  // one every four seconds, a brief drop in the connection used to blank the
  // whole summary (settle-refresh.ts).
  const [state, setState] = useState<Settled<MetricsResult>>(() => settled(initial));

  // Guard against overlapping fetches and post-unmount state updates.
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    // Stamp the readings the page arrived with only after mount (client-only):
    // a clock read during render differs between SSR and hydration. Only
    // readings get a time — a refusal is not something that was "updated".
    const stampTimer = setTimeout(() => {
      if (!mountedRef.current) return;
      const at = new Date();
      setState((s) => (s.result.ok && s.fetchedAt === null ? {...s, fetchedAt: at} : s));
    }, 0);

    const tick = async () => {
      // Skip when tab is hidden or a fetch is already running.
      if (document.visibilityState !== 'visible') return;
      if (inFlightRef.current) return;

      inFlightRef.current = true;
      try {
        const next = await callAction(() => getServerMetricsAction(id), asMessage);
        if (mountedRef.current) {
          const at = new Date();
          setState((prev) => settleRefresh(prev, next, at));
        }
      } finally {
        inFlightRef.current = false;
      }
    };

    const id_ = setInterval(tick, POLL_INTERVAL_MS);

    return () => {
      mountedRef.current = false;
      clearTimeout(stampTimer);
      clearInterval(id_);
    };
  }, [id]);

  const handleRetry = async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const next = await callAction(() => getServerMetricsAction(id), asMessage);
      if (!mountedRef.current) return;
      const at = new Date();
      setState((prev) => settleRefresh(prev, next, at));
    } finally {
      inFlightRef.current = false;
    }
  };

  const {result, failure, fetchedAt} = state;

  // The time of the last readings that arrived — not of the last attempt, which
  // is what this line used to show, failed polls included.
  const stamp = (
    <p className="text-xs text-muted-foreground">
      {t('lastUpdated')}: {fetchedAt ? `${formatTimestamp(fetchedAt)} UTC` : '—'}
    </p>
  );

  // Render error / offline state
  if (!result.ok) {
    // "The server is unavailable" is a claim about someone's machine, and only
    // the panel's own refusal supports it — a finished sentence from
    // presentError(). A code is about this app instead: the connection to it,
    // its build, the session. Blaming the server for those sent operators
    // looking for an outage that was not there.
    const panelRefused = actionErrorCode(result.message) === null;
    return (
      <div className="space-y-4 rounded-xl border p-6">
        <p className="text-sm text-destructive">
          {panelRefused ? t('offline') : t('loadFailed')} — {actionError(result.message)}
        </p>
        <Button onClick={() => void handleRetry()} size="sm">
          {t('retry')}
        </Button>
        {stamp}
      </div>
    );
  }

  const m: ServerMetrics = result.metrics;

  return (
    <div className="space-y-6">
      {failure ? <StaleNotice failure={failure} fetchedAt={fetchedAt} className="mb-0" /> : null}

      {/* Metric bars */}
      <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-3">
        <div className="rounded-xl border p-4">
          <MetricBar label={t('cpu')} percent={m.cpuPercent} />
        </div>
        <div className="rounded-xl border p-4">
          <MetricBar
            label={t('memory')}
            percent={m.memPercent}
            detail={
              m.memUsedMb !== null && m.memTotalMb !== null
                ? `${m.memUsedMb} / ${m.memTotalMb} MB`
                : undefined
            }
          />
        </div>
        <div className="rounded-xl border p-4">
          <MetricBar label={t('disk')} percent={m.diskPercent} />
        </div>
      </div>

      {/* Stats row */}
      <div className="rounded-xl border p-4">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3 md:grid-cols-6">
          <div>
            <dt className="text-muted-foreground">{t('cores')}</dt>
            <dd className="font-medium tabular-nums">{fmt(m.cores, 0)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('load1')}</dt>
            <dd className="font-medium tabular-nums">{m.load !== null ? fmt(m.load.one) : '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('load5')}</dt>
            <dd className="font-medium tabular-nums">{m.load !== null ? fmt(m.load.five) : '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('load15')}</dt>
            <dd className="font-medium tabular-nums">{m.load !== null ? fmt(m.load.fifteen) : '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('netUp')}</dt>
            <dd className="font-medium tabular-nums">{fmt(m.netUpKbps)} Kbps</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('netDown')}</dt>
            <dd className="font-medium tabular-nums">{fmt(m.netDownKbps)} Kbps</dd>
          </div>
        </dl>
      </div>

      {/* Last updated */}
      {stamp}
    </div>
  );
}
