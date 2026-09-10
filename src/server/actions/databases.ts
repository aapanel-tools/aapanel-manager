'use server';
import {revalidatePath} from 'next/cache';
import {requireUser, requireAdmin, AuthError} from '@/lib/auth/guards';
import {createClientForServer, describeError} from '@/lib/aapanel';
import {serverLabel} from '@/lib/servers/label';
import type {Database, SourceFailure, SourceTruncation} from '@/lib/aapanel';
import {recordAudit} from '@/lib/audit';
import {prisma} from '@/lib/db/prisma';
import {log} from '@/log';
import {databaseCreateSchema, databaseDeleteSchema} from '@/lib/validation/database';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type DbListResult =
  /**
   * `failures` lists engines that did not answer, `truncations` engines that had
   * more rows than were read. Both empty means the list is complete — and says so.
   */
  | {ok: true; databases: Database[]; failures: SourceFailure[]; truncations: SourceTruncation[]}
  | {ok: false; message: string};
export type DbMutResult =
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
 * Lists databases on the server, optionally narrowed by a search term.
 *
 * The term goes to both engines: they are two lists shown as one, and a search
 * that reached only MySQL would quietly answer half the question.
 *
 * Requires authenticated user (any role).
 */
export async function listDatabasesAction(
  serverId: string,
  search?: string,
): Promise<DbListResult> {
  try {
    await requireUser();
  } catch {
    return {ok: false, message: 'unauthenticated'};
  }
  try {
    const creds = await loadServerCreds(serverId);
    const client = await createClientForServer(creds);
    const {items, failures, truncations} = await client.listDatabases({search});
    // One engine failing still yields the other's list, but never silently:
    // the caller shows the gap and the log names the server (ADR-0003).
    if (failures.length > 0) log.warn({serverId, failures}, 'listDatabasesAction partial result');
    if (truncations.length > 0) log.warn({serverId, truncations}, 'listDatabasesAction truncated');
    return {ok: true, databases: items, failures, truncations};
  } catch (err) {
    log.error({err, serverId}, 'listDatabasesAction failed');
    return {ok: false, message: describeError(err, await serverLabel(serverId))};
  }
}

/** Creates a database on the server. Requires admin role. Records audit on both paths. */
export async function createDatabaseAction(serverId: string, formData: FormData): Promise<DbMutResult> {
  let userId: string;
  try {
    const user = await requireAdmin();
    userId = user.id;
  } catch (e) {
    return {ok: false, error: e instanceof AuthError ? e.code : 'forbidden'};
  }

  const parsed = databaseCreateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.');
      if (!fieldErrors[key]) fieldErrors[key] = [];
      fieldErrors[key]!.push(issue.message);
    }
    return {ok: false, error: 'validation', fieldErrors};
  }

  const {name} = parsed.data;

  try {
    const creds = await loadServerCreds(serverId);
    const client = await createClientForServer(creds);
    await client.createDatabase(parsed.data);
    await recordAudit({userId, serverId, action: 'db.create', target: name, result: 'ok'});
    revalidatePath(`/servers/${serverId}/databases`);
    return {ok: true};
  } catch (err) {
    log.error({err, serverId, name}, 'createDatabaseAction failed');
    await recordAudit({userId, serverId, action: 'db.create', target: name, result: 'error'});
    return {ok: false, error: describeError(err, await serverLabel(serverId))};
  }
}

/** Deletes a database from the server. Requires admin role. Records audit on both paths. */
export async function deleteDatabaseAction(serverId: string, formData: FormData): Promise<DbMutResult> {
  let userId: string;
  try {
    const user = await requireAdmin();
    userId = user.id;
  } catch (e) {
    return {ok: false, error: e instanceof AuthError ? e.code : 'forbidden'};
  }

  const parsed = databaseDeleteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.');
      if (!fieldErrors[key]) fieldErrors[key] = [];
      fieldErrors[key]!.push(issue.message);
    }
    return {ok: false, error: 'validation', fieldErrors};
  }

  const {engine, id, name, confirm} = parsed.data;

  // Guard: user must type the database name to confirm deletion.
  if (confirm !== name) {
    return {ok: false, error: 'confirm'};
  }

  try {
    const creds = await loadServerCreds(serverId);
    const client = await createClientForServer(creds);
    await client.deleteDatabase(engine, {id, name});
    await recordAudit({userId, serverId, action: 'db.delete', target: name, result: 'ok'});
    revalidatePath(`/servers/${serverId}/databases`);
    return {ok: true};
  } catch (err) {
    log.error({err, serverId, name, engine}, 'deleteDatabaseAction failed');
    await recordAudit({userId, serverId, action: 'db.delete', target: name, result: 'error'});
    return {ok: false, error: describeError(err, await serverLabel(serverId))};
  }
}
