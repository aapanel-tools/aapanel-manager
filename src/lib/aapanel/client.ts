import type {Agent} from 'undici';
import {fetch as undiciFetch} from 'undici';
import type {ZodType} from 'zod';
import {sign} from './signing';
import {
  batchOperationResponse,
  cronListResponse,
  cronLogsResponse,
  cronMutationResponse,
  mysqlDatabaseListResponse,
  pgsqlDatabaseListResponse,
  projectInfoResponse,
  projectListResponse,
  projectLogResponse,
  siteDirUserIniResponse,
  siteDomainListResponse,
  siteListResponse,
  siteLogsResponse,
  sitePhpVersionResponse,
  siteSslResponse,
  type RawNodeProjectParsed,
} from './schemas';
import {TlsPinMismatchError, dispatcherFor, formatFingerprint} from './tls';
import {DEFAULT_PAGE_LIMIT, describePage, normalizeSearch} from './paging';
import {
  DEFAULT_MAX_CONCURRENT,
  PanelBusyError,
  gateFor,
  panelOrigin,
  type ReleaseSlot,
} from './rate-limit';
import {
  AaPanelError,
  type AaPanelClientConfig,
  type SystemTotal,
  type ServerSnapshot,
  type ServerMetrics,
  type NodeProject,
  type ProjectOperation,
  type RunScript,
  type ProjectPreEnv,
  type NodeProjectConfig,
  type ProjectModifyInput,
  type ProjectCreateInput,
  type CronTask,
  type Database,
  type Site,
  type SiteDetail,
  type SiteDirectory,
  type SiteDomain,
  type SiteSsl,
  type SourceFailure,
  type DbEngine,
  type DbCreateInput,
  type PartialResult,
  describeSourceFailure,
} from './types';

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Largest answer we will read from a panel, in bytes.
 *
 * The process that reads it serves the whole fleet, so a broken — or hostile —
 * panel must not be able to exhaust its memory by streaming forever. No legitimate
 * answer comes near this: the biggest are a project or database listing. A project
 * log can genuinely be larger, and there the request fails with a clear message
 * rather than being silently truncated, because a half-read JSON envelope is not
 * data, it is garbage. Overridable per client.
 */
const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

/**
 * Reads the body while counting bytes, and stops the moment the cap is passed.
 *
 * Content-Length is checked first when the panel declares it — that refuses an
 * oversized answer without reading a byte — but it is only a hint: a chunked
 * response has none, and a lying one is exactly what a hostile peer would send.
 * The running count is what actually enforces the limit.
 */
async function readCapped(res: Response, limit: number, path: string): Promise<string> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) {
    throw new AaPanelError(
      'panel_error',
      `Panel answer for ${path} declares ${declared} bytes, over the ${limit}-byte limit`,
      res.status,
    );
  }
  if (!res.body) return '';

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new AaPanelError(
        'panel_error',
        `Panel answer for ${path} exceeded the ${limit}-byte limit`,
        res.status,
      );
    }
    chunks.push(value);
  }

  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

/**
 * The panel's own words when it refuses, or null when this is not a refusal.
 *
 * A refusal arrives in the same envelope as success — `{status, message}` — with a
 * non-zero status and a payload of a different shape. Validating that payload against
 * the success schema produces a complaint about a field we were never going to read,
 * which buries the one thing the operator needs: what the panel actually said.
 */
function panelDenial(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const {status, message} = payload as {status?: unknown; message?: unknown};
  if (typeof status !== 'number' || status === 0) return null;
  if (typeof message === 'string' && message) return message;
  if (message && typeof message === 'object') {
    const fields = message as Record<string, unknown>;
    for (const key of ['error_msg', 'result', 'msg', 'data']) {
      const value = fields[key];
      if (typeof value === 'string' && value) return value;
    }
  }
  return `Panel refused with status ${status}`;
}

/** undici reports a connector failure as the `cause` of the thrown fetch error. */
function asPinMismatch(err: unknown): TlsPinMismatchError | null {
  if (err instanceof TlsPinMismatchError) return err;
  const cause = (err as {cause?: unknown} | null)?.cause;
  return cause instanceof TlsPinMismatchError ? cause : null;
}

/** True for an aborted/timed-out request, whichever position carries the reason. */
function isAbortLike(err: unknown): boolean {
  const names = [
    (err as {name?: unknown} | null)?.name,
    (err as {cause?: {name?: unknown}} | null)?.cause?.name,
  ];
  return names.some((n) => n === 'TimeoutError' || n === 'AbortError');
}

export class AaPanelClient {
  private readonly baseUrl: string;
  private readonly apiSk: string;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  /** Load is limited per panel, not per stored server (ADR-0004). */
  private readonly origin: string;
  private readonly maxConcurrent: number;
  /** undefined means undici's default dispatcher, which verifies normally. */
  private readonly dispatcher: Agent | undefined;

  constructor(config: AaPanelClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.apiSk = config.apiSk;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxResponseBytes = config.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    this.origin = panelOrigin(this.baseUrl);
    this.maxConcurrent = config.maxConcurrentRequests ?? DEFAULT_MAX_CONCURRENT;
    // Throws when PINNED mode has no fingerprint yet: refusing to connect is the
    // point — api_sk must not go to a peer we cannot identify (ADR-0002).
    this.dispatcher = dispatcherFor(config.tlsMode ?? 'PINNED', config.tlsPinSha256);
  }

  /** POST an api_sk-signed form request to /system?action=<action>. */
  private async request<T>(
    action: string,
    extra: Record<string, string> = {},
    schema?: ZodType<T>,
  ): Promise<T> {
    return this.post<T>(`system?action=${encodeURIComponent(action)}`, extra, schema);
  }

  /**
   * Generic signed POST to an arbitrary panel path (after baseUrl).
   * Signs the request with api_sk and sends application/x-www-form-urlencoded.
   * All Node.js project endpoints use this; /system endpoints delegate here via request().
   */
  private async post<T>(
    path: string,
    fields: Record<string, string> = {},
    schema?: ZodType<T>,
  ): Promise<T> {
    // One budget covers queueing and the request itself: a caller who asked for an
    // answer within timeoutMs gets an answer or an error within timeoutMs, not that
    // long waiting plus that long requesting (ADR-0004).
    const signal = AbortSignal.timeout(this.timeoutMs);
    const release = await this.takeSlot(signal);
    try {
      return await this.send<T>(path, fields, schema, signal);
    } finally {
      // Released only after the body is read — the connection is busy until then.
      release();
    }
  }

