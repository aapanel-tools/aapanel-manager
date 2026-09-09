import Link from 'next/link';
import type {Route} from 'next';
import {useTranslations} from 'next-intl';
import type {FleetCounts as Counts} from '@/lib/servers/overview';

/**
 * The fleet in four numbers, each a link into the filtered list.
 *
 * "Never polled" is its own number rather than folded into offline: a fleet
 * where everything is unchecked means the poller died, and reading that as
 * "everything is down" sends the operator looking at the wrong machines.
 */
export function FleetCounts({counts}: {counts: Counts}) {
  const t = useTranslations('fleet');

  const cells: Array<{key: keyof Counts; href: Route; tone: string}> = [
    {key: 'total', href: '/servers' as Route, tone: 'text-foreground'},
    {key: 'online', href: '/servers?status=online' as Route, tone: 'text-emerald-600 dark:text-emerald-400'},
    {key: 'offline', href: '/servers?status=offline' as Route, tone: 'text-red-600 dark:text-red-400'},
    {key: 'unchecked', href: '/servers?status=unknown' as Route, tone: 'text-muted-foreground'},
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {cells.map(({key, href, tone}) => (
        <Link
          key={key}
          href={href}
          className="rounded-xl bg-card px-4 py-3 ring-1 ring-foreground/10 transition-colors hover:ring-foreground/25"
        >
          <div className={`text-2xl font-semibold tabular-nums ${tone}`}>{counts[key]}</div>
          <div className="text-sm text-muted-foreground">{t(`counts.${key}`)}</div>
        </Link>
      ))}
    </div>
  );
}
