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

export function SectionNav({id, isAdmin}: SectionNavProps) {
  const pathname = usePathname();
  const t = useTranslations('detail');

  const overviewHref = `/servers/${id}` as Route;
  const projectsHref = `/servers/${id}/projects` as Route;
  const databasesHref = `/servers/${id}/databases` as Route;
  const filesHref = `/servers/${id}/files` as Route;
  const sitesHref = `/servers/${id}/sites` as Route;
  const cronHref = `/servers/${id}/cron` as Route;
  const firewallHref = `/servers/${id}/firewall` as Route;
  const ftpHref = `/servers/${id}/ftp` as Route;

  const links = [
    {href: overviewHref, label: t('overview'), exact: true},
    // Sites first among the sections: on a hosting panel it is what people open
    // for, far more often than projects and databases together.
    {href: sitesHref, label: t('sites'), exact: false},
    {href: projectsHref, label: t('projects'), exact: false},
    {href: databasesHref, label: t('databases'), exact: false},
    // Administrators only, like the section behind it (ADR-0008). Shown to a
    // viewer, it would be a link that sends them straight back to the overview.
    ...(isAdmin ? [{href: filesHref, label: t('files'), exact: false}] : []),
    {href: cronHref, label: t('cron'), exact: false},
    {href: firewallHref, label: t('firewall'), exact: false},
    {href: ftpHref, label: t('ftp'), exact: false},
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
    </nav>
  );
}