  /** Waits for a free slot to this panel, or reports that the panel is busy with us. */
  private async takeSlot(signal: AbortSignal): Promise<ReleaseSlot> {
    try {
      return await gateFor(this.origin, this.maxConcurrent).acquire(signal);
    } catch (err) {
      if (err instanceof PanelBusyError) {
        // Deliberately distinguishable from a silent panel: the operator needs to
        // know the queue is ours, not the panel's.
        throw new AaPanelError('timeout', `${err.message}; waited up to ${this.timeoutMs}ms`);
      }
      throw err;
    }
  }

  private async send<T>(
    path: string,
    fields: Record<string, string>,
    schema: ZodType<T> | undefined,
    signal: AbortSignal,
  ): Promise<T> {
    const auth = sign(this.apiSk, Math.floor(Date.now() / 1000));
    const body = new URLSearchParams({...auth, ...fields});
    const url = `${this.baseUrl}/${path}`;

    let res: Response;
    try {
      // undici's own fetch is used (not Node's global fetch) so that the undici
      // Agent can be passed as `dispatcher` — Node's global fetch rejects an
      // npm-undici Agent with UND_ERR_INVALID_ARG, which would silently drop the
      // certificate pinning and send api_sk over an unverified connection.
      const init: Parameters<typeof undiciFetch>[1] = {
        method: 'POST',
        headers: {'content-type': 'application/x-www-form-urlencoded'},
        body: body.toString(),
        signal,
      };
      if (this.dispatcher) init.dispatcher = this.dispatcher;
      res = (await undiciFetch(url, init)) as unknown as Response;
    } catch (err) {
      const mismatch = asPinMismatch(err);
      if (mismatch) {
        throw new AaPanelError(
          'tls_pin_mismatch',
          `Panel certificate changed: expected ${formatFingerprint(mismatch.expected)}, ` +
            `got ${formatFingerprint(mismatch.actual)}`,
        );
      }
      // AbortSignal.timeout() aborts with a DOMException named TimeoutError, NOT
      // AbortError — an AbortError only appears when a caller aborts the signal
      // itself. Some fetch/undici versions rethrow a wrapper and expose the abort
      // reason as `cause`, so both positions are checked. Missing this misreports
      // "panel did not answer in time" as a generic network failure.
      if (isAbortLike(err)) {
        throw new AaPanelError('timeout', `Request to ${path} timed out after ${this.timeoutMs}ms`);
      }
      const causeCode = (err as {cause?: {code?: string}}).cause?.code;
      const message = err instanceof Error ? err.message : 'Network error';
      throw new AaPanelError('network', `${message}${causeCode ? ` (${causeCode})` : ''}`);
    }

    if (res.status === 401 || res.status === 403) {
      throw new AaPanelError('auth', `Authentication failed (${res.status})`, res.status);
    }
    if (!res.ok) {
      throw new AaPanelError('panel_error', `Panel returned HTTP ${res.status}`, res.status);
    }
    const text = await readCapped(res, this.maxResponseBytes, path);
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new AaPanelError('panel_error', 'Panel returned a non-JSON response', res.status);
    }

