'use server';
import {revalidatePath} from 'next/cache';
import type {z} from 'zod';
import {requireUser, requireAdmin, AuthError} from '@/lib/auth/guards';
import {createClientForServer, presentError} from '@/lib/aapanel';
import {serverLabel} from '@/lib/servers/label';
import type {FtpUser, SourceFailure, SourceTruncation} from '@/lib/aapanel';
import {recordAudit, beginAudit, type AuditHandle} from '@/lib/audit';
import {prisma} from '@/lib/db/prisma';
import {log} from '@/log';
import {
  ftpCreateSchema,
  ftpPasswordSchema,
  ftpStatusSchema,
  ftpDeleteSchema,
} from '@/lib/validation/ftp';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type FtpListResult =
  | {ok: true; users: FtpUser[]; failures: SourceFailure[]; truncations: SourceTruncation[]}
  | {ok: false; message: string};

export type FtpMutResult =
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

// ---------------------------------------------------------------------------
// Actions
//
// One thing runs through all of them: an FTP password never travels back, and
// never reaches a log line. The panel returns every account's password in clear
// text with the list; the client drops it, the type has nowhere to put it, and
// the two actions that accept one pass it straight through to the panel.
// ---------------------------------------------------------------------------

/**
 * Lists the FTP accounts, optionally narrowed by a search term.
 *
 * Requires an authenticated user (any role), and writes no journal entry —
 * reading changes nothing on the panel.
 */
export async function listFtpUsersAction(
  serverId: string,
  search?: string,
): Promise<FtpListResult> {
  try {
    await requireUser();
  } catch {
    return {ok: false, message: 'unauthenticated'};
  }
  try {
    const creds = await loadServerCreds(serverId);
    const client = await createClientForServer(creds);
    const {items, failures, truncations} = await client.listFtpUsers({search});
    if (failures.length > 0) log.warn({serverId, failures}, 'listFtpUsersAction partial result');
    if (truncations.length > 0) log.warn({serverId, truncations}, 'listFtpUsersAction truncated');
    return {ok: true, users: items, failures, truncations};
  } catch (err) {
    log.error({err, serverId}, 'listFtpUsersAction failed');
    return {ok: false, message: await presentError(err, await serverLabel(serverId))};
  }
}

/**
 * Creates an FTP account.
 *
 * Admin only, and journalled after the fact: an account that was created can be
 * deleted again, which is the same trade every reversible operation here makes.
 * What is *not* fully reversible is the home directory the panel creates along
 * with it — deleting the account leaves it — and the interface says so before
 * the button is pressed.
 */
export async function createFtpUserAction(
  serverId: string,
  formData: FormData,
): Promise<FtpMutResult> {
  let userId: string;
  try {
    userId = (await requireAdmin()).id;
  } catch (e) {
    return {ok: false, error: e instanceof AuthError ? e.code : 'forbidden'};
  }

  const parsed = ftpCreateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return {ok: false, error: 'validation', fieldErrors: fieldErrorsOf(parsed.error)};
  const {username, path, note} = parsed.data;

  try {
    const creds = await loadServerCreds(serverId);
    const client = await createClientForServer(creds);
    await client.createFtpUser(parsed.data);
    await recordAudit({userId, serverId, action: 'ftp.create', target: username, result: 'ok'});
    revalidatePath(`/servers/${serverId}/ftp`);
    return {ok: true};
  } catch (err) {
    // The account name and its directory are logged; the password is not, and
    // that is why `parsed.data` is never handed to the logger whole.
    log.error({err, serverId, username, path, note}, 'createFtpUserAction failed');
    await recordAudit({userId, serverId, action: 'ftp.create', target: username, result: 'error'});
    return {ok: false, error: await presentError(err, await serverLabel(serverId))};
  }
}

/**
 * Replaces an account's password.
 *
 * Journalled — who changed which account's password and when is exactly what
 * the journal is for — while the password itself appears nowhere but the
 * request to the panel.
 */
