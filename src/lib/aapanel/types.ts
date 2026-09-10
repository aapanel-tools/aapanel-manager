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
 * Captured from a live v8 panel (`{key: command}` map).
 */
export interface RunScript {
  key: string; // script key, e.g. "start", "prod:start"
  command: string; // resolved command, e.g. "node server.js"
}

/**
 * Metadata for the create-project form.
 * Captured from a live v8 panel.
 */
export interface ProjectPreEnv {
  nodejsVersions: string[];
  packageManagers: string[];
  userList: string[];
  maximumMemory: number; // server RAM cap for the PM2 memory limit, MB
}

/**
 * Full configuration of a single project, for the edit form.
 * Captured from a live v8 panel (`project_config`).
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
 * Captured from a live v8 panel.
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
 * Captured from a live v8 panel.
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
 * One source that had more rows than were read from it.
 *
 * The counterpart to SourceFailure, and the second way a list can be short of
 * the truth: nothing failed, the app simply stopped asking. `source` names the
 * thing the way the domain does, exactly as it does for a failure.
 *
 * `total` is the panel's own count when its pagination markup could be read,
 * and null when it could not. Null is "unknown", not "none" — an interface
 * showing it must say "there may be more", not "0 more".
 */
export interface SourceTruncation {
  source: string;
  /** Rows actually read. */
  shown: number;
  total: number | null;
}

/**
 * Data plus what could not be fetched (ADR-0003).
 *
 * Used wherever a result is assembled from several independent sources, so that
 * a source falling over produces a visible gap instead of a shorter list that
 * looks complete. An empty `failures` is an assertion of completeness, not silence.
 *
 * `truncations` carries the same assertion about a different failure of
 * completeness: a source that answered fine, but had more rows than were asked
 * for. Both arrays are required rather than optional so that every list either
 * claims to be whole or says how it is not — an absent field would be exactly
 * the silence this type exists to prevent.
 */
