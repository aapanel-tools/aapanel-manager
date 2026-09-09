export type AaPanelErrorKind =
  | 'network'
  | 'timeout'
  | 'auth'
  | 'panel_error'
  /** The panel presented a certificate other than the pinned one (ADR-0002). */
  | 'tls_pin_mismatch';

export type ProjectOperation = 'start' | 'stop' | 'restart';

export interface NodeProject {
  name: string;
  status: 'running' | 'stopped' | 'unknown';
  port: number | null;
  path: string | null;
  cpu: number | null;
  mem: number | null; // MB
}

/**
 * One run command from a project's `package.json` `scripts` section.
 * Source: docs/en/nodejs-projects.md §get_run_list (`{key: command}` map).
 */
export interface RunScript {
  key: string; // script key, e.g. "start", "prod:start"
  command: string; // resolved command, e.g. "node server.js"
}

/**
 * Metadata for the create-project form.
 * Source: docs/en/nodejs-projects.md §pre_env.
 */
export interface ProjectPreEnv {
  nodejsVersions: string[];
  packageManagers: string[];
  userList: string[];
  maximumMemory: number; // server RAM cap for the PM2 memory limit, MB
}

/**
 * Full configuration of a single project, for the edit form.
 * Source: docs/en/nodejs-projects.md §get_project_info (`project_config`).
 */
export interface NodeProjectConfig {
  name: string; // project_name
  cwd: string; // project_cwd — identifies the project
  script: string; // project_script — key from package.json scripts
  port: number | null;
  runUser: string; // run_user
  nodejsVersion: string; // nodejs_version
  note: string; // project_ps / ps
  powerOn: boolean; // is_power_on
  maxMemoryLimit: number | null; // max_memory_limit, MB
  domains: string[];
}

/**
 * Input for `modify_project`.
 * Source: docs/en/nodejs-projects.md §modify_project.
 */
export interface ProjectModifyInput {
  cwd: string;
  name: string;
  script: string;
  port: number;
  runUser: string;
  nodejsVersion: string;
  note: string;
  powerOn: boolean;
}

/**
 * Input for `create_project` ("Default project" mode).
 * Source: docs/en/nodejs-projects.md §create_project.
 */
export interface ProjectCreateInput {
  cwd: string;
  name: string;
  script: string;
  port: number;
  runUser: string;
  nodejsVersion: string;
  note: string;
  domains: string[];
  bindExtranet: boolean;
  powerOn: boolean;
  maxMemoryLimit: number;
  env: string;
}

import type {TlsMode} from './tls';

export type {TlsMode};

export class AaPanelError extends Error {
  constructor(
    public readonly kind: AaPanelErrorKind,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'AaPanelError';
  }
}

/**
 * One source that did not answer, in terms an operator understands.
 *
 * `source` names the thing that failed the way the domain names it — an engine
 * ('mysql', 'pgsql'), later a server or a site subtype — not an internal id.
 */
export interface SourceFailure {
  source: string;
  kind: AaPanelErrorKind;
  message: string;
}

/**
 * Data plus what could not be fetched (ADR-0003).
 *
 * Used wherever a result is assembled from several independent sources, so that
 * a source falling over produces a visible gap instead of a shorter list that
 * looks complete. An empty `failures` is an assertion of completeness, not silence.
 */
export interface PartialResult<T> {
  items: T[];
  failures: SourceFailure[];
}

/** Normalizes anything thrown by a source into a failure the interface can show. */
/**
 * What each failure kind means, in words an operator can act on. The raw enum
 * name is not it: `tls_pin_mismatch` tells a developer what happened and tells
 * an operator nothing.
 *
 * This map is also the seam translation will use — one place that turns a kind
 * into a sentence, rather than the same phrase inlined at every call site.
 */
const KIND_PHRASE: Record<AaPanelErrorKind, string> = {
  network: 'panel unreachable',
  timeout: 'panel did not answer in time',
  auth: 'panel rejected the API key',
  panel_error: 'panel refused the request',
  tls_pin_mismatch: 'panel presented a different TLS certificate',
};

/**
 * The one phrasing for a panel failure shown to a person.
 *
 * `serverName` is what makes the message usable on a fleet: "panel presented a
 * different TLS certificate" is alarming and useless when twenty panels are
 * managed and it does not say whose (Д-4). Pass it wherever the message reaches
 * a toast or a form. Omit it only where the surrounding context already names
 * the server — a row in the servers table carries its own error, and repeating
 * the name there would just be noise.
 */
export function describeError(err: unknown, serverName?: string): string {
  const prefix = serverName ? `${serverName}: ` : '';
  if (err instanceof AaPanelError) {
    const phrase = KIND_PHRASE[err.kind];
    // The panel's own wording is the part worth reading; keep it when it adds
    // something the phrase does not already say.
    return err.message && err.message !== phrase
      ? `${prefix}${phrase} — ${err.message}`
      : `${prefix}${phrase}`;
  }
  if (err instanceof Error) return `${prefix}${err.message}`;
  return `${prefix}Unknown error`;
}

export function describeSourceFailure(source: string, err: unknown): SourceFailure {
  if (err instanceof AaPanelError) return {source, kind: err.kind, message: err.message};
  return {
    source,
    kind: 'panel_error',
    message: err instanceof Error ? err.message : 'Unknown error',
  };
}

export interface AaPanelClientConfig {
  baseUrl: string;
  apiSk: string;
  /** Defaults to PINNED: aaPanel ships a self-signed certificate. */
  tlsMode?: TlsMode;
  /** Required in PINNED mode. Pin it first — see clientForServer(). */
  tlsPinSha256?: string | null;
  timeoutMs?: number;
  /** Cap on the answer we will read from a panel, in bytes. Defaults to 8 MiB. */
  maxResponseBytes?: number;
  /** Simultaneous requests allowed to one panel. Defaults to 4 (ADR-0004). */
  maxConcurrentRequests?: number;
}

/** Normalized server metrics for the status cache. Nulls when not derivable. */
export interface SystemTotal {
  online: boolean;
  cpu: number | null; // percent 0..100
  mem: number | null; // percent 0..100
}

export type DbEngine = 'mysql' | 'pgsql';

export interface Database {
  engine: DbEngine;
  id: number;
  name: string;
  username: string;
  access: string; // mysql: accept · pgsql: listen_ip
  note: string;   // ps
  addtime: string;
  backupCount: number;
}

export interface DbCreateInput {
  engine: DbEngine;
  name: string;
  user: string;
  password: string;
  access?: string;  // default 127.0.0.1
  note?: string;
  charset?: string; // mysql only, default utf8mb4
}

/** Combined server snapshot including disk usage. */
export interface ServerSnapshot {
  online: boolean;
  cpu: number | null; // percent 0..100
  mem: number | null; // percent 0..100
  disk: number | null; // percent 0..100, best-effort (null on failure)
}

/**
 * Rich server metrics for the Overview page.
 * Field sources: docs/en/system-monitoring.md (GetSystemTotal, GetDiskInfo, GetNetWork).
 * Nulls indicate the sub-metric was unavailable (best-effort fields: disk, network, load).
 */
export interface ServerMetrics {
  cpuPercent: number | null;
  cores: number | null;
  load: {one: number; five: number; fifteen: number} | null;
  memUsedMb: number | null;
  memTotalMb: number | null;
  memPercent: number | null;
  diskPercent: number | null;
  netUpKbps: number | null;
  netDownKbps: number | null;
}