    // No schema means the caller checks every field it touches by hand; with one,
    // a differently shaped answer becomes a named error instead of a crash deep in
    // the mapping code (PROJECT_RULES.md §16).
    if (!schema) return payload as T;
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      const denial = panelDenial(payload);
      if (denial) throw new AaPanelError('panel_error', denial, res.status);
      const issue = parsed.error.issues[0];
      const where = issue?.path.length ? issue.path.join('.') : 'response';
      throw new AaPanelError(
        'panel_error',
        `Panel returned an unexpected response for ${path}: ${where} — ${issue?.message ?? 'shape mismatch'}`,
        res.status,
      );
    }
    return parsed.data;
  }

  // ── Node.js project methods ──────────────────────────────────────────────

  /**
   * List Node.js projects with pagination, status, and CPU/RAM per project.
   *
   * Captured from a live v8 panel:
   *   run                              → true=running, false=stopped
   *   name                             → project name
   *   path                             → project directory
   *   project_config.port              → port
   *   load_info.<pid>.cpu_percent      → CPU usage % (summed across processes)
   *   load_info.<pid>.memory_used      → bytes → converted to MB
   *   load_info is empty {}            → project is stopped; cpu/mem = null
   */
  async listProjects(
    params: {p?: number; limit?: number; search?: string; re_order?: string} = {},
  ): Promise<PartialResult<NodeProject>> {
    const limit = params.limit ?? DEFAULT_PAGE_LIMIT;
    const data = JSON.stringify({
      p: params.p ?? 1,
      limit,
      // Normalized here rather than at the caller so that every route to a
      // panel goes through the same door — including callers written later.
      search: normalizeSearch(params.search),
      re_order: params.re_order ?? '',
    });
    const raw = await this.post('v2/project/nodejs/get_project_list', {data}, projectListResponse);

    const items = raw.message.data.map((p) => mapProject(p));
    const cut = describePage('projects', items.length, limit, raw.message.page);
    // Failures stay empty here: unlike the database and site lists, this one has
    // a single source and throws rather than degrading, so a caller either has
    // the whole answer or an error.
    return {items, failures: [], truncations: cut ? [cut] : []};
  }

  /**
   * Info about a single Node.js project.
   *
   * Captured from a live v8 panel.
   * Same shape as a list item; response is message (single object, no data[] wrapper).
   */
  async getProjectInfo(name: string): Promise<NodeProject> {
    const data = JSON.stringify({project_name: name});
    const raw = await this.post('v2/project/nodejs/get_project_info', {data}, projectInfoResponse);

    return mapProject(raw.message);
  }

  /**
   * Start, stop, or restart one or more Node.js projects.
   *
   * Captured from a live v8 panel.
   * FLAT body (no data= wrapper): project_names=<json-array> + operation_type.
   */
  async batchOperation(
    names: string[],
    op: ProjectOperation | 'delete',
  ): Promise<{msg: string; msg_list: Array<{name: string; status: boolean; msg: string}>}> {
    const raw = await this.post(
      'v2/project/nodejs/batch_operation_project',
      {project_names: JSON.stringify(names), operation_type: op},
      batchOperationResponse,
    );
    return raw.message;
  }

  /**
   * Run commands from the `scripts` section of a project's `package.json`.
   *
   * Captured from a live v8 panel.
   *   POST /v2/project/nodejs/get_run_list, body data={"project_cwd":"<path>"}
   *   Success: { status: 0, message: { "<key>": "<command>", ... } }
   *   Error  : { status: -1, message: { error_msg: "...", data: "..." } }
   *
   * Throws AaPanelError('panel_error') with the panel's error_msg when the
   * directory does not exist or has no readable package.json.
   */
  async getRunList(projectCwd: string): Promise<RunScript[]> {
    const data = JSON.stringify({project_cwd: projectCwd});
    const raw = await this.post<{
      status: number;
      message: Record<string, string> | {error_msg?: string; data?: string};
    }>('v2/project/nodejs/get_run_list', {data});

    if (raw.status !== 0) {
      const m = (raw.message ?? {}) as {error_msg?: string; data?: string};
      throw new AaPanelError('panel_error', m.error_msg || m.data || 'Failed to read package.json scripts');
    }
    const scripts = (raw.message ?? {}) as Record<string, string>;
    return Object.entries(scripts).map(([key, command]) => ({key, command: String(command)}));
  }

  /**
   * Node.js versions installed in the panel.
   * Captured from a live v8 panel (data= empty).
   */
  async getNodeVersions(): Promise<string[]> {
    const raw = await this.post<{status: number; message: unknown}>(
      'v2/project/nodejs/get_nodejs_version',
      {data: ''},
    );
    if (raw.status !== 0 || !Array.isArray(raw.message)) {
      throw new AaPanelError('panel_error', 'Failed to read Node.js versions');
    }
    return raw.message.filter((v): v is string => typeof v === 'string');
  }

  /**
   * Metadata for the create-project form (Node versions, package managers,
   * system users, RAM cap).
   *
   * Captured from a live v8 panel. NOTE the different path:
   * POST /v2/mod/nodejs/com/pre_env (no `data` field, auth fields only).
   */
  async getCreateEnv(): Promise<ProjectPreEnv> {
    const raw = await this.post<{
      status: number;
      message: {
        nodejs_versions?: unknown;
        package_managers?: unknown;
        user_list?: unknown;
        maximum_memory?: unknown;
      };
    }>('v2/mod/nodejs/com/pre_env');

    if (raw.status !== 0 || !raw.message || typeof raw.message !== 'object') {
      throw new AaPanelError('panel_error', 'Failed to read create-form metadata');
    }
    const m = raw.message;
    const strArray = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    return {
      nodejsVersions: strArray(m.nodejs_versions),
      packageManagers: strArray(m.package_managers),
      userList: strArray(m.user_list),
      maximumMemory: typeof m.maximum_memory === 'number' ? m.maximum_memory : 0,
    };
  }

  /**
   * Full configuration of a single project, for the edit form.
   * Reads `get_project_info` and pulls fields out of `project_config`.
   * Captured from a live v8 panel.
   */
  async getProjectConfig(name: string): Promise<NodeProjectConfig> {
    const data = JSON.stringify({project_name: name});
    const raw = await this.post<{
      status: number;
      message: {
        name?: string;
        path?: string;
        ps?: string;
        project_config?: {
          project_name?: string;
          project_cwd?: string;
          project_script?: string;
          port?: number;
          run_user?: string;
          nodejs_version?: string;
          project_ps?: string;
          is_power_on?: number;
          max_memory_limit?: number;
          domains?: string[];
        };
      };
    }>('v2/project/nodejs/get_project_info', {data});

    if (raw.status !== 0 || !raw.message) {
      throw new AaPanelError('panel_error', 'Failed to read project info');
    }
    const msg = raw.message;
    const cfg = msg.project_config ?? {};
    return {
      name: cfg.project_name ?? msg.name ?? name,
      cwd: cfg.project_cwd ?? msg.path ?? '',
      script: cfg.project_script ?? '',
      port: typeof cfg.port === 'number' ? cfg.port : null,
      runUser: cfg.run_user ?? '',
      nodejsVersion: cfg.nodejs_version ?? '',
      note: cfg.project_ps ?? msg.ps ?? '',
      powerOn: cfg.is_power_on === 1,
      maxMemoryLimit: typeof cfg.max_memory_limit === 'number' ? cfg.max_memory_limit : null,
      domains: Array.isArray(cfg.domains) ? cfg.domains : [],
    };
  }

  /**
   * Create a new Node.js project ("Default project" mode).
   * Captured from a live v8 panel.
   */
  async createProject(input: ProjectCreateInput): Promise<void> {
    const data = JSON.stringify({
      project_cwd: input.cwd,
      project_name: input.name,
      project_script: input.script,
      port: String(input.port),
      run_user: input.runUser,
      nodejs_version: input.nodejsVersion,
      project_ps: input.note,
      domains: input.domains,
      bind_extranet: input.bindExtranet ? 1 : 0,
      is_power_on: input.powerOn ? 1 : 0,
      max_memory_limit: input.maxMemoryLimit,
      project_env: input.env,
    });
    const raw = await this.post<{status: number; message: unknown}>(
      'v2/project/nodejs/create_project',
      {data},
    );
    this.assertProjectMutationOk(raw, 'Failed to create project');
  }

  /**
   * Modify an existing project's settings.
   * Captured from a live v8 panel.
   */
  async modifyProject(input: ProjectModifyInput): Promise<void> {
    const data = JSON.stringify({
      project_cwd: input.cwd,
      project_name: input.name,
      project_script: input.script,
      port: String(input.port),
      run_user: input.runUser,
      nodejs_version: input.nodejsVersion,
      project_ps: input.note,
      is_power_on: input.powerOn ? 1 : 0,
    });
    const raw = await this.post<{status: number; message: unknown}>(
      'v2/project/nodejs/modify_project',
      {data},
    );
    this.assertProjectMutationOk(raw, 'Failed to modify project');
  }

  /**
   * Delete a project (removes it from the panel; the on-disk directory is
   * preserved). Goes through `batch_operation_project` with operation_type=delete.
   * Captured from a live v8 panel (delete).
   */
  async deleteProject(name: string): Promise<void> {
    const result = await this.batchOperation([name], 'delete');
    const item = result.msg_list?.[0];
    if (item && item.status === false) {
      throw new AaPanelError('panel_error', item.msg || 'Failed to delete project');
    }
  }

  /**
   * Asserts a create/modify project response succeeded. These return
   * { status, message: { status_code, error_msg, data } }: top-level
   * status must be 0 AND the inner status_code must not be negative.
   */
  private assertProjectMutationOk(
    raw: {status?: number; message?: unknown},
    fallback: string,
  ): void {
    if (raw?.status !== 0) {
      throw new AaPanelError('panel_error', this.extractProjectError(raw?.message) || fallback);
    }
    const m = raw.message;
    if (m && typeof m === 'object') {
      const obj = m as {status_code?: number; error_msg?: string};
      if (typeof obj.status_code === 'number' && obj.status_code < 0) {
        throw new AaPanelError('panel_error', obj.error_msg || fallback);
      }
    }
  }

  /** Best-effort extraction of a human message from a panel error payload. */
  private extractProjectError(message: unknown): string | null {
    if (typeof message === 'string') return message;
    if (message && typeof message === 'object') {
      const obj = message as {error_msg?: unknown; data?: unknown; result?: unknown};
      for (const v of [obj.error_msg, obj.result, obj.data]) {
        if (typeof v === 'string' && v) return v;
      }
    }
    return null;
  }

  /**
   * Retrieve PM2/build log for a Node.js project.
   *
   * Captured from a live v8 panel:
   *   POST /v2/project/nodejs/get_project_log
   *   Body: data={"project_name":"<name>"}
   *   Response: { status: 0, message: { result: "<log text>" } }
   */
  async getProjectLogs(name: string): Promise<string> {
    const data = JSON.stringify({project_name: name});
    const raw = await this.post('v2/project/nodejs/get_project_log', {data}, projectLogResponse);
    return raw.message.result;
  }

  // ── Files (directory browsing) ─────────────────────────────────────────────

  /**
   * List the sub-directories of a path — backs the directory picker used when
   * creating a project. Captured from a live v8 panel (flat body).
   * Returns only folder names (files are ignored here).
   */
  async listDir(path: string): Promise<{path: string; dirs: string[]}> {
    const raw = await this.post<{
      status: number;
      message: {path?: string; dir?: Array<{nm?: unknown}>} | string;
    }>('v2/files?action=GetDirNew', {
      path,
      is_operating: 'true',
      p: '1',
      showRow: '1000',
      disk: 'false',
    });

    if (raw.status !== 0 || !raw.message || typeof raw.message === 'string') {
      const msg = typeof raw.message === 'string' ? raw.message : 'Failed to list directory';
      throw new AaPanelError('panel_error', msg);
    }
    const dirs = (raw.message.dir ?? [])
      .map((d) => (typeof d?.nm === 'string' ? d.nm : ''))
      .filter((n) => n.length > 0)
      .sort((a, b) => a.localeCompare(b));
    return {path: raw.message.path ?? path, dirs};
  }

  // ── System monitoring ─────────────────────────────────────────────────────

  /**
   * Liveness + basic metrics.
   *
   * Captured from a live v8 panel:
   *   cpuRealUsed  → CPU usage in % (float, e.g. 5.9)
   *   memTotal     → total RAM in MB (e.g. 5782)
   *   memRealUsed  → RAM actually used in MB (e.g. 1125)
   *   mem %        → (memRealUsed / memTotal) * 100
   */
  async getSystemTotal(): Promise<SystemTotal> {
    const raw = await this.request<{cpuRealUsed?: number; memTotal?: number; memRealUsed?: number}>(
      'GetSystemTotal',
    );
    const cpu = typeof raw.cpuRealUsed === 'number' ? raw.cpuRealUsed : null;
    const mem =
      typeof raw.memTotal === 'number' && raw.memTotal > 0 && typeof raw.memRealUsed === 'number'
        ? (raw.memRealUsed / raw.memTotal) * 100
        : null;
    return {online: true, cpu, mem};
  }

  /**
   * Disk usage percent of the root mount ('/'), else the first parsable mount; null if none.
   *
   * Captured from a live v8 panel:
   *   Array of { path, size: [total, used, free, "32%"] }
   *   size[3] is the use-percent string (e.g. "32%").
   */
  async getDiskInfo(): Promise<number | null> {
    const raw = await this.request<Array<{path?: string; size?: unknown[]}>>('GetDiskInfo');
    if (!Array.isArray(raw) || raw.length === 0) return null;
    const parsePercent = (m: {size?: unknown[]}): number | null => {
      const pct = m.size?.[3]; // aaPanel: size = [total, used, free, "40%"]
      if (typeof pct !== 'string') return null;
      const n = Number.parseFloat(pct.replace('%', ''));
      return Number.isFinite(n) ? n : null;
    };
    const root = raw.find((m) => m.path === '/');
    return parsePercent(root ?? raw[0]);
  }

  /**
   * One snapshot for the cache. System metrics are required (failure ⇒ caller treats server
   * offline); disk is best-effort (null on failure) so a flaky disk call never hides a
   * healthy server.
   */
  async collectStatus(): Promise<ServerSnapshot> {
    const sys = await this.getSystemTotal();
    let disk: number | null = null;
    try {
      disk = await this.getDiskInfo();
    } catch {
      disk = null;
    }
    return {online: sys.online, cpu: sys.cpu, mem: sys.mem, disk};
  }

  /**
   * Realtime network speeds and system load average.
   *
   * Captured from a live v8 panel:
   *   up   → upload speed, KB/s (top-level number)
   *   down → download speed, KB/s (top-level number)
   *   load → OBJECT {one, five, fifteen, max, limit, safe} — NOT an array
   *
   * Returns {up: null, down: null, load: null} if the request throws — callers
   * treat all network/load fields as best-effort.
   */
  private async getNetwork(): Promise<{up: number | null; down: number | null; load: {one: number; five: number; fifteen: number} | null}> {
    const raw = await this.request<{
      up?: unknown;
      down?: unknown;
      load?: {one?: unknown; five?: unknown; fifteen?: unknown} | null;
    }>('GetNetWork');
    const up = typeof raw.up === 'number' ? raw.up : null;
    const down = typeof raw.down === 'number' ? raw.down : null;
    let load: {one: number; five: number; fifteen: number} | null = null;
    if (raw.load !== null && typeof raw.load === 'object' && !Array.isArray(raw.load)) {
      const one = raw.load.one;
      const five = raw.load.five;
      const fifteen = raw.load.fifteen;
      if (typeof one === 'number' && typeof five === 'number' && typeof fifteen === 'number') {
        load = {one, five, fifteen};
      }
    }
    return {up, down, load};
  }

  /**
   * Rich server metrics for the Overview page.
   *
   * Captured from a live v8 panel:
   *   GetSystemTotal: cpuRealUsed (cpu %), cpuNum (cores),
   *                   memTotal/memRealUsed (MB)
   *   GetDiskInfo:    size[3] → use% string e.g. "40%"
   *   GetNetWork:     up/down (top-level KB/s), load (object {one,five,fifteen})
   *
   * GetSystemTotal is REQUIRED — if it throws the caller treats the server as offline.
   * GetDiskInfo and GetNetWork are best-effort: failures produce null sub-metrics only.
   */
  // ── Database methods ──────────────────────────────────────────────────────

  /**
   * Unwraps the standard aaPanel envelope {status, message}.
   * Throws AaPanelError('panel_error') when status !== 0.
   */
  private unwrapEnvelope<T = {data?: unknown[]; result?: string}>(
    raw: {status?: number; message?: unknown},
  ): T {
    if (raw?.status !== 0) {
      const m = raw?.message;
      const msg =
        typeof m === 'string'
          ? m
          : m && typeof m === 'object' && 'result' in m
            ? String((m as {result: unknown}).result)
            : 'Operation failed';
      throw new AaPanelError('panel_error', msg);
    }
    return raw.message as T;
  }

  /**
   * List all databases across MySQL and PostgreSQL engines.
   *
   * Each engine is queried independently: one falling over must not hide the other.
   * A failure is REPORTED rather than swallowed (ADR-0003) — an operator who cannot
   * tell "no databases" from "MySQL did not answer" may create a duplicate or delete
   * something they think is stray. Passwords are never included in the output.
   *
   * Captured from a live v8 panel
   *   MySQL  POST /v2/data?action=getData  (flat body: table=databases&p=1&limit=...)
   *   PG     POST /v2/database/pgsql/get_list  (body: data=<JSON {p,limit,search,table}>)
   */
  async listDatabases(
    params: {p?: number; limit?: number; search?: string} = {},
  ): Promise<PartialResult<Database>> {
    const p = params.p ?? 1;
    const limit = params.limit ?? DEFAULT_PAGE_LIMIT;
    const search = normalizeSearch(params.search);

    const [mysql, pgsql] = await Promise.all([
      (async (): Promise<PartialResult<Database>> => {
        try {
          const raw = await this.post(
            'v2/data?action=getData',
            {table: 'databases', p: String(p), limit: String(limit), search},
            mysqlDatabaseListResponse,
          );
          const msg = this.unwrapEnvelope<typeof raw.message>(raw);
          const items = (msg.data ?? []).map((r) => ({
            engine: 'mysql' as DbEngine,
            id: r.id,
            name: r.name,
            username: r.username,
            access: r.accept,
            note: r.ps,
            addtime: r.addtime,
            backupCount: r.backup_count ?? 0,
          }));
          const cut = describePage('mysql', items.length, limit, msg.page);
          return {items, failures: [], truncations: cut ? [cut] : []};
        } catch (err) {
          return {items: [], failures: [describeSourceFailure('mysql', err)], truncations: []};
        }
      })(),
      (async (): Promise<PartialResult<Database>> => {
        try {
          const data = JSON.stringify({p, limit, search, table: 'databases'});
          const raw = await this.post('v2/database/pgsql/get_list', {data}, pgsqlDatabaseListResponse);
          const msg = this.unwrapEnvelope<typeof raw.message>(raw);
          const items = (msg.data ?? []).map((r) => ({
            engine: 'pgsql' as DbEngine,
            id: r.id,
            name: r.name,
            username: r.username,
            access: r.listen_ip,
            note: r.ps,
            addtime: r.addtime,
            backupCount: r.backup_count ?? 0,
          }));
          const cut = describePage('pgsql', items.length, limit, msg.page);
          return {items, failures: [], truncations: cut ? [cut] : []};
        } catch (err) {
          return {items: [], failures: [describeSourceFailure('pgsql', err)], truncations: []};
        }
      })(),
    ]);

    return {
      items: [...mysql.items, ...pgsql.items],
      failures: [...mysql.failures, ...pgsql.failures],
      // Kept per engine rather than summed: "1000 of 1200 databases" hides which
      // engine to go looking in, and the two are managed through different APIs.
      truncations: [...mysql.truncations, ...pgsql.truncations],
    };
  }

  /**
   * List the sites on this panel.
   *
   * Source: the sites documentation — POST /v2/data?action=getData with table=sites.
   *
   * The panel decides the scope, not us: its own answer reports
   * `project_type IN ('PHP', 'WP')`, so Node and Python projects are absent by
   * design. They have their own sections here for the same reason — a Node
   * project is managed with different calls entirely.
   *
   * Returns a PartialResult like the database list does, though there is one
   * source today. Sites have subtypes, and the databases module already proved
   * that a panel can serve two subtypes from two different endpoints; when the
   * second one arrives, callers keep working instead of being rewritten
   * (ADR-0003).
   */
  async listSites(params: {p?: number; limit?: number; search?: string} = {}): Promise<PartialResult<Site>> {
    const limit = params.limit ?? DEFAULT_PAGE_LIMIT;
    try {
      const raw = await this.post(
        'v2/data?action=getData',
        {
          table: 'sites',
          p: String(params.p ?? 1),
          limit: String(limit),
          search: normalizeSearch(params.search),
          order: '',
          type: '-1',
          re_order: '',
        },
        siteListResponse,
      );
      const msg = this.unwrapEnvelope<typeof raw.message>(raw);
      const items: Site[] = (msg.data ?? []).map((r) => ({
        id: r.id,
        // `rname` is the panel's display name and matches `name` in every
        // sample; fall back rather than assume either is always present.
        name: r.rname || r.name,
        path: r.path,
        // The panel stores the flag as the string "1", not a boolean.
        running: r.status === '1',
        phpVersion: r.php_version,
        type: r.project_type,
        // -1 means "no certificate". Anything else is a certificate id, so the
        // only reliable reading is "not -1", not "truthy": 0 is also a value.
        sslEnabled: sslIsSet(r.ssl) || sslIsSet(r.site_ssl),
        domainCount: r.domain,
        note: r.ps,
        addtime: r.addtime,
        backupCount: r.backup_count,
      }));
      const cut = describePage('sites', items.length, limit, msg.page);
      return {items, failures: [], truncations: cut ? [cut] : []};
    } catch (err) {
      return {items: [], failures: [describeSourceFailure('sites', err)], truncations: []};
    }
  }

  /**
   * Everything the site card shows, gathered from four independent calls.
   *
   * Each section fails on its own. A card that refused to render because SSL
   * timed out would hide the domain list, and a blank domain list reads as
   * "this site has no domains" rather than "the app did not manage to ask"
   * (ADR-0003, applied to an object rather than a list).
   *
   * The four run in parallel and the per-panel limiter (ADR-0004) decides how
   * many actually leave at once — which is why this stays four calls and not a
   * queue of its own.
   *
   * Three of the four identify a site by its primary domain rather than by id;
   * the fourth wants both, plus the document root.
   */
  async getSiteDetail(site: {id: number; name: string; path: string}): Promise<SiteDetail> {
    const failures: SourceFailure[] = [];

    const [domains, directory, ssl, phpVersion] = await Promise.all([
      (async (): Promise<SiteDomain[] | null> => {
        try {
          const raw = await this.post(
            'v2/data?action=getData',
            {table: 'domain', list: 'True', search: String(site.id)},
            siteDomainListResponse,
          );
          // unwrapEnvelope is skipped here on purpose: its default type assumes
          // an object payload, and this endpoint's payload is the array itself.
          if (raw.status !== 0) throw new AaPanelError('panel_error', 'Operation failed');
          return raw.message.map((d) => ({
            id: d.id,
            name: d.name,
            port: d.port,
            addtime: d.addtime,
          }));
        } catch (err) {
          failures.push(describeSourceFailure('domains', err));
          return null;
        }
      })(),

      (async (): Promise<SiteDirectory | null> => {
        try {
          const raw = await this.post(
            'v2/site?action=GetDirUserINI',
            {id: String(site.id), path: site.path},
            siteDirUserIniResponse,
          );
          const msg = this.unwrapEnvelope<typeof raw.message>(raw);
          return {
            runPath: msg.runPath?.runPath ?? '/',
            availableDirs: msg.runPath?.dirs ?? [],
            userIniProtected: msg.userini ?? false,
            accessLogEnabled: msg.logs?.result ?? false,
            passwordProtected: msg.pass?.result ?? false,
          };
        } catch (err) {
          failures.push(describeSourceFailure('directory', err));
          return null;
        }
      })(),

      (async (): Promise<SiteSsl | null> => {
        try {
          const raw = await this.post(
            'v2/site?action=GetSSL',
            {siteName: site.name},
            siteSslResponse,
          );
          const msg = this.unwrapEnvelope<typeof raw.message>(raw);
          return {
            enabled: msg.status,
            forceHttps: msg.httpTohttps,
            domains: msg.domain.map((d) => d.name),
            tlsVersions: msg.tls_versions,
            // -1 means off. The field is a number on the panel this was
            // captured from, but a boolean is cheap to allow for and the
            // alternative is an "on" badge on a site that renews nothing.
            autoRenew: msg.auto_renew === true || msg.auto_renew === 1,
            email: msg.email,
            certificate: msg.cert_data ?? null,
          };
        } catch (err) {
          failures.push(describeSourceFailure('ssl', err));
          return null;
        }
      })(),

      (async (): Promise<string | null> => {
        try {
          const raw = await this.post(
            'v2/site?action=GetSitePHPVersion',
            {siteName: site.name},
            sitePhpVersionResponse,
          );
          const msg = this.unwrapEnvelope<typeof raw.message>(raw);
          return dottedPhpVersion(msg.phpversion);
        } catch (err) {
          failures.push(describeSourceFailure('php', err));
          return null;
        }
      })(),
    ]);

    return {domains, directory, ssl, phpVersion, failures};
  }

  /**
   * Tail of the site's access log.
   *
   * Kept out of getSiteDetail and fetched only when the log is actually looked
   * at: it is the one part of the card that can be large, and pulling a hundred
   * lines for a tab nobody opens spends a slot on someone's production panel.
   *
   * An empty string is a real answer — a site with no traffic yet — and callers
   * must not turn it into an error.
   */
  async getSiteLogs(siteName: string, lines = 100): Promise<string> {
    const raw = await this.post(
      'v2/site?action=GetSiteLogs',
      {siteName, lines: String(lines), ip_area: '0'},
      siteLogsResponse,
    );
    return this.unwrapEnvelope<typeof raw.message>(raw).result;
  }

  // ── Scheduled tasks (cron) ────────────────────────────────────────────────

  /**
   * The scheduler's task list.
   *
   * Source: the cron documentation — POST /v2/crontab?action=GetCrontab with an
   * empty body meaning "everything".
   *
   * Returns a PartialResult like the other lists, and its `truncations` is
   * always empty — deliberately, not for want of trying. This endpoint takes no
   * row limit and returns no pagination markup, so there is nothing on our side
   * that could cut the list short and nothing in the answer that would report a
   * cap of the panel's own. An empty array here is therefore the strongest claim
   * of completeness this endpoint allows anyone to make.
   *
   * `search` is forwarded because the panel's own interface sends that field.
   * Which columns it matches has not been observed the way the site and database
   * searches were — those panels return the SQL they built, this one does not —
   * so the term narrows the list without a promise about how.
   */
  async listCronTasks(params: {search?: string} = {}): Promise<PartialResult<CronTask>> {
    try {
      const raw = await this.post(
        'v2/crontab?action=GetCrontab',
        {search: normalizeSearch(params.search), type_id: '', order_param: ''},
        cronListResponse,
      );
      // unwrapEnvelope is skipped for the same reason the domain list skips it:
      // its default type assumes an object payload, and this payload is the
      // array itself. A refusal fails the schema first and is reported with the
      // panel's own wording by send().
      if (raw.status !== 0) throw new AaPanelError('panel_error', 'Operation failed');

      const items: CronTask[] = raw.message.map((r) => {
        const id = panelInt(r.id);
        if (id === null) {
          // A task whose id cannot be read can never be opened, run or stopped,
          // and quietly dropping the row would understate the list — which is
          // the failure mode ADR-0003 exists to prevent. Better one named error
          // about a shape we do not understand than a list missing a row.
          throw new AaPanelError(
            'panel_error',
            `Panel sent a scheduled task with an unreadable id (${JSON.stringify(r.id)})`,
          );
        }
        return {
          id,
          name: r.name,
          cycle: r.cycle,
          type: r.type,
          typeLabel: r.type_zh,
          interval: String(r.where1),
          hour: panelInt(r.where_hour),
          minute: panelInt(r.where_minute),
          kind: r.sType,
          target: r.sName,
          user: r.user,
          // 1 is running, 0 is stopped, and a stopped task stays in the list —
          // which is the whole reason the flag is shown rather than filtered on.
          enabled: panelInt(r.status) === 1,
          script: r.sBody,
        };
      });
      return {items, failures: [], truncations: []};
    } catch (err) {
      return {items: [], failures: [describeSourceFailure('cron', err)], truncations: []};
    }
  }

  /**
   * Output of a scheduled task's last run.
   *
   * The panel keeps only the most recent run, so this is a snapshot and not a
   * history — a task that fails every night looks exactly like one that failed
   * once. Worth knowing before anyone treats a clean log as proof.
   *
   * An empty string is a real answer: a task that has never run yet, or one
   * whose script prints nothing. Callers must not turn it into an error.
   */
  async getCronLogs(id: number): Promise<string> {
    const raw = await this.post(
      'v2/crontab?action=GetLogs',
      {id: String(id)},
      cronLogsResponse,
    );
    return this.unwrapEnvelope<typeof raw.message>(raw).result;
  }

  /**
   * Runs a task now, outside its schedule.
   *
   * Cannot be undone — the script has run — but it is the same script the
   * schedule runs anyway, which is why this is the safest of the three changing
   * operations and not a dangerous new capability. The panel answers as soon as
   * it has started the task, not when the task finishes, so a slow script is
   * still running when this resolves.
   */
  async runCronTask(id: number): Promise<void> {
    const raw = await this.post(
      'v2/crontab?action=StartTask',
      {id: String(id)},
      cronMutationResponse,
    );
    // Success is `status === 0` and nothing else. The panel's own word for it
    // differs per action — a stable token for one, a sentence in the panel's
    // display language for another — so matching the text would tie the fleet
    // to whichever language one panel happens to be set to. unwrapEnvelope
    // throws with the panel's wording when the status says no.
    this.unwrapEnvelope(raw);
  }

  /**
   * Brings a task to the state the operator asked for, enabled or stopped.
   *
   * The awkward part is the panel's: `set_cron_status` **toggles**. There is no
   * field for the state you want, so the only way to set one is to know the
   * current state — and the only trustworthy source of that is the panel,
   * now. Acting on what a browser last saw would flip a task the wrong way
   * whenever the two disagree, which is exactly the case the local-cache
   * invariant is about (§16): a screen minutes old, or a change made in the
   * panel itself, and one click stops a client's backup instead of starting it.
   *
   * So the list is re-read first. Returns `already` when nothing needed doing,
   * which is a real outcome worth showing rather than a silent success.
   *
   * The check-then-act gap cannot be closed from here — the panel offers no
   * conditional form of this call — so a change made in the same second still
   * wins. It narrows the window from "as old as the screen" to "as old as one
   * request", which is the difference between a common mistake and a rare one.
   *
   * `if_stop` stays false. True additionally kills the task if it happens to be
   * running, and a backup cut off halfway is worse than one that finishes.
   */
  async setCronTaskEnabled(id: number, enabled: boolean): Promise<'changed' | 'already'> {
    const {items, failures} = await this.listCronTasks();
    if (failures.length > 0) {
      // Refusing beats guessing: without the current state this call is a coin
      // toss on someone's production schedule.
      throw new AaPanelError(
        'panel_error',
        `Cannot change task ${id}: the panel would not say what state it is in`,
      );
    }
    const current = items.find((task) => task.id === id);
    if (!current) {
      throw new AaPanelError('panel_error', `Scheduled task ${id} no longer exists on the panel`);
    }
    if (current.enabled === enabled) return 'already';

    const raw = await this.post(
      'v2/crontab?action=set_cron_status',
      {id: String(id), if_stop: 'false'},
      cronMutationResponse,
    );
    this.unwrapEnvelope(raw);
    return 'changed';
  }

  /**
   * Deletes a scheduled task.
   *
   * Irreversible on someone else's machine: the panel keeps no trash for these,
   * and a deleted backup schedule is noticed the day the backup is wanted. The
   * confirmation and the journal entry that go with it are the caller's job —
   * see the action, where both live (Д-19).
   */
  async deleteCronTask(id: number): Promise<void> {
    const raw = await this.post(
      'v2/crontab?action=DelCrontab',
      {id: String(id)},
      cronMutationResponse,
    );
    this.unwrapEnvelope(raw);
  }

  /**
   * Create a MySQL or PostgreSQL database.
   *
   * Captured from a live v8 panel
   *   MySQL POST /v2/database?action=AddDatabase (flat body)
   *   PG    POST /v2/database/pgsql/AddDatabase  (body: data=<JSON>)
   */
  async createDatabase(input: DbCreateInput): Promise<void> {
    const access = input.access ?? '127.0.0.1';
    const note = input.note ?? '';

    if (input.engine === 'pgsql') {
      const data = JSON.stringify({
        sid: 0,
        name: input.name,
        db_user: input.user,
        password: input.password,
        active: false,
        ssl: '',
        ps: note,
      });
      const raw = await this.post<{status: number; message: unknown}>(
        'v2/database/pgsql/AddDatabase',
        {data},
      );
      this.unwrapEnvelope(raw);
    } else {
      const charset = input.charset ?? 'utf8mb4';
      const raw = await this.post<{status: number; message: unknown}>(
        'v2/database?action=AddDatabase',
        {
          sid: '0',
          name: input.name,
          codeing: charset,
          db_user: input.user,
          password: input.password,
          dataAccess: access,
          address: access,
          active: 'false',
          ssl: '',
          ps: note,
          dtype: 'MySQL',
        },
      );
      this.unwrapEnvelope(raw);
    }
  }

  /**
   * Delete a MySQL or PostgreSQL database by id and name.
   *
   * Captured from a live v8 panel
   *   MySQL POST /v2/database?action=DeleteDatabase (flat body: name=&id=)
   *   PG    POST /v2/database/pgsql/DeleteDatabase   (body: data=<JSON {id,name}>)
   */
  async deleteDatabase(engine: DbEngine, opts: {id: number; name: string}): Promise<void> {
    if (engine === 'pgsql') {
      const data = JSON.stringify({id: opts.id, name: opts.name});
      const raw = await this.post<{status: number; message: unknown}>(
        'v2/database/pgsql/DeleteDatabase',
        {data},
      );
      this.unwrapEnvelope(raw);
    } else {
      const raw = await this.post<{status: number; message: unknown}>(
        'v2/database?action=DeleteDatabase',
        {name: opts.name, id: String(opts.id)},
      );
      this.unwrapEnvelope(raw);
    }
  }

  async getMetrics(): Promise<ServerMetrics> {
    // Required: if GetSystemTotal fails, propagate — server is offline.
    const sys = await this.request<{
      cpuRealUsed?: number;
      cpuNum?: number;
      memTotal?: number;
      memRealUsed?: number;
    }>('GetSystemTotal');

    const cpuPercent = typeof sys.cpuRealUsed === 'number' ? sys.cpuRealUsed : null;
    const cores = typeof sys.cpuNum === 'number' ? sys.cpuNum : null;
    const memTotalMb = typeof sys.memTotal === 'number' ? sys.memTotal : null;
    const memUsedMb = typeof sys.memRealUsed === 'number' ? sys.memRealUsed : null;
    const memPercent =
      memTotalMb !== null && memTotalMb > 0 && memUsedMb !== null
        ? (memUsedMb / memTotalMb) * 100
        : null;

    // Best-effort: disk failure does not fail the whole metrics call.
    let diskPercent: number | null = null;
    try {
      diskPercent = await this.getDiskInfo();
    } catch {
      diskPercent = null;
    }

    // Best-effort: network/load failure produces null sub-metrics only.
    let netUpKbps: number | null = null;
    let netDownKbps: number | null = null;
    let load: {one: number; five: number; fifteen: number} | null = null;
    try {
      const net = await this.getNetwork();
      netUpKbps = net.up;
      netDownKbps = net.down;
      load = net.load;
    } catch {
      netUpKbps = null;
      netDownKbps = null;
      load = null;
    }

    return {cpuPercent, cores, load, memUsedMb, memTotalMb, memPercent, diskPercent, netUpKbps, netDownKbps};
  }
}

