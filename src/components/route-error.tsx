'use client';

import {useEffect} from 'react';
import {useTranslations} from 'next-intl';
import {Button} from '@/components/ui/button';
import {classifyCallError} from '@/components/call-action';
import {useActionError} from '@/components/use-action-error';

export interface RouteErrorProps {
  error: Error & {digest?: string};
  /** Re-fetches and re-renders the segment. Next 16.2; named `retry` from 16.3. */
  unstable_retry: () => void;
}

/**
 * The one fallback every `error.tsx` renders (ADR-0010).
 *
 * It is the net under `callAction`: a render error, or a call that went around
 * the wrapper, lands here. The sections used to answer in English that they had
 * failed to load — also when the page had loaded and a button had failed — and
 * the routes without a boundary lost the whole app to Next's own error page.
 *
 * The advice follows the cause. A build the server no longer has is cured only
 * by a reload, so retrying is not offered; anything else may pass, so both are.
 */
export function RouteError({error, unstable_retry: retry}: RouteErrorProps) {
  const t = useTranslations('routeError');
  const actionError = useActionError();
  const code = classifyCallError(error);

  useEffect(() => {
    // The expected causes are fully said by their phrase; an unforeseen one is
    // kept for whoever opens the console, next to the digest the server logged.
    if (code === 'failed') console.error(error);
  }, [code, error]);

  return (
    <div role="alert" className="space-y-3 rounded-xl border p-6">
      <p className="font-medium">{t('title')}</p>
      <p className="text-sm text-muted-foreground">{code === 'failed' ? t('failed') : actionError(code)}</p>
      <div className="flex flex-wrap gap-2">
        {code === 'outdated' ? null : (
          <Button size="sm" onClick={() => retry()}>
            {t('retry')}
          </Button>
        )}
        <Button
          size="sm"
          variant={code === 'outdated' ? 'default' : 'outline'}
          onClick={() => window.location.reload()}
        >
          {t('reload')}
        </Button>
      </div>
    </div>
  );
}
