/**
 * What a list or a live reading keeps on screen when a refresh brings nothing.
 *
 * Before this, every answer replaced what was shown, refusals included. A list
 * that polls lost its rows to a one-second drop in the connection and got them
 * back only at the next good poll; the server summary, polling every four
 * seconds, blinked out the same way. The rows that were on screen were still
 * the best thing the app knew.
 *
 * So a refusal after data keeps the data and says why it is no longer fresh; a
 * refusal before any data is shown as it always was. When the data was fetched
 * travels with it — the local copy is a cache with a timestamp, not the truth,
 * and a screen that keeps old rows must say how old they are.
 *
 * Pure, so it is tested without rendering anything.
 */

export interface Settled<T extends {ok: boolean}> {
  /** What is on screen: the newest answer with data — or, while there never was any, the refusal. */
  result: T;
  /** Why the latest refresh brought nothing while older data stays on screen; null otherwise. */
  failure: string | null;
  /** When the data on screen was fetched in this tab; null when that is not known. */
  fetchedAt: Date | null;
}

/** The starting point: what the page arrived with, fetched at a moment this tab did not see. */
export function settled<T extends {ok: boolean}>(initial: T, fetchedAt: Date | null = null): Settled<T> {
  return {result: initial, failure: null, fetchedAt};
}

export function settleRefresh<T extends {ok: boolean}>(previous: Settled<T>, next: T, at: Date): Settled<T> {
  if (next.ok) return {result: next, failure: null, fetchedAt: at};
  if (previous.result.ok) {
    return {result: previous.result, failure: refusalOf(next), fetchedAt: previous.fetchedAt};
  }
  return {result: next, failure: null, fetchedAt: previous.fetchedAt};
}

/** A refusal carries its reason in `message` or in `error`, depending on the action. */
function refusalOf(answer: unknown): string {
  const {message, error} = answer as {message?: unknown; error?: unknown};
  if (typeof message === 'string' && message) return message;
  if (typeof error === 'string' && error) return error;
  return 'failed';
}
