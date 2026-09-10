'use server';
import {revalidatePath} from 'next/cache';
import {requireUser, requireAdmin, AuthError} from '@/lib/auth/guards';
import {createClientForServer, describeError} from '@/lib/aapanel';
import {serverLabel} from '@/lib/servers/label';
import type {
  ServerMetrics,
  NodeProject,
  ProjectOperation,
  RunScript,
  ProjectPreEnv,
  NodeProjectConfig,
  SourceTruncation,
} from '@/lib/aapanel';
import {recordAudit} from '@/lib/audit';
import {prisma} from '@/lib/db/prisma';
import {log} from '@/log';
import {
  projectCreateSchema,
  projectModifySchema,
  projectDeleteSchema,
} from '@/lib/validation/project';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type MetricsResult = {ok: true; metrics: ServerMetrics} | {ok: false; message: string};
export type ProjectsResult =
  /** `truncations` names sources with more rows than were read; empty means the list is whole. */
  | {ok: true; projects: NodeProject[]; truncations: SourceTruncation[]}
  | {ok: false; message: string};
export type ControlResult = {ok: boolean; message: string};
export type LogsResult = {ok: true; logs: string} | {ok: false; message: string};

export type ProjectMutResult =
  | {ok: true; message?: string}
  | {ok: false; error: string; fieldErrors?: Record<string, string[]>};
export type ProjectEditDataResult =
  | {ok: true; config: NodeProjectConfig; runScripts: RunScript[]; nodeVersions: string[]}
  | {ok: false; message: string};
export type ProjectCreateEnvResult =
  | {ok: true; preEnv: ProjectPreEnv}
  | {ok: false; message: string};
export type RunListResult = {ok: true; scripts: RunScript[]} | {ok: false; message: string};
export type ListDirResult = {ok: true; path: string; dirs: string[]} | {ok: false; message: string};

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

async function loadServerCreds(id: string) {
  return prisma.server.findUniqueOrThrow({
    where: {id},
    select: {id: true, baseUrl: true, apiSkEnc: true, tlsMode: true, tlsPinSha256: true},
  });
}

