import {z} from 'zod';

const httpUrl = z
  .string()
  .trim()
  .url()
  .refine((u) => {
    try {return ['http:', 'https:'].includes(new URL(u).protocol);} catch {return false;}
  }, 'Must be an http(s) URL');

const optionalTag = z
  .string()
  .trim()
  .max(50)
  .optional()
  .transform((v) => (v === '' || v == null ? undefined : v));

const apiSk = z.string().trim().min(16, 'api_sk looks too short').max(200);

// How the panel's certificate is trusted (ADR-0002). The form sends the value
// verbatim; absent or blank means PINNED, because a self-signed certificate is
// aaPanel's default. There is no "do not check" value by design.
const tlsMode = z.preprocess(
  (v) => (v === undefined || v === '' ? 'PINNED' : v),
  z.enum(['PINNED', 'VERIFY']),
);

// Uppercase hex SHA-256, with or without separators. Optional everywhere: an
// empty pin is the legitimate "not pinned yet" state.
const tlsPinSha256 = z
  .string()
  .trim()
  .transform((v) => v.replace(/[^0-9a-fA-F]/g, '').toUpperCase())
  .refine((v) => v === '' || v.length === 64, 'A SHA-256 fingerprint has 64 hex digits')
  .transform((v) => (v === '' ? undefined : v))
  .optional();

export const serverCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  baseUrl: httpUrl,
  apiSk,
  tag: optionalTag,
  tlsMode,
  tlsPinSha256,
});

export const serverUpdateSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(100),
  baseUrl: httpUrl,
  apiSk: apiSk.optional().or(z.literal('').transform(() => undefined)), // blank = keep existing
  tag: optionalTag,
  tlsMode,
  tlsPinSha256,
});

/** Reading the certificate a panel presents needs nothing but its address. */
export const certificateInspectSchema = z.object({baseUrl: httpUrl});

export const testConnectionSchema = z.object({
  id: z.string().min(1).optional(),
  baseUrl: httpUrl,
  apiSk: apiSk.optional().or(z.literal('').transform(() => undefined)),
  tlsMode,
});

// List params come from the URL: must NEVER throw. Each field tolerates arrays
// (duplicated params → take first) and falls back to a safe default on bad input.
const first = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v);

export const serverListParamsSchema = z.object({
  page: z.preprocess(first, z.coerce.number().int().min(1).catch(1)),
  pageSize: z.preprocess(
    first,
    z.coerce.number().int().catch(25).transform((n) => Math.min(100, Math.max(5, n))),
  ),
  q: z.preprocess(first, z.string().trim().max(100).optional().catch(undefined)),
  status: z.preprocess(first, z.enum(['all', 'online', 'offline', 'unknown']).catch('all')),
  tag: z.preprocess(first, z.string().trim().max(50).optional().catch(undefined)),
  sort: z.preprocess(first, z.enum(['name', 'tag', 'createdAt', 'lastCheckedAt', 'cpu', 'mem', 'disk']).catch('name')),
  dir: z.preprocess(first, z.enum(['asc', 'desc']).catch('asc')),
});

export type ServerCreateInput = z.infer<typeof serverCreateSchema>;
export type ServerUpdateInput = z.infer<typeof serverUpdateSchema>;
export type ServerListParams = z.infer<typeof serverListParamsSchema>;
