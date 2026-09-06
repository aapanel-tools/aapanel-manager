import type {Agent} from 'undici';
import {fetch as undiciFetch} from 'undici';
import type {ZodType} from 'zod';
import {sign} from './signing';
import {
  batchOperationResponse,
  mysqlDatabaseListResponse,
  pgsqlDatabaseListResponse,
  projectInfoResponse,
  projectListResponse,
  projectLogResponse,
  type RawNodeProjectParsed,
} from './schemas';
import {TlsPinMismatchError, dispatcherFor, formatFingerprint} from './tls';
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
  type Database,
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
   * Field mapping sourced from docs/en/nodejs-projects.md §get_project_list:
   *   run                              → true=running, false=stopped
   *   name                             → project name
   *   path                             → project directory
   *   project_config.port              → port
   *   load_info.<pid>.cpu_percent      → CPU usage % (summed across processes)
   *   load_info.<pid>.memory_used      → bytes → converted to MB
   *   load_info is empty {}            → project is stopped; cpu/mem = null
   */
  async listProjects(params: {p?: number; limit?: number; search?: string; re_order?: string} = {}): Promise<NodeProject[]> {
    const data = JSON.stringify({
      p: params.p ?? 1,
      limit: params.limit ?? 1000,
      search: params.search ?? '',
      re_order: params.re_order ?? '',
    });
    const raw = await this.post('v2/project/nodejs/get_project_list', {data}, projectListResponse);

    return raw.message.data.map((p) => mapProject(p));
  }

  /**
   * Info about a single Node.js project.
   *
   * Field mapping sourced from docs/en/nodejs-projects.md §get_project_info.
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
   * Field mapping sourced from docs/en/nodejs-projects.md §batch_operation_project.
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
   * Source: docs/en/nodejs-projects.md §get_run_list.
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
   * Source: docs/en/nodejs-projects.md §get_nodejs_version (data= empty).
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
   * Source: docs/en/nodejs-projects.md §pre_env. NOTE the different path:
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
   * Source: docs/en/nodejs-projects.md §get_project_info.
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
   * Source: docs/en/nodejs-projects.md §create_project.
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
   * Source: docs/en/nodejs-projects.md §modify_project.
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
   * Source: docs/en/nodejs-projects.md §batch_operation_project (delete).
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
   * Field mapping sourced from docs/en/nodejs-projects.md §Logs (§10):
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
   * creating a project. Source: docs/en/files.md §GetDirNew (flat body).
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
   * Field mapping sourced from docs/en/system-monitoring.md (real v8 panel response):
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
   * Response shape sourced from docs/en/system-monitoring.md (real v8 panel):
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
   * Field mapping sourced from docs/en/system-monitoring.md §GetNetWork (real panel):
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
   * Field mapping sourced from docs/en/system-monitoring.md:
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
   * Field sources: docs/en/databases.md
   *   MySQL  POST /v2/data?action=getData  (flat body: table=databases&p=1&limit=...)
   *   PG     POST /v2/database/pgsql/get_list  (body: data=<JSON {p,limit,search,table}>)
   */
  async listDatabases(
    params: {p?: number; limit?: number; search?: string} = {},
  ): Promise<PartialResult<Database>> {
    const p = params.p ?? 1;
    const limit = params.limit ?? 1000;
    const search = params.search ?? '';

    const [mysql, pgsql] = await Promise.all([
      (async (): Promise<PartialResult<Database>> => {
        try {
          const raw = await this.post(
            'v2/data?action=getData',
            {table: 'databases', p: String(p), limit: String(limit), search},
            mysqlDatabaseListResponse,
          );
          const msg = this.unwrapEnvelope<{data: typeof raw.message.data}>(raw);
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
          return {items, failures: []};
        } catch (err) {
          return {items: [], failures: [describeSourceFailure('mysql', err)]};
        }
      })(),
      (async (): Promise<PartialResult<Database>> => {
        try {
          const data = JSON.stringify({p, limit, search, table: 'databases'});
          const raw = await this.post('v2/database/pgsql/get_list', {data}, pgsqlDatabaseListResponse);
          const msg = this.unwrapEnvelope<{data: typeof raw.message.data}>(raw);
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
          return {items, failures: []};
        } catch (err) {
          return {items: [], failures: [describeSourceFailure('pgsql', err)]};
        }
      })(),
    ]);

    return {
      items: [...mysql.items, ...pgsql.items],
      failures: [...mysql.failures, ...pgsql.failures],
    };
  }

  /**
   * Create a MySQL or PostgreSQL database.
   *
   * Field sources: docs/en/databases.md
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
   * Field sources: docs/en/databases.md
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
 * Docs: docs/en/nodejs-projects.md §1 and §2.
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
