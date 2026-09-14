import Link from 'next/link';
import type {Route} from 'next';
import {useTranslations} from 'next-intl';
import {failurePhrase, withPanelWords} from '@/lib/aapanel/failure-phrase';
import {formatTimestamp} from '@/lib/format/datetime';
import type {AttentionRow} from '@/lib/servers/overview';

/**
 * What needs looking at, worst first.
 *
 * Deliberately not a table: the point is to be read in one glance and then
 * clicked, not sorted and filtered. An empty list is the good case and says so
 * plainly instead of rendering an empty frame.
 */
export function AttentionList({rows, staleAfterMs}: {rows: AttentionRow[]; staleAfterMs: number}) {
  const t = useTranslations('fleet');
  // The phrase for a kind of failure is the same one presentError() and the
  // incomplete-list notice use; one catalogue, so the three cannot drift.
  const tp = useTranslations('panelError');

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('attention.allClear')}</p>;
  }

  return (
    <ul className="divide-y divide-foreground/10 rounded-xl bg-card ring-1 ring-foreground/10">
      {rows.map((r) => (
        <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <Link href={`/servers/${r.id}` as Route} className="font-medium hover:underline">
              {r.name}
            </Link>
            {r.tag ? <span className="ml-2 text-xs text-muted-foreground">{r.tag}</span> : null}
            {/* What the last poll failed with: the kind in the reader's own words,
                and the panel's words beside it when it gave any — more useful
                than our summary of them, and the reason they are stored at all.
                The stored row holds a kind, not a phrase, because the process
                that wrote it had no reader to choose a language for (ADR-0012). */}
            {r.errorKind ? (
              <p className="truncate text-xs text-muted-foreground">
                {withPanelWords(failurePhrase(r.errorKind, tp), r.error, tp)}
              </p>
            ) : null}
          </div>
          <div className="shrink-0 text-right">
            <div className="text-sm font-medium">{reasonLabel(t, r, staleAfterMs)}</div>
            {r.lastCheckedAt ? (
              <div className="text-xs tabular-nums text-muted-foreground">
                {t('attention.checked', {when: formatTimestamp(r.lastCheckedAt)})}
              </div>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

function reasonLabel(
  t: ReturnType<typeof useTranslations<'fleet'>>,
  r: AttentionRow,
  staleAfterMs: number,
): string {
  switch (r.reason) {
    case 'disk':
      return t('attention.disk', {percent: Math.round(r.value ?? 0)});
    case 'memory':
      return t('attention.memory', {percent: Math.round(r.value ?? 0)});
    case 'stale':
      return t('attention.stale', {minutes: Math.round(staleAfterMs / 60_000)});
    default:
      return t('attention.offline');
  }
}
