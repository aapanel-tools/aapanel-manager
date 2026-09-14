import {mapLimit} from '@/lib/utils/concurrency';
import {errInfo} from '@/lib/safe-error';
import {ServerNotFoundError} from '@/lib/servers/creds';
import {log} from '@/log';

export interface CycleResult {
  total: number;
  online: number;
  offline: number;
  /** Servers whose refresh threw rather than answered: a failure on our side, not a panel that is down. */
  failed: number;
}

export type RefreshFn = (serverId: string) => Promise<{ok: boolean; online: boolean}>;

/** How many failed servers one log line names; the count covers the rest. */
const EXAMPLES = 3;

/**
 * Polls all ids with bounded concurrency. Per-item failures are isolated by mapLimit.
 *
 * A panel that does not answer is not a failure here: refreshServerStatus records
 * it as offline and says so itself. A refresh that throws is something else — the
 * database, most often — and used to vanish at this point: counted as offline and
 * written nowhere, so a database outage looked like the whole fleet going dark
 * with nothing in the log (Д-37). It is now one line per cycle, with the count and
 * a few examples, rather than a line per server that would flood the log for as
 * long as the outage lasts. A server removed while the cycle ran is not a failure.
 */
export async function runPollCycle(ids: string[], concurrency: number, refresh: RefreshFn): Promise<CycleResult> {
  const results = await mapLimit(ids, concurrency, (id) => refresh(id));
  let online = 0;
  let removed = 0;
  const failures: Array<{serverId: string; err: {message: string; code?: string}}> = [];

  results.forEach((r, i) => {
    if (r.ok) {
      if (r.value.online) online++;
    } else if (r.error instanceof ServerNotFoundError) {
      removed++;
    } else {
      failures.push({serverId: ids[i]!, err: errInfo(r.error)});
    }
  });

  if (removed > 0) log.debug({removed}, 'poller: servers removed while the cycle ran');
  if (failures.length > 0) {
    log.error({failed: failures.length, examples: failures.slice(0, EXAMPLES)}, 'poller: servers could not be refreshed');
  }
  return {total: ids.length, online, offline: ids.length - online, failed: failures.length};
}