export interface PartialResult<T> {
  items: T[];
  failures: SourceFailure[];
  truncations: SourceTruncation[];
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

/**
 * One site as the app talks about it.
 *
 * The panel's raw shapes are normalised here rather than in the view: `status`
 * arrives as the string "1", and SSL as -1 meaning "none", which are facts about
 * the panel's storage, not about the site. Leaving them raw would spread that
 * trivia through every component that renders a site.
 *
 * `type` stays a plain string on purpose. The panel lists PHP and WP today and
 * nothing stops a version from adding another; a closed union would turn an
 * unknown-but-harmless type into a parse failure for the whole list.
 */
export interface Site {
  id: number;
  /** Primary domain — what the operator calls the site. */
  name: string;
  path: string;
  running: boolean;
  phpVersion: string;
  type: string;
  sslEnabled: boolean;
  /** How many domains point at this site, the panel's own count. */
  domainCount: number;
  note: string;
  addtime: string;
  backupCount: number;
}

/** One domain bound to a site. A site normally has several. */
export interface SiteDomain {
  id: number;
  name: string;
  port: number;
  addtime: string;
}

/**
 * Where a site is served from, and what guards the directory.
 *
 * `runPath` is relative to the document root: "/" means the root itself, and a
 * framework install often points it at "/public". Getting this wrong is how an
 * operator ends up staring at a directory listing instead of a site.
 */
export interface SiteDirectory {
  runPath: string;
  availableDirs: string[];
  /** `user.ini` guard: stops PHP escaping above the document root. */
  userIniProtected: boolean;
  accessLogEnabled: boolean;
  passwordProtected: boolean;
}

/**
 * TLS state of a site as the panel reports it.
 *
 * `certificate` stays `unknown` on purpose — see the schema. The panel this was
 * captured from had no certificate, so the shape of that payload is unverified,
 * and a typed guess here would be indistinguishable from a captured fact.
 */
export interface SiteSsl {
  enabled: boolean;
  forceHttps: boolean;
  /** Domains the certificate covers — not always the site's own list. */
  domains: string[];
  /** Which TLS versions the site accepts, panel's own naming ("TLSv1.2"). */
  tlsVersions: Record<string, boolean>;
  autoRenew: boolean;
  email: string;
  certificate: unknown;
}

/**
 * Everything the card shows about one site, assembled from four calls.
 *
 * Every section is nullable and `failures` says which source did not answer.
 * The alternative — failing the whole card when one call does — would hide the
 * domains because SSL timed out, and an operator reading a blank list concludes
 * the site has no domains rather than that the app did not ask properly
 * (ADR-0003 applied to an object instead of a list).
 */
export interface SiteDetail {
  domains: SiteDomain[] | null;
  directory: SiteDirectory | null;
  ssl: SiteSsl | null;
  /** Normalised to the dotted form: the panel sends "83" here and "8.3" in the list. */
  phpVersion: string | null;
  failures: SourceFailure[];
}

/**
 * One scheduled task as the panel reports it.
 *
 * The schedule is carried twice on purpose. `cycle` is the panel's own sentence
 * for it — the same words an operator sees inside the panel — and it is what
 * gets shown, because only one combination of the structured fields has ever
 * been captured from a live panel (`type: 'day'` with an hour and a minute).
 * What `where1` means for a weekly, monthly or every-N-minutes task is written
 * down in the API notes but has not been observed, and a schedule rendered from
 * a guess is a false statement about when something runs on someone else's
 * production machine. The structured fields are kept beside it so that a
 * fleet-wide, translated schedule can be built the moment the rest is captured.
 */
export interface CronTask {
  id: number;
  name: string;
  /** The panel's own schedule sentence, in the panel's display language. */
  cycle: string;
  /** Schedule shape as the panel stores it: `day`, `hour`, `week`, `minute-n`, … */
  type: string;
  /** The panel's label for that shape ("Per Day"), also in its own language. */
  typeLabel: string;
  /** Interval or day number, whose meaning depends on `type` — hence unparsed. */
  interval: string;
  hour: number | null;
  minute: number | null;
  /** What kind of task: `toShell`, a site or database backup, a log rotation, … */
  kind: string;
  /** What it acts on: `ALL` for a shell script, otherwise a site or database name. */
  target: string;
  /** The system user the task runs as — `root` on most panels. */
  user: string;
  /** The panel stores this as 1 or 0; a stopped task stays in the list. */
  enabled: boolean;
  /**
   * The shell script itself, for a `toShell` task.
   *
   * Shown only inside the task card, never in the list and never in a log line:
   * backup scripts on a hosting panel routinely carry a database password in
   * plain text, and a log file is a place secrets must not reach (§16).
   */
  script: string;
}

/**
 * One port rule as the panel keeps it.
 *
 * Values stay the panel's own words — `accept`/`drop`, `INPUT`/`OUTPUT`, `tcp`
 * — because a firewall is exactly the place not to paraphrase. A rule this
 * version has never seen is information about a client's machine, not a
 * rendering problem.
 */
export interface FirewallRule {
  /** A port or a range, e.g. "8080" or "39000-40000". */
  port: string;
  protocol: string;
  family: string;
  /** `accept` or `drop`. */
  strategy: string;
  /** `INPUT` for inbound, `OUTPUT` for outbound. */
  chain: string;
  /** Source scope: `all`, or a CIDR. */
  address: string;
  note: string;
  addtime: string;
  /** 0 for the built-in system ports, so it does not identify a row on its own. */
  id: number;
}

/**
 * The state of a server's firewall, gathered from two independent calls.
 *
 * `enabled` is nullable on purpose, and the difference matters more here than
 * anywhere else in this app: false means the firewall is off, which is a
 * finding worth shouting about, while null means the panel would not say — and
 * presenting the second as the first would raise a false alarm about someone
 * else's production machine (ADR-0003).
 */
export interface FirewallOverview {
  enabled: boolean | null;
  /** `ufw`, `firewalld`, `iptables` — whatever the distribution runs. */
  backend: string | null;
  /** Whether the host answers ping. */
  ping: boolean | null;
  counts: {port: number; ip: number; trans: number; country: number; banned: number} | null;
  updatedAt: string | null;
  failures: SourceFailure[];
}

/**
 * One FTP account.
 *
 * There is no password field, and its absence is the point rather than an
 * oversight. The panel returns every account's password in clear text with the
 * list; a type that could hold it is a type that will eventually be logged,
 * serialised into a page, or sent to a browser by someone in a hurry. What
 * cannot be represented cannot leak (§16), and an operator who genuinely needs
 * the password has the panel itself.
 */
export interface FtpUser {
  id: number;
  name: string;
  /** Home directory. Created by the panel when the account is added. */
  path: string;
  note: string;
  /** The panel stores this as the string "1"; false means the account is switched off. */
  enabled: boolean;
  addtime: string;
  /** Bytes used and the quota, when the panel reports them; 0 means unlimited. */
  quotaUsed: number;
  quotaSize: number;
}

/** What creating an FTP account needs. The password goes straight to the panel. */
export interface FtpCreateInput {
  username: string;
  password: string;
  path: string;
  note?: string;
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
 * Captured from a live v8 panel (GetSystemTotal, GetDiskInfo, GetNetWork).
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
