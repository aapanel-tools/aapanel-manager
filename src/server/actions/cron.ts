'use server';
import {requireUser} from '@/lib/auth/guards';
import {createClientForServer, presentError} from '@/lib/aapanel';
import {serverLabel} from '@/lib/servers/label';
import type {CronTask, SourceFailure, SourceTruncation} from '@/lib/aapanel';
import {prisma} from '@/lib/db/prisma';
import {log} from '@/log';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type CronListResult =
  /**
   * `failures` lists sources that did not answer. `truncations` is carried for
   * the same shape as the other lists and is always empty here: the scheduler's
   * endpoint takes no row limit, so nothing on our side can shorten the list.
   */
  | {ok: true; tasks: CronTask[]; failures: SourceFailure[]; truncations: SourceTruncation[]}
  | {ok: false; message: string};

export type CronLogsResult = {ok: true; logs: string} | {ok: false; message: string};

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
 * Lists the scheduled tasks on a server, optionally narrowed by a search term.
 *
 * Requires an authenticated user (any role), like every other list: reading
 * changes nothing on the panel.
 *
 * No audit entry, for the same reason the site list writes none — the journal
 * records what changed on someone else's production machine, and a line per
 * page view would bury the entries that matter.
 *
 * Nothing about the tasks is logged beyond how many there are. A task's script
 * is part of the row, and backup scripts on a hosting panel routinely carry a
 * database password in plain text (§16: secrets are not logged).
 */
export async function listCronTasksAction(
  serverId: string,
  search?: string,
): Promise<CronListResult> {
  try {
    await requireUser();
  } catch {
    return {ok: false, message: 'unauthenticated'};
  }
  try {
    const creds = await loadServerCreds(serverId);
    const client = await createClientForServer(creds);
    const {items, failures, truncations} = await client.listCronTasks({search});
    // A partial answer is reported, never smoothed over: an empty list that
    // looks complete is how an operator concludes a backup task was removed
    // when in fact the panel refused to answer (ADR-0003).
    if (failures.length > 0) log.warn({serverId, failures}, 'listCronTasksAction partial result');
    return {ok: true, tasks: items, failures, truncations};
  } catch (err) {
    log.error({err, serverId}, 'listCronTasksAction failed');
    return {ok: false, message: await presentError(err, await serverLabel(serverId))};
  }
}

/**
 * Output of one task's last run.
 *
 * Fetched only when a task card is opened, not with the list: the panel keeps
 * one log per task and pulling every one of them to fill a column nobody reads
 * would spend a stranger's capacity on a screen full of text (ADR-0004).
 *
 * The output itself is never logged here either — a script that echoes what it
 * runs puts its own arguments into its output.
 */
export async function getCronLogsAction(
  serverId: string,
  taskId: number,
): Promise<CronLogsResult> {
  try {
    await requireUser();
  } catch {
    return {ok: false, message: 'unauthenticated'};
  }
  try {
    const creds = await loadServerCreds(serverId);
    const client = await createClientForServer(creds);
    return {ok: true, logs: await client.getCronLogs(taskId)};
  } catch (err) {
    log.error({err, serverId, taskId}, 'getCronLogsAction failed');
    return {ok: false, message: await presentError(err, await serverLabel(serverId))};
  }
}
