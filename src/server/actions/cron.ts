'use server';
import {revalidatePath} from 'next/cache';
import type {z} from 'zod';
import {requireUser, requireAdmin, AuthError} from '@/lib/auth/guards';
import {createClientForServer, presentError} from '@/lib/aapanel';
import {serverLabel} from '@/lib/servers/label';
import type {CronTask, SourceFailure, SourceTruncation} from '@/lib/aapanel';
import {recordAudit, beginAudit, type AuditHandle} from '@/lib/audit';
import {prisma} from '@/lib/db/prisma';
import {log} from '@/log';
import {
  cronRunSchema,
  cronStatusSchema,
  cronDeleteSchema,
  cronConfirmPhrase,
} from '@/lib/validation/cron';

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

export type CronMutResult =
  /** `message` carries what actually happened, which is not always what was asked. */
  | {ok: true; message?: string}
  | {ok: false; error: string; fieldErrors?: Record<string, string[]>};

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

// ---------------------------------------------------------------------------
// Changing operations (Ф-4, slice 2)
//
// Three operations at three levels of risk, and the code says which is which
// rather than treating them as one CRUD block:
//
//   run now  — cannot be undone, but runs the script the schedule runs anyway
//   toggle   — reversible, and the panel offers only a toggle, never a set
//   delete   — irreversible, and nothing on the panel remembers what was there
//
// All three are admin-only, because all three change what happens on someone
// else's production machine at a time nobody is watching.
// ---------------------------------------------------------------------------

/** Turns zod issues into the per-field shape the dialogs already understand. */
function fieldErrorsOf(error: z.ZodError): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.');
    if (!fieldErrors[key]) fieldErrors[key] = [];
    fieldErrors[key]!.push(issue.message);
  }
  return fieldErrors;
}

/**
 * Runs a scheduled task now, outside its schedule.
 *
 * Journalled **before** the panel is called, not after (Д-19). Running a task
 * cannot be undone, and this is the entry someone will be looking for months
 * later when they ask who told a client's server to run a script at 15:00. The
 * ordering with a hole in it — act first, then write a line that may fail
 * silently — is not available for that.
 *
 * What the task does is not recorded: the journal names the task, never its
 * script, because a backup script carries a database password in plain text.
 */
export async function runCronTaskAction(
  serverId: string,
  formData: FormData,
): Promise<CronMutResult> {
  let userId: string;
  try {
    userId = (await requireAdmin()).id;
  } catch (e) {
    return {ok: false, error: e instanceof AuthError ? e.code : 'forbidden'};
  }

  const parsed = cronRunSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return {ok: false, error: 'validation', fieldErrors: fieldErrorsOf(parsed.error)};
  const {id, name} = parsed.data;
  const target = cronConfirmPhrase({id, name});

  let audit: AuditHandle;
  try {
    audit = await beginAudit({userId, serverId, action: 'cron.run', target});
  } catch (err) {
    // Nothing has happened yet and nothing will. An operator loses one retry;
    // the alternative is a script run on a client's machine with nobody named
    // against it.
    log.error({err, serverId, taskId: id}, 'runCronTaskAction refused: journal unavailable');
    return {ok: false, error: await presentError(err)};
  }

  try {
    const creds = await loadServerCreds(serverId);
    const client = await createClientForServer(creds);
    await client.runCronTask(id);
    await audit.finish('ok');
    revalidatePath(`/servers/${serverId}/cron`);
    return {ok: true, message: 'started'};
  } catch (err) {
    log.error({err, serverId, taskId: id}, 'runCronTaskAction failed');
    await audit.finish('error');
    return {ok: false, error: await presentError(err, await serverLabel(serverId))};
  }
}

/**
 * Enables or stops a scheduled task.
 *
 * Reversible — one more click puts it back — so the journal is written after
 * the fact and best-effort, the same trade the project start/stop control
 * makes. Reversible does not mean harmless: stopping a task is precisely how
 * backups quietly cease, which is why the interface asks before doing it.
 *
 * The client re-reads the task's real state before acting, because the panel's
 * endpoint toggles rather than sets. `already` means the panel was found in the
 * requested state and nothing was sent — a real outcome, shown as one.
 */
export async function setCronTaskEnabledAction(
  serverId: string,
  formData: FormData,
): Promise<CronMutResult> {
  let userId: string;
  try {
    userId = (await requireAdmin()).id;
  } catch (e) {
    return {ok: false, error: e instanceof AuthError ? e.code : 'forbidden'};
  }

  const parsed = cronStatusSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return {ok: false, error: 'validation', fieldErrors: fieldErrorsOf(parsed.error)};
  const {id, name, enabled} = parsed.data;
  const target = cronConfirmPhrase({id, name});
  const action = enabled ? 'cron.enable' : 'cron.disable';

  try {
    const creds = await loadServerCreds(serverId);
    const client = await createClientForServer(creds);
    const outcome = await client.setCronTaskEnabled(id, enabled);
    // A task already in the requested state is journalled too. "Nothing needed
    // doing" is an answer about a client's machine at a moment in time, and the
    // journal is where such answers are looked up later.
    await recordAudit({userId, serverId, action, target, result: 'ok'});
    revalidatePath(`/servers/${serverId}/cron`);
    return {ok: true, message: outcome};
  } catch (err) {
    log.error({err, serverId, taskId: id, enabled}, 'setCronTaskEnabledAction failed');
    await recordAudit({userId, serverId, action, target, result: 'error'});
    return {ok: false, error: await presentError(err, await serverLabel(serverId))};
  }
}

/**
 * Deletes a scheduled task.
 *
 * Irreversible, so it carries what every irreversible operation here carries:
 * the admin role, a phrase typed by hand and re-checked on the server, and a
 * journal entry written before the panel is touched (Д-19).
 *
 * The typed phrase is compared here as well as in the browser. A server action
 * is a public endpoint, and a confirmation that only the browser enforces is
 * decoration.
 */
export async function deleteCronTaskAction(
  serverId: string,
  formData: FormData,
): Promise<CronMutResult> {
  let userId: string;
  try {
    userId = (await requireAdmin()).id;
  } catch (e) {
    return {ok: false, error: e instanceof AuthError ? e.code : 'forbidden'};
  }

  const parsed = cronDeleteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return {ok: false, error: 'validation', fieldErrors: fieldErrorsOf(parsed.error)};
  const {id, name, confirm} = parsed.data;
  const phrase = cronConfirmPhrase({id, name});
  if (confirm !== phrase) return {ok: false, error: 'confirm'};

  let audit: AuditHandle;
  try {
    audit = await beginAudit({userId, serverId, action: 'cron.delete', target: phrase});
  } catch (err) {
    log.error({err, serverId, taskId: id}, 'deleteCronTaskAction refused: journal unavailable');
    return {ok: false, error: await presentError(err)};
  }

  try {
    const creds = await loadServerCreds(serverId);
    const client = await createClientForServer(creds);
    await client.deleteCronTask(id);
    await audit.finish('ok');
    revalidatePath(`/servers/${serverId}/cron`);
    return {ok: true};
  } catch (err) {
    log.error({err, serverId, taskId: id}, 'deleteCronTaskAction failed');
    await audit.finish('error');
    return {ok: false, error: await presentError(err, await serverLabel(serverId))};
  }
}
