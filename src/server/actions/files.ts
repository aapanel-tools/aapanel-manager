'use server';
import {requireAdmin, AuthError} from '@/lib/auth/guards';
import {createClientForServer, presentError} from '@/lib/aapanel';
import {serverLabel} from '@/lib/servers/label';
import type {FileContent, FileEntry, SourceTruncation} from '@/lib/aapanel';
import {beginAudit, type AuditHandle} from '@/lib/audit';
import {normalizeBrowsePath} from '@/lib/files/paths';
import {loadServerCreds, ServerNotFoundError, type RegisteredServer} from '@/lib/servers/creds';
import {log} from '@/log';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type DirectoryResult =
  /** `path` is the one that was asked for, normalized — what the screen should say. */
  | {ok: true; path: string; entries: FileEntry[]; truncations: SourceTruncation[]}
  | {ok: false; message: string};

export type FileReadResult = {ok: true; file: FileContent} | {ok: false; message: string};

// ---------------------------------------------------------------------------
// Actions
//
// Both are for administrators only, and that is the section's rule rather than
// these two functions' (ADR-0008). A file manager's subject is the client's
// secrets — wp-config.php, .env, private keys — and PROJECT_RULES.md §16 grants
// rights to files explicitly. Nobody has been granted them, so nobody but an
// administrator has them.
//
// The path is checked here again even though the page already did: a server
// action is a public endpoint, and the page's check is only a courtesy to the
// person typing into the address bar.
// ---------------------------------------------------------------------------

/**
 * One directory on the server.
 *
 * No journal entry: a line for every folder opened would bury the lines the
 * journal is read for. Opening a file is a different act — see readFileAction.
 */
export async function listDirectoryAction(
  serverId: string,
  path: unknown,
): Promise<DirectoryResult> {
  try {
    await requireAdmin();
  } catch (e) {
    return {ok: false, message: e instanceof AuthError ? e.code : 'forbidden'};
  }
  const target = normalizeBrowsePath(path);
  if (!target) return {ok: false, message: 'validation'};

  try {
    const creds = await loadServerCreds(serverId);
    const client = await createClientForServer(creds);
    const listing = await client.listDirectory(target);
    if (listing.truncations.length > 0) {
      log.warn({serverId, path: target, truncations: listing.truncations}, 'listDirectoryAction truncated');
    }
    return {ok: true, path: target, entries: listing.items, truncations: listing.truncations};
  } catch (err) {
    if (err instanceof ServerNotFoundError) return {ok: false, message: 'notFound'};
    log.error({err, serverId, path: target}, 'listDirectoryAction failed');
    return {ok: false, message: await presentError(err, await serverLabel(serverId))};
  }
}

/**
 * A file's contents, if they are text and small enough to show.
 *
 * Journalled before the panel is asked, the way irreversible actions are
 * (Д-19), and for the same reason: once a secret has been shown it cannot be
 * un-shown, and the journal is the only record of who saw it. If the line
 * cannot be written the file is not read.
 *
 * The contents go into the return value and nowhere else — not into a log line
 * on success, not into one on failure, not into the journal, whose target is
 * the path.
 */
export async function readFileAction(serverId: string, path: unknown): Promise<FileReadResult> {
  let userId: string;
  try {
    userId = (await requireAdmin()).id;
  } catch (e) {
    return {ok: false, message: e instanceof AuthError ? e.code : 'forbidden'};
  }
  const target = normalizeBrowsePath(path);
  // The root is a directory on every machine; asking to read it as a file is
  // not a request anything on screen can make.
  if (!target || target === '/') return {ok: false, message: 'validation'};

  // Looked up before the journal line, which references the server: for one
  // that is gone the line cannot be written (creds.ts).
  let creds: RegisteredServer;
  try {
    creds = await loadServerCreds(serverId);
  } catch (err) {
    if (err instanceof ServerNotFoundError) return {ok: false, message: 'notFound'};
    log.error({err, serverId, path: target}, 'readFileAction failed');
    return {ok: false, message: await presentError(err, await serverLabel(serverId))};
  }

  let audit: AuditHandle;
  try {
    audit = await beginAudit({userId, serverId, action: 'file.read', target});
  } catch (err) {
    log.error({err, serverId, path: target}, 'readFileAction refused: journal unavailable');
    return {ok: false, message: await presentError(err)};
  }

  try {
    const client = await createClientForServer(creds);
    const file = await client.readFile(target);
    // A binary or over-sized file is still a finished read: the attempt is on
    // record, and less was disclosed than could have been.
    await audit.finish('ok');
    return {ok: true, file};
  } catch (err) {
    log.error({err, serverId, path: target}, 'readFileAction failed');
    await audit.finish('error');
    return {ok: false, message: await presentError(err, await serverLabel(serverId))};
  }
}