// ── Node.js project helpers ───────────────────────────────────────────────

/**
 * Raw project shape shared by get_project_list items and get_project_info message.
 * Captured from a live v8 panel.
 */
/**
 * One project as the panel reports it. Shape comes from the response schema, so the
 * declaration cannot drift from what is actually validated: `path` and `run` are
 * optional because older panels omit them, which mapProject has always handled.
 */
type RawNodeProject = RawNodeProjectParsed;

/**
 * Maps a raw panel project record to a normalized NodeProject.
 *
 * status: branch on `run` (boolean), NOT on localized text.
 * cpu: sum of cpu_percent across all load_info entries (null when load_info is empty).
 * mem: sum of memory_used bytes across all entries, converted to MB (null when empty).
 */
/**
 * The panel's two spellings of one PHP version, reduced to the readable one.
 *
 * The site list sends "8.3"; the site's own PHP endpoint sends "83" for the
 * same install. Neither is wrong, but showing both in one interface makes the
 * card look like it disagrees with the list it was opened from. "83" becomes
 * "8.3"; anything already dotted, empty, or shaped some third way is passed
 * through untouched rather than mangled by a rule written for two digits.
 */
function dottedPhpVersion(raw: string): string {
  return /^\d{2}$/.test(raw) ? `${raw[0]}.${raw[1]}` : raw;
}

