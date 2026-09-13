'use client';

import {useTranslations} from 'next-intl';
import {useActionError} from '@/components/use-action-error';
import {formatTimestamp} from '@/lib/format/datetime';
import {cn} from '@/lib/utils';

export interface StaleNoticeProps {
  /** Why the latest refresh brought nothing: a refusal code or a finished sentence. */
  failure: string;
  /** When the data still on screen was fetched; null for the data the page arrived with. */
  fetchedAt: Date | null;
  /**
   * Says that deleting is closed until the list refreshes. Deleting acts on a
   * row as it was seen, and a row that could not be re-read may already be
   * gone or changed — the local copy is a cache, not the truth.
   */
  deletingBlocked?: boolean;
  className?: string;
}

/**
 * Says that what is on screen is older than the latest attempt, and why.
 *
 * The companion of settle-refresh.ts: a refresh that brings nothing no longer
 * wipes the rows or the readings, so the screen has to say they are not fresh
 * and how old they are. Amber and a status, not an alert — the data is still
 * here; FailureNotice is for the case where there is none.
 */
export function StaleNotice({failure, fetchedAt, deletingBlocked = false, className}: StaleNoticeProps) {
  const t = useTranslations('stale');
  const actionError = useActionError();

  return (
    <div
      className={cn('mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm', className)}
      role="status"
    >
      <p className="font-medium">
        {fetchedAt ? t('title', {when: formatTimestamp(fetchedAt)}) : t('titleNoTime')}
      </p>
      <p className="mt-1 text-xs opacity-80">{actionError(failure)}</p>
      {deletingBlocked ? <p className="mt-1 text-xs opacity-80">{t('deleteBlocked')}</p> : null}
    </div>
  );
}
