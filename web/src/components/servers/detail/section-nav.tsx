'use client';

import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {useTranslations} from 'next-intl';
import type {Route} from 'next';
import {cn} from '@/lib/utils';

export interface SectionNavProps {
  id: string;
  isAdmin: boolean;
}

const DISABLED_SECTIONS = [
  'files',
  'ftp',
  'cron',
  'firewall',
] as const;

export function SectionNav({id}: SectionNavProps) {
  const pathname = usePathname();
  const t = useTranslations('detail');

  const overviewHref = `/servers/${id}` as Route;
  const projectsHref = `/servers/${id}/projects` as Route;
  const databasesHref = `/servers/${id}/databases` as Route;

  const links = [
    {href: overviewHref, label: t('overview'), exact: true},
    {href: projectsHref, label: t('projects'), exact: false},
    {href: databasesHref, label: t('databases'), exact: false},
  ] satisfies Array<{href: Route; label: string; exact: boolean}>;

  return (
    <nav aria-label={t('overview')} className="flex flex-col gap-1">
      {links.map(({href, label, exact}) => {
        const isActive = exact ? pathname === href : pathname.startsWith(href);
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

      {DISABLED_SECTIONS.map((key) => (
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
