'use client';

import {cn} from '@/lib/utils';

// ---------------------------------------------------------------------------
// Pure helper — exported so it can be unit-tested without DOM
// ---------------------------------------------------------------------------

export type BarColorKind = 'ok' | 'warn' | 'crit' | 'unknown';

/**
 * Maps a percentage value to a color category.
 * null   → 'unknown'
 * < 75   → 'ok'
 * < 90   → 'warn'
 * else   → 'crit'
 */
export function barColor(pct: number | null): BarColorKind {
  if (pct === null) return 'unknown';
  if (pct < 75) return 'ok';
  if (pct < 90) return 'warn';
  return 'crit';
}

// ---------------------------------------------------------------------------
// Styles per color kind
// ---------------------------------------------------------------------------

const FILL_STYLES: Record<BarColorKind, string> = {
  ok: 'bg-emerald-500',
  warn: 'bg-amber-500',
  crit: 'bg-red-500',
  unknown: 'bg-muted',
};

const TEXT_STYLES: Record<BarColorKind, string> = {
  ok: 'text-emerald-600 dark:text-emerald-400',
  warn: 'text-amber-600 dark:text-amber-400',
  crit: 'text-red-600 dark:text-red-400',
  unknown: 'text-muted-foreground',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface MetricBarProps {
  label: string;
  /** Percentage 0–100, or null when unavailable */
  percent: number | null;
  /** Optional extra text (e.g. "1234 / 2048 MB") */
  detail?: string;
}

export function MetricBar({label, percent, detail}: MetricBarProps) {
  const kind = barColor(percent);
  const displayPct = percent !== null ? Math.min(100, Math.max(0, percent)) : 0;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className={cn('tabular-nums', TEXT_STYLES[kind])}>
          {percent !== null ? `${percent.toFixed(1)} %` : '—'}
          {detail ? ` · ${detail}` : ''}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuenow={percent ?? 0}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn('h-full rounded-full transition-all duration-300', FILL_STYLES[kind])}
          style={{width: `${displayPct}%`}}
        />
      </div>
    </div>
  );
}
