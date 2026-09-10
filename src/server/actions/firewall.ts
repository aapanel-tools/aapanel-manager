'use server';
import {requireUser} from '@/lib/auth/guards';
import {createClientForServer, presentError} from '@/lib/aapanel';
import {serverLabel} from '@/lib/servers/label';
import type {FirewallOverview, FirewallRule, SourceFailure, SourceTruncation} from '@/lib/aapanel';
import {prisma} from '@/lib/db/prisma';
import {log} from '@/log';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type FirewallOverviewResult =
  /** `overview.failures` says which half of the summary is missing and why. */
  {ok: true; overview: FirewallOverview} | {ok: false; message: string};

export type FirewallRulesResult =
  | {ok: true; rules: FirewallRule[]; failures: SourceFailure[]; truncations: SourceTruncation[]}
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
 * Whether the firewall is on, what runs it, and how much it holds.
 *
 * Requires an authenticated user (any role), and writes no journal entry:
 * reading changes nothing on the panel, and a line per page view would bury the
 * entries that matter.
 *
 * Only the reading side of this API exists here, and that is deliberate rather
 * than unfinished. A wrong port rule locks everyone out of the server, the
 * panel included, so the writing side was never exercised on a live host and
 * has no captured request to build on.
 */
export async function getFirewallOverviewAction(
  serverId: string,
): Promise<FirewallOverviewResult> {
  try {
    await requireUser();
  } catch {
    return {ok: false, message: 'unauthenticated'};
  }
  try {
    const creds = await loadServerCreds(serverId);
    const client = await createClientForServer(creds);
    const overview = await client.getFirewallOverview();
    if (overview.failures.length > 0) {
      log.warn({serverId, failures: overview.failures}, 'getFirewallOverviewAction partial');
    }
    return {ok: true, overview};
  } catch (err) {
    log.error({err, serverId}, 'getFirewallOverviewAction failed');
    return {ok: false, message: await presentError(err, await serverLabel(serverId))};
  }
}

/**
 * The port rules, optionally narrowed by a search term.
 *
 * The term goes to the panel rather than filtering what came back, for the same
 * reason it does everywhere else: the rule worth finding may be one of the ones
 * past the row limit, and a browser-side filter would search inside the page it
 * already showed (Д-16, Ф-14).
 */
export async function listFirewallRulesAction(
  serverId: string,
  search?: string,
): Promise<FirewallRulesResult> {
  try {
    await requireUser();
  } catch {
    return {ok: false, message: 'unauthenticated'};
  }
  try {
    const creds = await loadServerCreds(serverId);
    const client = await createClientForServer(creds);
    const {items, failures, truncations} = await client.listFirewallRules({search});
    // A short list of open ports that looks complete is a false statement about
    // a client's exposure, which is the worst place in this app to make one.
    if (failures.length > 0) log.warn({serverId, failures}, 'listFirewallRulesAction partial');
    if (truncations.length > 0) log.warn({serverId, truncations}, 'listFirewallRulesAction truncated');
    return {ok: true, rules: items, failures, truncations};
  } catch (err) {
    log.error({err, serverId}, 'listFirewallRulesAction failed');
    return {ok: false, message: await presentError(err, await serverLabel(serverId))};
  }
}