/** Flattens a ZodError's issues into a field → messages map for the form. */
function collectFieldErrors(issues: {path: PropertyKey[]; message: string}[]): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of issues) {
    const key = issue.path.join('.');
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return fieldErrors;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Returns rich server metrics. Requires authenticated user (any role). */
export async function getServerMetricsAction(serverId: string): Promise<MetricsResult> {
  try {
    await requireUser();
  } catch {
    return {ok: false, message: 'unauthenticated'};
  }
  try {
    const creds = await loadServerCreds(serverId);
    const client = await createClientForServer(creds);
    const metrics = await client.getMetrics();
    return {ok: true, metrics};
  } catch (err) {
    log.error({err, serverId}, 'getServerMetricsAction failed');
    return {ok: false, message: describeError(err, await serverLabel(serverId))};
  }
}

/**
 * Lists Node.js projects on the server, optionally narrowed by a search term.
 *
 * Requires authenticated user (any role).
 */
export async function listNodeProjectsAction(
  serverId: string,
  search?: string,
): Promise<ProjectsResult> {
  try {
    await requireUser();
  } catch {
    return {ok: false, message: 'unauthenticated'};
  }
  try {
    const creds = await loadServerCreds(serverId);
    const client = await createClientForServer(creds);
    const {items, truncations} = await client.listProjects({search});
    if (truncations.length > 0) log.warn({serverId, truncations}, 'listNodeProjectsAction truncated');
    return {ok: true, projects: items, truncations};
  } catch (err) {
    log.error({err, serverId}, 'listNodeProjectsAction failed');
    return {ok: false, message: describeError(err, await serverLabel(serverId))};
  }
}

const VALID_OPS: ReadonlySet<string> = new Set(['start', 'stop', 'restart']);

/** Start / stop / restart a Node.js project. Requires admin role. Records audit on both paths. */
export async function projectControlAction(
  serverId: string,
  projectName: string,
  op: ProjectOperation,
): Promise<ControlResult> {
  let userId: string;
  try {
    const user = await requireAdmin();
    userId = user.id;
  } catch (e) {
    return {ok: false, message: e instanceof AuthError ? e.code : 'forbidden'};
  }

  if (!VALID_OPS.has(op)) return {ok: false, message: 'invalid'};
  if (!projectName) return {ok: false, message: 'invalid'};

  try {
    const creds = await loadServerCreds(serverId);
    const client = await createClientForServer(creds);
    const result = await client.batchOperation([projectName], op);
    // The panel can return HTTP 200 while the per-project operation failed
    // (msg_list[i].status === false). Surface that as a failure, not success.
    const item = result.msg_list?.[0];
    if (item && item.status === false) {
      await recordAudit({userId, serverId, action: `project.${op}`, target: projectName, result: 'error'});
      return {ok: false, message: item.msg || op};
    }
    await recordAudit({
      userId,
      serverId,
      action: `project.${op}`,
      target: projectName,
      result: 'ok',
    });
    revalidatePath(`/servers/${serverId}/projects`);
    return {ok: true, message: op};
  } catch (err) {
    log.error({err, serverId, projectName, op}, 'projectControlAction failed');
    await recordAudit({
      userId,
      serverId,
      action: `project.${op}`,
      target: projectName,
      result: 'error',
    });
    return {ok: false, message: describeError(err, await serverLabel(serverId))};
  }
}

/** Fetches the most recent log output for a project. Requires authenticated user (any role). */
export async function getProjectLogsAction(serverId: string, projectName: string): Promise<LogsResult> {
  try {
    await requireUser();
  } catch {
    return {ok: false, message: 'unauthenticated'};
  }
  try {
    const creds = await loadServerCreds(serverId);
    const client = await createClientForServer(creds);
    const logs = await client.getProjectLogs(projectName);
    return {ok: true, logs};
  } catch (err) {
    log.error({err, serverId, projectName}, 'getProjectLogsAction failed');
    return {ok: false, message: describeError(err, await serverLabel(serverId))};
  }
}

// ---------------------------------------------------------------------------
// Create / Modify / Delete (admin only)
// ---------------------------------------------------------------------------

/**
 * Loads everything the edit form needs: current config, the package.json run
 * scripts, and the installed Node versions. Requires admin role.
 *
 * The run-script lookup is best-effort: if the project directory can't be read
 * the form still opens (with an empty script list) rather than failing entirely.
 */
export async function getProjectEditDataAction(
  serverId: string,
  projectName: string,
): Promise<ProjectEditDataResult> {
  try {
    await requireAdmin();
  } catch {
    return {ok: false, message: 'forbidden'};
  }
  try {
    const creds = await loadServerCreds(serverId);
    const client = await createClientForServer(creds);
    const config = await client.getProjectConfig(projectName);
    const [scriptsResult, versionsResult] = await Promise.allSettled([
      client.getRunList(config.cwd),
      client.getNodeVersions(),
    ]);
    const runScripts = scriptsResult.status === 'fulfilled' ? scriptsResult.value : [];
    const nodeVersions = versionsResult.status === 'fulfilled' ? versionsResult.value : [];
    return {ok: true, config, runScripts, nodeVersions};
  } catch (err) {
    log.error({err, serverId, projectName}, 'getProjectEditDataAction failed');
    return {ok: false, message: describeError(err, await serverLabel(serverId))};
  }
}

/** Loads metadata for the create-project form (pre_env). Requires admin role. */
export async function getProjectCreateEnvAction(serverId: string): Promise<ProjectCreateEnvResult> {
  try {
    await requireAdmin();
  } catch {
    return {ok: false, message: 'forbidden'};
  }
  try {
    const creds = await loadServerCreds(serverId);
    const client = await createClientForServer(creds);
    const preEnv = await client.getCreateEnv();
    return {ok: true, preEnv};
  } catch (err) {
    log.error({err, serverId}, 'getProjectCreateEnvAction failed');
    return {ok: false, message: describeError(err, await serverLabel(serverId))};
  }
}

/** Reads package.json run scripts for a given directory. Requires admin role. */
export async function getRunListAction(serverId: string, projectCwd: string): Promise<RunListResult> {
  try {
    await requireAdmin();
  } catch {
    return {ok: false, message: 'forbidden'};
  }
  if (!projectCwd.trim()) return {ok: false, message: 'empty path'};
  try {
    const creds = await loadServerCreds(serverId);
    const client = await createClientForServer(creds);
    const scripts = await client.getRunList(projectCwd.trim());
    return {ok: true, scripts};
  } catch (err) {
    log.error({err, serverId}, 'getRunListAction failed');
    return {ok: false, message: describeError(err, await serverLabel(serverId))};
  }
}

/** Creates a new Node.js project. Requires admin role. Records audit on both paths. */
export async function createProjectAction(serverId: string, formData: FormData): Promise<ProjectMutResult> {
  let userId: string;
  try {
    const user = await requireAdmin();
    userId = user.id;
  } catch (e) {
    return {ok: false, error: e instanceof AuthError ? e.code : 'forbidden'};
  }

  const parsed = projectCreateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {ok: false, error: 'validation', fieldErrors: collectFieldErrors(parsed.error.issues)};
  }
  const input = parsed.data;

  try {
    const creds = await loadServerCreds(serverId);
    const client = await createClientForServer(creds);
    await client.createProject(input);
    await recordAudit({userId, serverId, action: 'project.create', target: input.name, result: 'ok'});
    revalidatePath(`/servers/${serverId}/projects`);
    return {ok: true, message: 'created'};
  } catch (err) {
    log.error({err, serverId, name: input.name}, 'createProjectAction failed');
    await recordAudit({userId, serverId, action: 'project.create', target: input.name, result: 'error'});
    return {ok: false, error: describeError(err, await serverLabel(serverId))};
  }
}

