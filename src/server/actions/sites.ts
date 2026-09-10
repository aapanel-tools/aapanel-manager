'use server';
import {requireUser} from '@/lib/auth/guards';
import {createClientForServer, presentError} from '@/lib/aapanel';
import {serverLabel} from '@/lib/servers/label';
import type {Site, SiteDetail, SourceFailure, SourceTruncation} from '@/lib/aapanel';
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

export type SiteDetailResult =
  /** `detail.failures` says which parts of the card are missing and why. */
  {ok: true; detail: SiteDetail} | {ok: false; message: string};

export type SiteLogsResult = {ok: true; logs: string} | {ok: false; message: string};

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
 * Lists the sites on a server, optionally narrowed by a search term.
 *
 * Requires an authenticated user (any role).
 *
 * Reading only, and no audit entry: the journal records what changed on someone
 * else's production machine, and looking at a list changes nothing. Writing a
 * line per page view would bury the entries that matter.
 */
export async function listSitesAction(
  serverId: string,
  search?: string,
): Promise<SiteListResult> {
  try {
    await requireUser();
  } catch {
    return {ok: false, message: 'unauthenticated'};
  }
  try {
    const creds = await loadServerCreds(serverId);
    const client = await createClientForServer(creds);
    // The term goes to the panel rather than filtering what came back: the
    // rows a search is meant to find may be the ones beyond the row limit, and
    // filtering here would search inside the same page it already showed.
    // Length and shape are settled in the client (normalizeSearch).
    const {items, failures, truncations} = await client.listSites({search});
    // A partial answer is reported, never smoothed over: a shorter list that
    // looks complete is how an operator concludes a site was deleted (ADR-0003).
    if (failures.length > 0) log.warn({serverId, failures}, 'listSitesAction partial result');
    if (truncations.length > 0) log.warn({serverId, truncations}, 'listSitesAction truncated');
    return {ok: true, sites: items, failures, truncations};
  } catch (err) {
    log.error({err, serverId}, 'listSitesAction failed');
    return {ok: false, message: await presentError(err, await serverLabel(serverId))};
  }
}

/**
 * Loads the card for one site: domains, directory, SSL, PHP version.
 *
 * Read-only and unaudited, for the same reason the list is: the journal records
 * what changed on someone else's production machine, and opening a card changes
 * nothing.
 *
 * The site is passed in whole rather than looked up by id, because three of the
 * four panel calls identify a site by its primary domain and one needs the
 * document root. Re-fetching the list here to rediscover those would be a
 * second request for data the caller is already looking at.
 */
export async function getSiteDetailAction(
  serverId: string,
  site: {id: number; name: string; path: string},
): Promise<SiteDetailResult> {
  try {
    await requireUser();
  } catch {
    return {ok: false, message: 'unauthenticated'};
  }
  try {
    const creds = await loadServerCreds(serverId);
    const client = await createClientForServer(creds);
    const detail = await client.getSiteDetail(site);
    if (detail.failures.length > 0) {
      log.warn({serverId, siteId: site.id, failures: detail.failures}, 'getSiteDetailAction partial');
    }
    return {ok: true, detail};
  } catch (err) {
    log.error({err, serverId, siteId: site.id}, 'getSiteDetailAction failed');
    return {ok: false, message: await presentError(err, await serverLabel(serverId))};
  }
}

/**
 * Tail of a site's access log. Separate from the card so it is fetched only
 * when someone opens that tab — see the client method for why.
 */
export async function getSiteLogsAction(
  serverId: string,
  siteName: string,
): Promise<SiteLogsResult> {
  try {
    await requireUser();
  } catch {
    return {ok: false, message: 'unauthenticated'};
  }
  try {
    const creds = await loadServerCreds(serverId);
    const client = await createClientForServer(creds);
    return {ok: true, logs: await client.getSiteLogs(siteName)};
  } catch (err) {
    log.error({err, serverId}, 'getSiteLogsAction failed');
    return {ok: false, message: await presentError(err, await serverLabel(serverId))};
  }
}
