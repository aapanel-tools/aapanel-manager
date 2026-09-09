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
