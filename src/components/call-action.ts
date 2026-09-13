import {unstable_isUnrecognizedActionError, unstable_rethrow} from 'next/navigation';
import {appNotices} from '@/components/app-notices-store';
import {actionErrorCode} from '@/components/use-action-error';

/**
 * Why a call to a server action produced no answer at all (ADR-0010).
 *
 * Distinct from a refusal: a refusal is an answer, `{ok: false, …}`, and every
 * caller already puts it into words. These are the cases where the call itself
 * threw, and the answer never came:
 *
 * - `outdated` — the action is not in the build the server runs now. After a
 *   self-update this is certain for every tab opened before it;
 * - `unreachable` — the request did not get through (the browser's fetch
 *   rejects with a TypeError);
 * - `failed` — anything else, such as a 500 or a body over the size limit; the
 *   details are in the server's log.
 */
export type CallFailureCode = 'outdated' | 'unreachable' | 'failed';

export function classifyCallError(err: unknown): CallFailureCode {
  if (unstable_isUnrecognizedActionError(err)) return 'outdated';
  if (err instanceof TypeError) return 'unreachable';
  return 'failed';
}

/** A failure in the shape of answers that carry their refusal in `message`. */
export const asMessage = (code: CallFailureCode): {ok: false; message: string} => ({ok: false, message: code});

/** A failure in the shape of answers that carry their refusal in `error`. */
export const asError = (code: CallFailureCode): {ok: false; error: string} => ({ok: false, error: code});

/**
 * Calls a server action so that a failed call becomes an answer, not an exception.
 *
 * Without it the exception went one of three ways, all seen on 2026-09-13
 * (Д-31): into nothing, when the call sat in a list refresh or a poll; into the
 * section's error boundary, replacing the page and an open dialog with what was
 * typed in it; or into Next's own error page instead of the whole app.
 *
 * `failure` shapes the code like this caller's refusals, so the caller's
 * existing `!res.ok` branch shows it — translated by `useActionError`, like any
 * other refusal. Navigation that an action asks for (`redirect`, `notFound`) is
 * not a failure and is passed on.
 *
 * The outcome is also reported to the app-wide notices: a build the server no
 * longer has, and a session that ended, concern every button on the page and
 * must outlast the toast.
 */
export async function callAction<T, F>(
  invoke: () => Promise<T>,
  failure: (code: CallFailureCode) => F,
): Promise<T | F> {
  let result: T;
  try {
    result = await invoke();
  } catch (err) {
    unstable_rethrow(err);
    const code = classifyCallError(err);
    if (code === 'outdated') appNotices.reportOutdated();
    // The two expected cases are fully said by their phrase. An unforeseen one
    // is kept for whoever opens the console: the phrase only points at the log.
    if (code === 'failed') console.error(err);
    return failure(code);
  }
  noteAnswer(result);
  return result;
}

/**
 * Every action checks the session before anything else (ADR-0009), so an
 * answer is either "nobody is signed in" or proof that somebody is.
 */
function noteAnswer(result: unknown): void {
  if (!result || typeof result !== 'object' || !('ok' in result)) return;
  const {message, error} = result as {message?: unknown; error?: unknown};
  if (actionErrorCode(message) === 'unauthenticated' || actionErrorCode(error) === 'unauthenticated') {
    appNotices.reportSessionEnded();
  } else {
    appNotices.reportSessionAlive();
  }
}
