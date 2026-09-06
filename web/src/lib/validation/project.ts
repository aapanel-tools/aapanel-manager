import {z} from 'zod';

// ---------------------------------------------------------------------------
// Field primitives — shared between create and modify.
// All inputs arrive as form strings; numeric fields are coerced.
// ---------------------------------------------------------------------------

/** Project name: letters, digits, dot, dash, underscore. */
const projectName = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9._-]+$/, 'Letters, digits, dot, dash, underscore only');

/** Absolute project directory (must contain package.json on the server). */
const projectCwd = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^\//, 'Must be an absolute path (start with /)');

/** Script key from package.json (e.g. "start", "prod:start"). */
const projectScript = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9:._/-]+$/, 'Invalid script key');

/** TCP port. */
const port = z.coerce.number().int().min(1).max(65535);

/** System user the project runs as. */
const runUser = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(/^[A-Za-z0-9._-]+$/, 'Invalid user name');

/** Node version label, e.g. "v24.13.0". */
const nodejsVersion = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(/^v?[0-9][0-9A-Za-z.+-]*$/, 'Invalid Node.js version');

/** Free-text description / note. */
const note = z
  .string()
  .trim()
  .max(255)
  .optional()
  .transform((v) => v ?? '');

/** Checkbox-style flag submitted as the string "true"/"false". */
const flag = z
  .union([z.literal('true'), z.literal('false')])
  .optional()
  .transform((v) => v === 'true');

/** PM2 memory limit in MB (0 = unlimited; panel caps at server RAM). */
const maxMemoryLimit = z.coerce.number().int().min(0).max(1_048_576);

/**
 * Domains as a free-text list ("host:port" per line / comma). Empty = none.
 * The panel validates the actual hostnames; we only normalize into an array.
 */
const domains = z
  .string()
  .max(2_000)
  .optional()
  .transform((v) =>
    (v ?? '')
      .split(/[\n,]/)
      .map((d) => d.trim())
      .filter((d) => d.length > 0)
      .slice(0, 50),
  );

/** Environment variables block (KEY=value per line). */
const projectEnv = z
  .string()
  .max(10_000)
  .optional()
  .transform((v) => v ?? '');

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const projectModifySchema = z.object({
  cwd: projectCwd,
  name: projectName,
  script: projectScript,
  port,
  runUser,
  nodejsVersion,
  note,
  powerOn: flag,
});

export const projectCreateSchema = z.object({
  cwd: projectCwd,
  name: projectName,
  script: projectScript,
  port,
  runUser,
  nodejsVersion,
  note,
  domains,
  bindExtranet: flag,
  powerOn: flag,
  maxMemoryLimit,
  env: projectEnv,
});

export const projectDeleteSchema = z.object({
  name: projectName,
  confirm: z.string(),
});

export type ProjectModifyFormInput = z.infer<typeof projectModifySchema>;
export type ProjectCreateFormInput = z.infer<typeof projectCreateSchema>;
export type ProjectDeleteFormInput = z.infer<typeof projectDeleteSchema>;
