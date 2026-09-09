import {z} from 'zod';

// List params come from the URL: this schema must NEVER throw.
const first = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v);

export const jobListParamsSchema = z.object({
  page: z.preprocess(first, z.coerce.number().int().min(1).catch(1)),
  pageSize: z.preprocess(
    first,
    z.coerce
      .number()
      .int()
      .catch(25)
      .transform((n) => Math.min(100, Math.max(10, n))),
  ),
  /**
   * `active` means pending or running — "what is happening right now", which is
   * one question, not two. The fleet summary asks it; without this it would
   * either issue two queries or paginate past finished jobs to find the live
   * ones.
   */
  status: z.preprocess(
    first,
    z.enum(['all', 'active', 'pending', 'running', 'succeeded', 'failed', 'cancelled']).catch('all'),
  ),
});

export type JobListParams = z.infer<typeof jobListParamsSchema>;

/**
 * Form input for a bulk project operation.
 *
 * `confirm` must repeat the project name. The same shape of confirmation already
 * guards database deletion: an operation that touches many production machines at
 * once should cost one deliberate act of typing (PROJECT_RULES.md §16).
 */
export const projectControlJobSchema = z
  .object({
    project: z.string().trim().min(1).max(100),
    operation: z.enum(['start', 'stop', 'restart']),
    // Absent means on: stopping at the first failure is the invariant default.
    stopOnError: z.preprocess(
      (v) => (v === undefined ? true : v === true || v === 'true' || v === 'on' || v === '1'),
      z.boolean(),
    ),
    confirm: z.string().trim(),
  })
  .refine((v) => v.confirm === v.project, {
    path: ['confirm'],
    message: 'Type the project name to confirm',
  });

export type ProjectControlJobInput = z.infer<typeof projectControlJobSchema>;
