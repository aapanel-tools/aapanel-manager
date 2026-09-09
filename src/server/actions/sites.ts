'use server';
import {requireUser} from '@/lib/auth/guards';
import {createClientForServer, describeError} from '@/lib/aapanel';
import {serverLabel} from '@/lib/servers/label';
import type {Site, SourceFailure, SourceTruncation} from '@/lib/aapanel';
import {prisma} from '@/lib/db/prisma';
import {log} from '@/log';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type SiteListResult =
  /**
   * `failures` lists sources that did not answer, `truncations` sources that had
   * more rows than were read. Both empty means the list is complete — and says so.
   */
  | {ok: true; sites: Site[]; failures: SourceFailure[]; truncations: SourceTruncation[]}
  | {ok: false; message: string};

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

async function loadServerCreds(id: string) {
  return prisma.server.findUniqueOrThrow({
    where: {id},
    select: {id: true, baseUrl: true, apiSkEnc: true, tlsMode: true, tlsPinSha256: true},
  });
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Lists the sites on a server. Requires an authenticated user (any role).
 *
 * Reading only, and no audit entry: the journal records what changed on someone
 * else's production machine, and looking at a list changes nothing. Writing a
 * line per page view would bury the entries that matter.
 */
export async function listSitesAction(serverId: string): Promise<SiteListResult> {
  try {
    await requireUser();
  } catch {
    return {ok: false, message: 'unauthenticated'};
  }
  try {
    const creds = await loadServerCreds(serverId);
    const client = await createClientForServer(creds);
    const {items, failures, truncations} = await client.listSites();
    // A partial answer is reported, never smoothed over: a shorter list that
    // looks complete is how an operator concludes a site was deleted (ADR-0003).
    if (failures.length > 0) log.warn({serverId, failures}, 'listSitesAction partial result');
    if (truncations.length > 0) log.warn({serverId, truncations}, 'listSitesAction truncated');
    return {ok: true, sites: items, failures, truncations};
  } catch (err) {
    log.error({err, serverId}, 'listSitesAction failed');
    return {ok: false, message: describeError(err, await serverLabel(serverId))};
  }
}
