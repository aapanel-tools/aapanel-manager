'use client';
import {useTranslations} from 'next-intl';
import {Badge} from '@/components/ui/badge';
import {cn} from '@/lib/utils';

export type StatusKind = 'online' | 'offline' | 'unknown';

export function statusVariant(online: boolean | null): StatusKind {
  if (online === true) return 'online';
  if (online === false) return 'offline';
  return 'unknown';
}

const STYLES: Record<StatusKind, string> = {
  online: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  offline: 'bg-red-500/15 text-red-600 dark:text-red-400',
  unknown: 'bg-muted text-muted-foreground',
};

export function StatusBadge({online}: {online: boolean | null}) {
  const t = useTranslations('servers');
  const kind = statusVariant(online);
  return <Badge className={cn('font-medium', STYLES[kind])}>{t(kind)}</Badge>;
}
