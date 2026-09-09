import {z} from 'zod';

/**
 * Schemas for aaPanel responses.
 *
 * A panel's answer is untrusted data (PROJECT_RULES.md §16): versions differ, fields
 * come and go, and a misconfigured panel can return HTML where JSON is expected. The
 * code used to index straight into the parsed body, so a differently shaped answer
 * crashed with "cannot read properties of undefined" instead of naming the server.
 *
 * These schemas cover the endpoints whose structure the client walks into. Fields the
 * client does not read are deliberately left out — unknown keys are stripped, not
 * rejected, so a newer panel adding fields keeps working. Endpoints that already
 * validate by hand (`GetSystemTotal`, `GetDiskInfo`, `GetNetWork`, `pre_env`,
 * `get_run_list`, `GetDirNew`) are left alone: they check every field they touch.
 */

/** aaPanel's standard envelope. The payload is validated per endpoint. */
const envelope = <T extends z.ZodType>(message: T) => z.object({status: z.number(), message});

/** One project as the panel reports it, in list and single-project responses alike. */
const rawNodeProject = z.object({
  name: z.string(),
  path: z.string().optional(),
  run: z.boolean().optional(),
  project_config: z.object({port: z.number().optional()}).optional(),
  load_info: z
    .record(
      z.string(),
      z.object({cpu_percent: z.number().optional(), memory_used: z.number().optional()}),
    )
    .optional(),
});

export type RawNodeProjectParsed = z.infer<typeof rawNodeProject>;

/**
 * Every paged list the panel serves carries its own pagination markup in `page`
 * — HTML built for the panel's interface, from which a row count can usually be
 * read. It is optional here on purpose: `paging.ts` treats an unreadable count
 * as unknown and falls back to comparing rows against the requested limit, so a
 * panel that omits or restyles this field costs precision, never correctness.
 *
 * `data`, by contrast, is required, and that difference is the point. An answer
 * with no rows array is not an empty list — it is a refusal or a shape we do not
 * understand, and defaulting it to `[]` turns "the panel said no" into "you have
 * no sites". Requiring it sends such an answer down the error path, where the
 * operator is told which endpoint and which field (PROJECT_RULES.md §16).
 */
const pagedList = <T extends z.ZodType>(row: T) =>
  z.object({data: z.array(row), page: z.string().default('')});

export const projectListResponse = envelope(pagedList(rawNodeProject));

export const projectInfoResponse = envelope(rawNodeProject);

export const batchOperationResponse = envelope(
  z.object({
    msg: z.string().default(''),
    msg_list: z
      .array(z.object({name: z.string(), status: z.boolean(), msg: z.string().default('')}))
      .default([]),
  }),
);

export const projectLogResponse = envelope(z.object({result: z.string()}));

/**
 * Site list row.
 *
 * Types follow the panel, not what would be tidy: `status` is the string "1",
 * `ssl` is the number -1 when no certificate is set, and `php_version` is
 * absent on a site that has no PHP. Every field the client reads has a default
 * so that one older panel omitting a column produces a slightly emptier row
 * rather than an unparseable list.
 *
 * `ico` (a base64 favicon) is deliberately not read: it is large, we never show
 * it, and unknown keys are stripped rather than rejected.
 */
export const siteListResponse = envelope(
  pagedList(
    z.object({
      id: z.number(),
      name: z.string(),
      rname: z.string().default(''),
      path: z.string().default(''),
      status: z.string().default(''),
      ps: z.string().default(''),
      addtime: z.string().default(''),
      php_version: z.string().default(''),
      project_type: z.string().default(''),
      ssl: z.union([z.number(), z.string()]).optional(),
      site_ssl: z.union([z.number(), z.string()]).optional(),
      domain: z.number().default(0),
      backup_count: z.number().default(0),
    }),
  ),
);

/** MySQL list row — `accept` carries the access scope. */
export const mysqlDatabaseListResponse = envelope(
  pagedList(
    z.object({
      id: z.number(),
      name: z.string(),
      username: z.string().default(''),
      accept: z.string().default(''),
      ps: z.string().default(''),
      addtime: z.string().default(''),
      backup_count: z.number().optional(),
    }),
  ),
);

/** PostgreSQL list row — the access scope lives in `listen_ip` instead of `accept`. */
export const pgsqlDatabaseListResponse = envelope(
  pagedList(
    z.object({
      id: z.number(),
      name: z.string(),
      username: z.string().default(''),
      listen_ip: z.string().default(''),
      ps: z.string().default(''),
      addtime: z.string().default(''),
      backup_count: z.number().optional(),
    }),
  ),
);

// ---------------------------------------------------------------------------
// Site card
//
// Five endpoints answer with five different envelope shapes. That is not
// tidiness lost in translation — it is what the panel actually sends, and a
// schema that smoothed it over would be describing a panel that does not exist.
// ---------------------------------------------------------------------------

/**
 * Domains bound to one site.
 *
 * `message` is the array itself here, with no `data` wrapper — from the very
 * same `getData` endpoint that wraps the site list. One endpoint, two shapes,
 * chosen by `table`. Hence no `pagedList`: it would look for a field the panel
 * does not send and reject every answer.
 *
 * An internationalised domain and its punycode form arrive as separate rows,
 * each with its own id, so a site with one name can list two domains.
 */
export const siteDomainListResponse = envelope(
  z.array(
    z.object({
      id: z.number(),
      /** Id of the site the domain belongs to. */
      pid: z.number(),
      name: z.string(),
      port: z.number().default(80),
      addtime: z.string().default(''),
    }),
  ),
);

/** Document root, the subdirectory actually served, and the protections on it. */
export const siteDirUserIniResponse = envelope(
  z.object({
    logs: z.object({result: z.boolean()}).optional(),
    userini: z.boolean().optional(),
    runPath: z
      .object({runPath: z.string().default('/'), dirs: z.array(z.string()).default([])})
      .optional(),
    pass: z.object({result: z.boolean()}).optional(),
  }),
);

/**
 * SSL state of one site.
 *
 * `cert_data` is deliberately `unknown`. The captured panel had no certificate
 * installed and sent null, so its shape has never been seen here. Inventing
 * fields for it would put a guess into the one layer whose job is to reject
 * guesses; it is carried through untyped until a real certificate is captured
 * from a panel that has one.
 */
export const siteSslResponse = envelope(
  z.object({
    status: z.boolean().default(false),
    oid: z.number().default(-1),
    domain: z.array(z.object({name: z.string()})).default([]),
    httpTohttps: z.boolean().default(false),
    cert_data: z.unknown().optional(),
    email: z.string().default(''),
    auth_type: z.string().default(''),
    tls_versions: z.record(z.string(), z.boolean()).default({}),
    auto_renew: z.union([z.number(), z.boolean()]).default(-1),
  }),
);

/**
 * PHP version of one site.
 *
 * `phpversion` arrives without the dot — "83" for 8.3 — while the site list
 * sends "8.3" for the same value. Both are strings, so nothing crashes; the
 * mismatch would simply show up as a wrong-looking version in the interface.
 */
export const sitePhpVersionResponse = envelope(
  z.object({
    phpversion: z.string().default(''),
    php_other: z.string().default(''),
  }),
);

/** Access log. An empty `result` means no entries, not a failure. */
export const siteLogsResponse = envelope(z.object({result: z.string().default('')}));
