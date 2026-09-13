'use client';

import {useTranslations} from 'next-intl';
import {formatTimestamp} from '@/lib/format/datetime';
import {cn} from '@/lib/utils';

export interface DataAgeProps {
  /** When the data on screen was fetched; nothing is rendered while that is unknown. */
  fetchedAt: Date | null;
  className?: string;
}

/**
 * When the data on screen was fetched (У-8).
 *
 * The local copy is a cache, not the truth, and a cache is only honest with its
 * age beside it. A list used to say nothing about that until a refresh failed;
 * now it always says how old its rows are. UTC and never relative, like every
 * other time in the app (src/lib/format/datetime.ts): the same string on the
 * server and in the browser, and one that does not freeze into "just now".
 */
export function DataAge({fetchedAt, className}: DataAgeProps) {
  const t = useTranslations('stale');
  if (!fetchedAt) return null;
  return (
    <p className={cn('mb-2 text-xs text-muted-foreground', className)}>
      {t('asOf', {when: formatTimestamp(fetchedAt)})}
    </p>
  );
}
