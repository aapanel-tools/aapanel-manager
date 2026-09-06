import {z} from 'zod';

// List params come from the URL: this schema must NEVER throw. Every field
// tolerates arrays (a duplicated query param → take the first) and falls back
// to a safe default on bad input, the same contract as serverListParamsSchema.
const first = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v);

/** An ISO date bound from the URL. Anything unparsable means "no bound". */
const optionalDate = z.preprocess(first, z.coerce.date().optional().catch(undefined));

const optionalId = z.preprocess(first, z.string().trim().max(50).optional().catch(undefined));

export const auditListParamsSchema = z.object({
  page: z.preprocess(first, z.coerce.number().int().min(1).catch(1)),
  pageSize: z.preprocess(
    first,
    z.coerce
      .number()
      .int()
      .catch(50)
      .transform((n) => Math.min(200, Math.max(10, n))),
  ),
  /** Matches the action and the target — "what happened" and "to what". */
  q: z.preprocess(first, z.string().trim().max(100).optional().catch(undefined)),
  serverId: optionalId,
  userId: optionalId,
  result: z.preprocess(first, z.enum(['all', 'ok', 'error']).catch('all')),
  from: optionalDate,
  to: optionalDate,
});

export type AuditListParams = z.infer<typeof auditListParamsSchema>;
