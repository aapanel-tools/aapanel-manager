'use client';

import {useEffect} from 'react';
import {appNotices} from '@/components/app-notices-store';

/** At most one question to the server a minute, however often the tab comes back. */
export const BUILD_CHECK_INTERVAL_MS = 60_000;

/**
 * Does the server answer from a different build than the one this tab was rendered by?
 *
 * Only a definite answer counts: a tab without a build id (a server started
 * without one, or development), or an answer without one, says nothing about
 * skew and must not raise the notice.
 */
export function isOtherBuild(tabBuild: string | null | undefined, answer: unknown): boolean {
  if (!tabBuild) return false;
  if (!answer || typeof answer !== 'object') return false;
  const serverBuild = (answer as {deploymentId?: unknown}).deploymentId;
  return typeof serverBuild === 'string' && serverBuild.length > 0 && serverBuild !== tabBuild;
}

/**
 * Tells the app, before anything is pressed, that it has been updated under this tab (ADR-0011).
 *
 * Phase 1 of Д-31 said so after the first action call failed. The tab now asks
 * `/api/health` when it becomes visible again, gets focus, or comes back
 * online — the moments after which an update is likely to have happened — and
 * raises the same app-wide notice when the server runs another build.
 *
 * `tabBuild` is handed down by the server that rendered the page. Next does
 * write the id onto `<html data-dpl-id>`, but its client runtime reads it at
 * start-up and removes the attribute straight away, so by the time any
 * component runs there is nothing left to read. Null means there is no build
 * id to compare, and the watch does not start.
 */
export function useBuildWatch(tabBuild: string | null): void {
  useEffect(() => {
    if (!tabBuild) return;

    let lastCheck = 0;
    let inFlight = false;

    const check = async () => {
      if (document.visibilityState !== 'visible' || inFlight) return;
      const now = Date.now();
      if (now - lastCheck < BUILD_CHECK_INTERVAL_MS) return;
      lastCheck = now;
      inFlight = true;
      try {
        const res = await fetch('/api/health', {cache: 'no-store'});
        if (res.ok && isOtherBuild(tabBuild, await res.json())) appNotices.reportOutdated();
      } catch {
        // No answer says nothing about which build runs — the server may be
        // restarting. The next return to the tab asks again.
      } finally {
        inFlight = false;
      }
    };

    const onReturn = () => void check();
    document.addEventListener('visibilitychange', onReturn);
    window.addEventListener('focus', onReturn);
    window.addEventListener('online', onReturn);
    return () => {
      document.removeEventListener('visibilitychange', onReturn);
      window.removeEventListener('focus', onReturn);
      window.removeEventListener('online', onReturn);
    };
  }, [tabBuild]);
}
