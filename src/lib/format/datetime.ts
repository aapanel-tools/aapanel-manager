/**
 * One timestamp shape for the whole app: `YYYY-MM-DD HH:MM[:SS]` in UTC.
 *
 * Not localised and never relative, and both halves of that are deliberate.
 *
 * A locale-formatted date rendered on the server and re-rendered in the browser
 * disagrees with itself — different timezone, different locale — and React
 * reports a hydration mismatch. A relative one ("2 minutes ago") has a worse
 * failure: computed on the server, it is frozen at render time, so a cached page
 * keeps telling the reader that a stale reading is fresh. This app treats the
 * age of cached data as evidence about a machine it cannot see, which makes a
 * timestamp that quietly stops advancing the wrong kind of wrong.
 *
 * Four copies of this existed before it did — two job pages, the audit table and
 * the users table — which is how the users table ended up with a different
 * precision from the rest by accident rather than by decision. `precision`
 * preserves that difference deliberately: account creation dates do not need
 * seconds, operation logs do.
 */
export function formatTimestamp(value: Date | string, precision: 'minutes' | 'seconds' = 'seconds'): string {
  const iso = typeof value === 'string' ? value : value.toISOString();
  return iso.slice(0, precision === 'minutes' ? 16 : 19).replace('T', ' ');
}

/** The same, for a moment that may not have happened yet (a job never started). */
export function formatTimestampOrNull(
  value: Date | null | undefined,
  precision: 'minutes' | 'seconds' = 'seconds',
): string | null {
  return value ? formatTimestamp(value, precision) : null;
}
