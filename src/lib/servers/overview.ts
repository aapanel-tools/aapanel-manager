import 'server-only';
import {prisma} from '@/lib/db/prisma';
import {parseEnv} from '@/env';
import {asFailureKind} from '@/lib/aapanel/failure-phrase';
import type {FailureKind} from '@/lib/aapanel/types';

/**
 * Read model for the fleet summary (Ф-7).
 *
 * Reads only the local cache — never a panel. The summary is the first screen
 * of the day and must open in one query round-trip whatever the fleet size;
 * polling every server to render it would turn opening the app into a burst of
 * traffic against every customer machine at once, which is the thing ADR-0004
 * exists to prevent.
 *
 * The price of that is age: what is shown was true at `lastCheckedAt`, not now.
 * The domain invariant is explicit that the truth lives on the server and the
 * local copy is a cache with a timestamp, so staleness is reported as its own
 * kind of trouble rather than passed off as a healthy reading.
 */

/** Why a server is on the attention list. Ordered worst-first by the reader's cost. */
export type AttentionReason = 'offline' | 'stale' | 'disk' | 'memory';

export interface AttentionRow {
  id: string;
  name: string;
  tag: string | null;
  reason: AttentionReason;
  /** Percent for 'disk' and 'memory'; null for the other reasons. */
  value: number | null;
  /** Last successful or attempted poll; null when never polled. */
  lastCheckedAt: Date | null;
  /**
   * What the last poll failed with, for the summary to put into its reader's
   * words (ADR-0012). Null when it did not fail — or failed before the kind was
   * stored, in which case there is nothing trustworthy to word.
   */
  errorKind: FailureKind | null;
  /** The panel's own words for that failure, when it gave any. Never the app's own text. */
  error: string | null;
}

export interface FleetCounts {
  total: number;
  online: number;
  offline: number;
  /** Added but never polled yet — different from "polled and found down". */
  unchecked: number;
}

export interface FleetOverview {
  counts: FleetCounts;
  attention: AttentionRow[];
  thresholds: {diskWarnPercent: number; memWarnPercent: number; staleAfterMs: number};
}

/**
 * A reading is stale after three poll intervals.
 *
 * One interval would flag every server the moment a cycle runs late; three is
 * long enough that a missed cycle is a pattern rather than a hiccup, and short
 * enough that a poller which died is noticed within minutes rather than hours.
 */
const STALE_INTERVALS = 3;

/**
 * The last poll's failure, as the summary may show it (ADR-0012).
 *
 * A row written before the kind was stored holds describeError()'s English
 * sentence in `error`. That is not the panel's words, so it is not shown; the next
 * poll rewrites the row within one interval. A kind this build does not know
 * reads as the app's own failure, and the app's own failure has no words to show.
 */
function shownFailure(st: {errorKind: string | null; error: string | null}): {
  errorKind: FailureKind | null;
  error: string | null;
} {
  if (st.errorKind === null) return {errorKind: null, error: null};
  const errorKind = asFailureKind(st.errorKind);
  return {errorKind, error: errorKind === 'unknown' ? null : st.error};
}

/** Worst first: a server that is down costs more than one that is merely full. */
const REASON_RANK: Record<AttentionReason, number> = {offline: 0, stale: 1, disk: 2, memory: 3};

export async function getFleetOverview(now: Date = new Date()): Promise<FleetOverview> {
  const env = parseEnv();
  const staleAfterMs = env.POLL_INTERVAL_MS * STALE_INTERVALS;
  const staleBefore = new Date(now.getTime() - staleAfterMs);

  const [total, online, offline, records] = await Promise.all([
    prisma.server.count(),
    prisma.server.count({where: {status: {is: {online: true}}}}),
    prisma.server.count({where: {status: {is: {online: false}}}}),
    // Candidates only: a server is interesting when it is down, or its reading is
    // old, or a resource crossed its threshold. Filtering in the database keeps
    // this bounded on a fleet of hundreds instead of loading every row to drop
    // most of them in JS.
    prisma.server.findMany({
      where: {
        OR: [
          {status: {is: null}},
          {status: {is: {online: false}}},
          {status: {is: {lastCheckedAt: {lt: staleBefore}}}},
          {status: {is: {disk: {gte: env.FLEET_DISK_WARN_PERCENT}}}},
          {status: {is: {mem: {gte: env.FLEET_MEM_WARN_PERCENT}}}},
        ],
      },
      select: {
        id: true,
        name: true,
        tag: true,
        status: {
          select: {online: true, mem: true, disk: true, error: true, errorKind: true, lastCheckedAt: true},
        },
      },
    }),
  ]);

  const attention: AttentionRow[] = [];
  for (const s of records) {
    const st = s.status;
    // Never polled: counted separately below, and not worth a row of its own —
    // "we have not looked yet" is not a problem with the server.
    if (!st) continue;

    const base = {id: s.id, name: s.name, tag: s.tag, lastCheckedAt: st.lastCheckedAt, ...shownFailure(st)};
    if (!st.online) {
      attention.push({...base, reason: 'offline', value: null});
    } else if (st.lastCheckedAt < staleBefore) {
      // Only for a server that looks up: an offline one is already reported, and
      // reporting it twice would push a live problem down the list.
      attention.push({...base, reason: 'stale', value: null});
    } else if (st.disk !== null && st.disk >= env.FLEET_DISK_WARN_PERCENT) {
      attention.push({...base, reason: 'disk', value: st.disk});
    } else if (st.mem !== null && st.mem >= env.FLEET_MEM_WARN_PERCENT) {
      attention.push({...base, reason: 'memory', value: st.mem});
    }
  }

  attention.sort((a, b) => {
    const byReason = REASON_RANK[a.reason] - REASON_RANK[b.reason];
    if (byReason !== 0) return byReason;
    // Within a reason, the fuller disk (or the older reading) comes first.
    if (a.value !== null && b.value !== null && a.value !== b.value) return b.value - a.value;
    const at = a.lastCheckedAt?.getTime() ?? 0;
    const bt = b.lastCheckedAt?.getTime() ?? 0;
    return at - bt;
  });

  return {
    counts: {total, online, offline, unchecked: total - online - offline},
    attention,
    thresholds: {
      diskWarnPercent: env.FLEET_DISK_WARN_PERCENT,
      memWarnPercent: env.FLEET_MEM_WARN_PERCENT,
      staleAfterMs,
    },
  };
}
