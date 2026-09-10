'use client';

import {useCallback} from 'react';
import {useTranslations} from 'next-intl';

/**
 * The refusals an action gives for its own reasons, rather than the panel's.
 *
 * A closed set, and short strings on purpose: they are machine-readable codes
 * that tests assert against and callers branch on, not sentences. Turning one
 * into a sentence is this module's job, and it happens in the browser, where
 * the locale belongs to the person about to read it — the same division
 * presentError() draws for panel failures.
 */
export type ActionErrorCode =
  /** Nobody is logged in. */
  | 'unauthenticated'
  /** Logged in, but not an administrator. */
  | 'forbidden'
  /** The submitted form did not pass its schema; see `fieldErrors` for which field. */
  | 'validation'
  /** The typed confirmation phrase did not match. */
  | 'confirm'
  /** The request asked for something that is not one of the allowed operations. */
  | 'invalid'
  /** The action came apart for an unforeseen reason; the details are in the log. */
  | 'failed'
  /** The thing being acted on is not there any more. */
  | 'notFound';

const CODES: ReadonlySet<string> = new Set<ActionErrorCode>([
  'unauthenticated',
  'forbidden',
  'validation',
  'confirm',
  'invalid',
  'failed',
  'notFound',
]);

/**
 * Older spellings of the codes above, kept working rather than renamed.
 *
 * `confirmMismatch` and `confirm` are one refusal with two names, and
 * `missing id`, `api_sk required` and `empty path` are all "the request did not
 * carry what it needed" written out by hand before there was a word for it.
 * Renaming them at the source would change what several actions return and what
 * their tests assert, for no gain an operator could see; recognising them here
 * costs five lines and closes the same hole.
 */
const ALIASES: ReadonlyMap<string, ActionErrorCode> = new Map([
  ['confirmMismatch', 'confirm' as const],
  ['missing id', 'validation' as const],
  ['api_sk required', 'validation' as const],
  ['empty path', 'validation' as const],
]);

/**
 * Is this one of the codes above, or is it already a sentence?
 *
 * Pure and exported so it can be tested without rendering anything, and so a
 * caller with its own domain vocabulary can ask before reaching for its own.
 */
export function isActionErrorCode(raw: unknown): raw is ActionErrorCode {
  return typeof raw === 'string' && (CODES.has(raw) || ALIASES.has(raw));
}

/** The canonical code for a refusal, or null when it is already a sentence. */
export function actionErrorCode(raw: unknown): ActionErrorCode | null {
  if (typeof raw !== 'string') return null;
  if (CODES.has(raw)) return raw as ActionErrorCode;
  return ALIASES.get(raw) ?? null;
}

/**
 * Turns an action's refusal into a sentence the reader can act on.
 *
 * Д-21 translated what the panel says when it fails. This is the other half:
 * an action also refuses for reasons of its own — wrong role, a form that did
 * not validate, a confirmation phrase that did not match — and those arrived as
 * bare English tokens in the middle of a translated interface. An operator
 * pressing Delete was shown `forbidden`.
 *
 * Anything that is not one of the known codes is passed through untouched: by
 * the time a message reaches here it is usually already a sentence, produced by
 * presentError() in the reader's own language, and re-wording it would replace
 * a specific explanation with a generic one.
 *
 * `fallback` is for callers that have their own vocabulary on top of these —
 * the job queue and the updater both do. They translate what they know and hand
 * the rest here, so that a code nobody has a phrase for still cannot reach an
 * operator as a raw token.
 *
 * The keys are read through a switch over literals rather than `t(code)`.
 * messages.test.ts skips dynamic keys on purpose, so the shorter version would
 * put every one of these strings back outside the gate — the blind spot Д-17
 * and Д-20 were both about.
 */
export function useActionError(): (raw: string, fallback?: string) => string {
  const t = useTranslations('actionError');

  return useCallback(
    (raw: string, fallback?: string): string => {
      switch (actionErrorCode(raw)) {
        case 'unauthenticated':
          return t('unauthenticated');
        case 'forbidden':
          return t('forbidden');
        case 'validation':
          return t('validation');
        case 'confirm':
          return t('confirm');
        case 'invalid':
          return t('invalid');
        case 'failed':
          return t('failed');
        case 'notFound':
          return t('notFound');
        default:
          return fallback ?? raw;
      }
    },
    [t],
  );
}
