import 'server-only';
import {prisma} from '@/lib/db/prisma';
import {loadServerCreds} from '@/lib/servers/creds';
import {AaPanelError, createClientForServer, describeError} from '@/lib/aapanel';
import type {FailureKind} from '@/lib/aapanel/types';
import {notifyServerChanged} from '@/lib/realtime/notify';
import {log} from '@/log';

export interface RefreshResult {
  ok: boolean;
  online: boolean;
  /**
   * What the poll failed with, exactly as it was thrown, for a caller inside a
   * request to put into its reader's words with presentError(). Stays on the
   * server: no caller returns it to the browser as it is.
   */
  error?: unknown;
}

/** Polls one server live, writes the result to the cache, notifies listeners.
 *  Shared by manual refresh (Server Actions) and the background worker. Never throws
 *  for poll failures — returns {ok:false}. A missing server throws ServerNotFoundError (creds.ts). */
export async function refreshServerStatus(serverId: string): Promise<RefreshResult> {
  const server = await loadServerCreds(serverId);
  const now = new Date();
  try {
    const snap = await (await createClientForServer(server)).collectStatus();
    const healthy = {online: true, cpu: snap.cpu, mem: snap.mem, disk: snap.disk, error: null, errorKind: null};
    await prisma.serverStatus.upsert({
      where: {serverId},
      create: {serverId, ...healthy, lastCheckedAt: now},
      update: {...healthy, lastCheckedAt: now},
    });
    await notifyServerChanged({serverId, online: true});
    return {ok: true, online: true};
  } catch (err) {
    const failure = storedFailure(err);
    await prisma.serverStatus.upsert({
      where: {serverId},
      create: {serverId, online: false, ...failure, lastCheckedAt: now},
      update: {online: false, ...failure, lastCheckedAt: now},
    });
    await notifyServerChanged({serverId, online: false});
    // The whole technical sentence, the app's own failures included, is kept here
    // and only here — the stored row carries what an operator may be shown.
    log.warn({serverId, message: describeError(err)}, 'server poll failed');
    return {ok: false, online: false, error: err};
  }
}

/**
 * What of a failed poll is kept for the fleet summary (ADR-0012).
 *
 * The kind, from which the summary builds a phrase in its reader's language, and
 * the panel's own words — "IP not in the whitelist" is what an operator should
 * read before opening the server. Not describeError()'s English sentence: a stored
 * copy was shown as it was in a Russian interface. And not the text of the app's
 * own failure, which is Prisma's or the crypto library's and reaches everyone who
 * opens the summary (Д-35).
 */
function storedFailure(err: unknown): {errorKind: FailureKind; error: string | null} {
  if (err instanceof AaPanelError) return {errorKind: err.kind, error: err.message || null};
  return {errorKind: 'unknown', error: null};
}