/** Modifies an existing project's settings. Requires admin role. Records audit on both paths. */
export async function modifyProjectAction(serverId: string, formData: FormData): Promise<ProjectMutResult> {
  let userId: string;
  try {
    const user = await requireAdmin();
    userId = user.id;
  } catch (e) {
    return {ok: false, error: e instanceof AuthError ? e.code : 'forbidden'};
  }

  const parsed = projectModifySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {ok: false, error: 'validation', fieldErrors: collectFieldErrors(parsed.error.issues)};
  }
  const input = parsed.data;

  try {
    const creds = await loadServerCreds(serverId);
    const client = await createClientForServer(creds);
    await client.modifyProject(input);
    await recordAudit({userId, serverId, action: 'project.modify', target: input.name, result: 'ok'});
    revalidatePath(`/servers/${serverId}/projects`);
    return {ok: true, message: 'modified'};
  } catch (err) {
    log.error({err, serverId, name: input.name}, 'modifyProjectAction failed');
    await recordAudit({userId, serverId, action: 'project.modify', target: input.name, result: 'error'});
    return {ok: false, error: describeError(err, await serverLabel(serverId))};
  }
}

/**
 * Deletes a project (panel registration only — the on-disk directory is
 * preserved). Requires admin role and a typed-name confirmation. Records audit.
 */
export async function deleteProjectAction(serverId: string, formData: FormData): Promise<ProjectMutResult> {
  let userId: string;
  try {
    const user = await requireAdmin();
    userId = user.id;
  } catch (e) {
    return {ok: false, error: e instanceof AuthError ? e.code : 'forbidden'};
  }

  const parsed = projectDeleteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {ok: false, error: 'validation', fieldErrors: collectFieldErrors(parsed.error.issues)};
  }
  const {name, confirm} = parsed.data;

  // Guard: user must type the project name to confirm deletion.
  if (confirm !== name) return {ok: false, error: 'confirm'};

  try {
    const creds = await loadServerCreds(serverId);
    const client = await createClientForServer(creds);
    await client.deleteProject(name);
    await recordAudit({userId, serverId, action: 'project.delete', target: name, result: 'ok'});
    revalidatePath(`/servers/${serverId}/projects`);
    return {ok: true, message: 'deleted'};
  } catch (err) {
    log.error({err, serverId, name}, 'deleteProjectAction failed');
    await recordAudit({userId, serverId, action: 'project.delete', target: name, result: 'error'});
    return {ok: false, error: describeError(err, await serverLabel(serverId))};
  }
}

/**
 * Lists sub-directories of a path on the server — backs the directory picker in
 * the create-project form. Requires admin role (browsing the filesystem is
 * privileged). Defaults to "/" when no path is given.
 */
export async function listDirAction(serverId: string, path: string): Promise<ListDirResult> {
  try {
    await requireAdmin();
  } catch {
    return {ok: false, message: 'forbidden'};
  }
  const target = path.trim() || '/';
  try {
    const creds = await loadServerCreds(serverId);
    const client = await createClientForServer(creds);
    const res = await client.listDir(target);
    return {ok: true, path: res.path, dirs: res.dirs};
  } catch (err) {
    log.error({err, serverId, path: target}, 'listDirAction failed');
    return {ok: false, message: describeError(err, await serverLabel(serverId))};
  }
}