/**
 * Does this site have a certificate?
 *
 * The panel writes -1 for "none" and a certificate id otherwise, and sends it
 * as a number on some versions and a string on others. Reading it as truthy
 * would be wrong twice over: -1 is truthy, and 0 is a legitimate id.
 */
function sslIsSet(value: number | string | undefined): boolean {
  if (value === undefined || value === null || value === '') return false;
  const n = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(n) && n !== -1;
}

/**
 * A number the panel may have sent as a string, or not sent at all.
 *
 * Panels are inconsistent about this in ways that are not worth fighting: the
 * site list sends its status as "1" while the scheduler sends 1, and both are
 * the same claim. Returns null for anything unreadable rather than 0, because
 * the two mean different things — "no hour set" is not "midnight".
 */
function panelInt(value: number | string | null | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapProject(p: RawNodeProject): NodeProject {
  const status = p.run === true ? 'running' : p.run === false ? 'stopped' : 'unknown';
  const port = p.project_config?.port ?? null;
  const path = p.path ?? null;

  const loadEntries = p.load_info ? Object.values(p.load_info) : [];
  let cpu: number | null = null;
  let mem: number | null = null;

  if (loadEntries.length > 0) {
    let totalCpu = 0;
    let totalMemBytes = 0;
    for (const entry of loadEntries) {
      if (typeof entry.cpu_percent === 'number') totalCpu += entry.cpu_percent;
      if (typeof entry.memory_used === 'number') totalMemBytes += entry.memory_used;
    }
    cpu = totalCpu;
    mem = totalMemBytes / (1024 * 1024); // bytes → MB
  }

  return {name: p.name, status, port, path, cpu, mem};
}
