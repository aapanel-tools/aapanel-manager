export type Settled<T> = {ok: true; value: T} | {ok: false; error: Error};

/**
 * Maps over `items` running at most `limit` tasks at once, preserving order.
 * Per-item failures are captured (allSettled-style) so one bad item never
 * fails the whole batch.
 */
export async function mapLimit<I, O>(
  items: readonly I[],
  limit: number,
  fn: (item: I, index: number) => Promise<O>,
): Promise<Array<Settled<O>>> {
  const results = new Array<Settled<O>>(items.length);
  let cursor = 0;
  const size = Math.max(1, Math.min(limit, items.length || 1));

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const i = cursor++;
      try {
        results[i] = {ok: true, value: await fn(items[i], i)};
      } catch (err) {
        results[i] = {ok: false, error: err instanceof Error ? err : new Error(String(err))};
      }
    }
  }

  await Promise.all(Array.from({length: size}, () => worker()));
  return results;
}
