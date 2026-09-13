/**
 * What the whole app keeps saying until it stops being true (ADR-0010).
 *
 * A refusal or a failed call is reported where the button was pressed, in a
 * toast that is gone a few seconds later. Two states outlive that moment and
 * concern every button on the page, so they are held here and shown by
 * `AppNotices` until they end:
 *
 * - the tab runs a build the server no longer has — every action call will fail
 *   the same way until the page is reloaded, so this never clears by itself;
 * - an action answered that nobody is signed in — cleared by the next answer
 *   that is anything else. Every action checks the session before anything
 *   else (ADR-0009), so any other answer proves the session is back, which is
 *   what signing in again in another tab leads to.
 *
 * A module-level store rather than a context: `callAction` reports from outside
 * React, and a context would need a provider wrapped around every caller.
 */

export interface AppNoticesState {
  /** The tab runs a build the server no longer has. */
  outdated: boolean;
  /** An action answered that nobody is signed in. */
  sessionEnded: boolean;
}

const NONE: AppNoticesState = {outdated: false, sessionEnded: false};

let state: AppNoticesState = NONE;
const listeners = new Set<() => void>();

function update(next: Partial<AppNoticesState>): void {
  const merged = {...state, ...next};
  if (merged.outdated === state.outdated && merged.sessionEnded === state.sessionEnded) return;
  state = merged;
  for (const listener of listeners) listener();
}

export const appNotices = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot: (): AppNoticesState => state,
  /** The server renders no notice: nothing has been called yet. */
  getServerSnapshot: (): AppNoticesState => NONE,

  reportOutdated: (): void => update({outdated: true}),
  reportSessionEnded: (): void => update({sessionEnded: true}),
  reportSessionAlive: (): void => update({sessionEnded: false}),
  /** The reader has seen it. The next refusal of the same kind brings it back. */
  dismissSessionEnded: (): void => update({sessionEnded: false}),
};