export async function setFtpUserPasswordAction(
  serverId: string,
  formData: FormData,
): Promise<FtpMutResult> {
  let userId: string;
  try {
    userId = (await requireAdmin()).id;
  } catch (e) {
    return {ok: false, error: e instanceof AuthError ? e.code : 'forbidden'};
  }

  const parsed = ftpPasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return {ok: false, error: 'validation', fieldErrors: fieldErrorsOf(parsed.error)};
  const {id, username, password} = parsed.data;

  try {
    const creds = await loadServerCreds(serverId);
    const client = await createClientForServer(creds);
    await client.setFtpUserPassword(id, username, password);
    await recordAudit({userId, serverId, action: 'ftp.password', target: username, result: 'ok'});
    revalidatePath(`/servers/${serverId}/ftp`);
    return {ok: true};
  } catch (err) {
    log.error({err, serverId, ftpUser: username}, 'setFtpUserPasswordAction failed');
    await recordAudit({userId, serverId, action: 'ftp.password', target: username, result: 'error'});
    return {ok: false, error: await presentError(err, await serverLabel(serverId))};
  }
}

/**
 * Switches an account on or off.
 *
 * Reversible, so the journal is written afterwards. Note what is *not* needed
 * here: this endpoint takes the state the operator asked for, so unlike the
 * scheduler's toggle there is nothing to re-read first and no way for a stale
 * screen to produce the opposite of the request.
 */
export async function setFtpUserEnabledAction(
  serverId: string,
  formData: FormData,
): Promise<FtpMutResult> {
  let userId: string;
  try {
    userId = (await requireAdmin()).id;
  } catch (e) {
    return {ok: false, error: e instanceof AuthError ? e.code : 'forbidden'};
  }

  const parsed = ftpStatusSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return {ok: false, error: 'validation', fieldErrors: fieldErrorsOf(parsed.error)};
  const {id, username, enabled} = parsed.data;
  const action = enabled ? 'ftp.enable' : 'ftp.disable';

  try {
    const creds = await loadServerCreds(serverId);
    const client = await createClientForServer(creds);
    await client.setFtpUserEnabled(id, username, enabled);
    await recordAudit({userId, serverId, action, target: username, result: 'ok'});
    revalidatePath(`/servers/${serverId}/ftp`);
    return {ok: true};
  } catch (err) {
    log.error({err, serverId, ftpUser: username, enabled}, 'setFtpUserEnabledAction failed');
    await recordAudit({userId, serverId, action, target: username, result: 'error'});
    return {ok: false, error: await presentError(err, await serverLabel(serverId))};
  }
}

/**
 * Deletes an FTP account.
 *
 * Irreversible on someone else's machine, so it carries what every irreversible
 * operation here carries: the admin role, a name typed by hand and re-checked
 * on the server, and a journal entry written before the panel is touched
 * (Д-19).
 */
export async function deleteFtpUserAction(
  serverId: string,
  formData: FormData,
): Promise<FtpMutResult> {
  let userId: string;
  try {
    userId = (await requireAdmin()).id;
  } catch (e) {
    return {ok: false, error: e instanceof AuthError ? e.code : 'forbidden'};
  }

  const parsed = ftpDeleteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return {ok: false, error: 'validation', fieldErrors: fieldErrorsOf(parsed.error)};
  const {id, username, confirm} = parsed.data;
  if (confirm !== username) return {ok: false, error: 'confirm'};

  let audit: AuditHandle;
  try {
    audit = await beginAudit({userId, serverId, action: 'ftp.delete', target: username});
  } catch (err) {
    log.error({err, serverId, ftpUser: username}, 'deleteFtpUserAction refused: journal unavailable');
    return {ok: false, error: await presentError(err)};
  }

  try {
    const creds = await loadServerCreds(serverId);
    const client = await createClientForServer(creds);
    await client.deleteFtpUser(id, username);
    await audit.finish('ok');
    revalidatePath(`/servers/${serverId}/ftp`);
    return {ok: true};
  } catch (err) {
    log.error({err, serverId, ftpUser: username}, 'deleteFtpUserAction failed');
    await audit.finish('error');
    return {ok: false, error: await presentError(err, await serverLabel(serverId))};
  }
}
