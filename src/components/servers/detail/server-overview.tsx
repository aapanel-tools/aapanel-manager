'use client';

import {useEffect, useRef, useState} from 'react';
import {useTranslations} from 'next-intl';
import {Button} from '@/components/ui/button';
import {MetricBar} from './metric-bar';
import {getServerMetricsAction} from '@/server/actions/projects';
import type {MetricsResult} from '@/server/actions/projects';
import type {ServerMetrics} from '@/lib/aapanel';

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

  const [result, setResult] = useState<MetricsResult>(initial);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Guard against overlapping fetches and post-unmount state updates.
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    // Stamp "last updated" only after mount (client-only). Rendering a live clock
    // during render would differ between SSR and hydration → hydration mismatch.
    const stampTimer = setTimeout(() => {
      if (mountedRef.current) setLastUpdated(new Date());
    }, 0);

    const tick = async () => {
      // Skip when tab is hidden or a fetch is already running.
      if (document.visibilityState !== 'visible') return;
      if (inFlightRef.current) return;

      inFlightRef.current = true;
      try {
        const next = await getServerMetricsAction(id);
        if (mountedRef.current) {
          setResult(next);
          setLastUpdated(new Date());
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
      const next = await getServerMetricsAction(id);
      if (!mountedRef.current) return;
      setResult(next);
      setLastUpdated(new Date());
    } finally {
      inFlightRef.current = false;
    }
  };

  // Render error / offline state
  if (!result.ok) {
    return (
      <div className="space-y-4 rounded-xl border p-6">
        <p className="text-sm text-destructive">
          {t('offline')} — {result.message}
        </p>
        <Button onClick={() => void handleRetry()} size="sm">
          {t('retry')}
        </Button>
        <p className="text-xs text-muted-foreground">
          {t('lastUpdated')}: {lastUpdated ? lastUpdated.toLocaleTimeString() : '—'}
        </p>
      </div>
    );
  }

  const m: ServerMetrics = result.metrics;

  return (
    <div className="space-y-6">
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
      <p className="text-xs text-muted-foreground">
        {t('lastUpdated')}: {lastUpdated ? lastUpdated.toLocaleTimeString() : '—'}
      </p>
    </div>
  );
}
