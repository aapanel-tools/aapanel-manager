'use client';

import {useSyncExternalStore} from 'react';
import Link from 'next/link';
import {useTranslations} from 'next-intl';
import {LogIn, RefreshCw} from 'lucide-react';
import {Button, buttonVariants} from '@/components/ui/button';
import {appNotices} from '@/components/app-notices-store';

/**
 * The notices that stay above every page until they stop being true (ADR-0010).
 *
 * The toast at the button that failed is gone in seconds. These two states
 * concern every button on the page, so they stay: a build the server no longer
 * has, which only a reload cures; and a session that ended, which signing in
 * again cures — in a new tab, so that what is typed on this one survives.
 */
export function AppNotices() {
  const t = useTranslations('notices');
  const {outdated, sessionEnded} = useSyncExternalStore(
    appNotices.subscribe,
    appNotices.getSnapshot,
    appNotices.getServerSnapshot,
  );

  if (!outdated && !sessionEnded) return null;

  return (
    <div className="space-y-2 px-4 pt-3">
      {outdated ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm"
        >
          <p>{t('outdated')}</p>
          <Button size="sm" onClick={() => window.location.reload()}>
            <RefreshCw />
            {t('reload')}
          </Button>
        </div>
      ) : null}
      {sessionEnded ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          <p>{t('sessionEnded')}</p>
          <div className="flex gap-2">
            <Link
              href="/login"
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({variant: 'outline', size: 'sm'})}
            >
              <LogIn />
              {t('signIn')}
            </Link>
            <Button size="sm" variant="ghost" onClick={appNotices.dismissSessionEnded}>
              {t('dismiss')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
