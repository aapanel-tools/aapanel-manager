import {mapLimit} from '@/lib/utils/concurrency';

export interface CycleResult {
  total: number;
  online: number;
  offline: number;
}

export type RefreshFn = (serverId: string) => Promise<{ok: boolean; online: boolean}>;

/** Polls all ids with bounded concurrency. Per-item failures are isolated by mapLimit. */
export async function runPollCycle(ids: string[], concurrency: number, refresh: RefreshFn): Promise<CycleResult> {
  const results = await mapLimit(ids, concurrency, (id) => refresh(id));
  let online = 0;
  for (const r of results) if (r.ok && r.value.online) online++;
  return {total: ids.length, online, offline: ids.length - online};
}
