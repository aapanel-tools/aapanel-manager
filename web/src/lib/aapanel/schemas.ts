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

export const projectListResponse = envelope(z.object({data: z.array(rawNodeProject)}));

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

/** MySQL list row — `accept` carries the access scope. */
export const mysqlDatabaseListResponse = envelope(
  z.object({
    data: z
      .array(
        z.object({
          id: z.number(),
          name: z.string(),
          username: z.string().default(''),
          accept: z.string().default(''),
          ps: z.string().default(''),
          addtime: z.string().default(''),
          backup_count: z.number().optional(),
        }),
      )
      .default([]),
  }),
);

/** PostgreSQL list row — the access scope lives in `listen_ip` instead of `accept`. */
export const pgsqlDatabaseListResponse = envelope(
  z.object({
    data: z
      .array(
        z.object({
          id: z.number(),
          name: z.string(),
          username: z.string().default(''),
          listen_ip: z.string().default(''),
          ps: z.string().default(''),
          addtime: z.string().default(''),
          backup_count: z.number().optional(),
        }),
      )
      .default([]),
  }),
);
