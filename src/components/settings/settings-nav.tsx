'use client';

import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {useTranslations} from 'next-intl';
import type {Route} from 'next';
import {cn} from '@/lib/utils';

/** Sections planned but not built yet — shown disabled with a "soon" tag. */
const SOON = ['navGeneral', 'navSecurity', 'navAudit'] as const;

export function SettingsNav() {
  const pathname = usePathname();
  const t = useTranslations('settings');

  const links = [
    {href: '/settings/updates' as Route, label: t('navUpdates')},
    {href: '/settings/account' as Route, label: t('navAccount')},
  ];

  return (
    <nav aria-label={t('title')} className="flex flex-col gap-1">
      {links.map(({href, label}) => {
        const isActive = pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'rounded-md px-3 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground',
            )}
          >
            {label}
          </Link>
        );
      })}

      {SOON.map((key) => (
        <div
          key={key}
          className="flex items-center justify-between rounded-md px-3 py-2 text-sm font-medium text-muted-foreground/50 cursor-not-allowed select-none"
          aria-disabled="true"
        >
          <span>{t(key)}</span>
          <span className="text-xs font-normal opacity-60">{t('soon')}</span>
        </div>
      ))}
    </nav>
  );
}
