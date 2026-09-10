'use client';

import {useTranslations} from 'next-intl';
import type {SourceFailure, SourceTruncation} from '@/lib/aapanel';

/**
 * Why a source did not answer, in the operator's language.
 *
 * The banner used to print the raw exception — "sites: fetch failed
 * (ECONNREFUSED)" — which is the technical truth and nearly useless to the
 * person reading it. The failure already carries its kind, so the frame can be
 * said properly and the raw text kept beside it as detail, exactly as
 * presentError() does on the server (Д-21).
 *
 * Literal keys rather than tp(f.kind): messages.test.ts skips dynamic keys, and
 * a template literal here would put these five strings back outside the gate.
 */
function failureReason(
  failure: SourceFailure,
  tp: (key: string, values?: Record<string, string>) => string,
): string {
  const phrase = (() => {
    switch (failure.kind) {
      case 'network':
        return tp('network');
      case 'timeout':
        return tp('timeout');
      case 'auth':
        return tp('auth');
      case 'panel_error':
        return tp('panel_error');
      case 'tls_pin_mismatch':
        return tp('tls_pin_mismatch');
      default:
        return tp('unknown');
    }
  })();
  // Dropped when it only repeats the phrase, so nobody is shown one sentence twice.
  return failure.message && failure.message !== phrase
    ? tp('withDetail', {message: phrase, detail: failure.message})
    : phrase;
}

export interface ListIntegrityNoticeProps {
  failures: SourceFailure[];
  truncations: SourceTruncation[];
  /**
   * Turns a source key into the word this section uses for it — 'mysql' into
   * "MySQL", say. Left out where the key is already the word.
   */
  labelSource?: (source: string) => string;
  /**
   * Heading for the failures block. Defaults to the list wording, which is
   * wrong for a card: "the list is incomplete" describes nothing an operator
   * is looking at when half a site's card failed to load.
   */
  failuresTitle?: string;
}

/**
 * Says how a list falls short of the truth, when it does.
 *
 * Two ways that happens, and they are different enough to name separately: a
 * source refused to answer, or a source answered with more rows than were read.
 * Both end in the same place — a list shorter than reality that looks complete —
 * which is how an operator concludes a site or a database was deleted (ADR-0003).
 *
 * One component for all three sections rather than a banner per table: this text
 * is the promise the app makes about its own lists, and a promise worded three
 * ways in three places is three promises.
 *
 * Renders nothing when the list is whole, which is the ordinary case.
 */
export function ListIntegrityNotice({
  failures,
  truncations,
  labelSource = (s) => s,
  failuresTitle,
}: ListIntegrityNoticeProps) {
  const t = useTranslations('listNotice');
  // A second namespace on purpose: the phrase for a kind of panel failure is
  // the same one presentError() uses on the server, and two catalogues of the
  // same five sentences would drift.
  const tp = useTranslations('panelError');

  if (failures.length === 0 && truncations.length === 0) return null;

  return (
    <div
      className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
      role="status"
    >
      {failures.length > 0 && (
        <>
          <p className="font-medium">{failuresTitle ?? t('incompleteTitle')}</p>
          <ul className="mt-1 space-y-0.5 text-xs opacity-80">
            {failures.map((f) => (
              <li key={`f-${f.source}`}>
                {t('failureLine', {source: labelSource(f.source), reason: failureReason(f, tp)})}
              </li>
            ))}
          </ul>
        </>
      )}

      {truncations.length > 0 && (
        <>
          <p className={failures.length > 0 ? 'mt-2 font-medium' : 'font-medium'}>
            {t('truncatedTitle')}
          </p>
          <ul className="mt-1 space-y-0.5 text-xs opacity-80">
            {truncations.map((c) => (
              <li key={`t-${c.source}`}>
                {/* A total the panel did not give is never printed as a number:
                    "of 0 more" would be an invention, and this notice exists
                    precisely because inventions about list length mislead. */}
                {c.total === null
                  ? t('truncatedUnknown', {source: labelSource(c.source), shown: c.shown})
                  : t('truncatedKnown', {
                      source: labelSource(c.source),
                      shown: c.shown,
                      total: c.total,
                    })}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
