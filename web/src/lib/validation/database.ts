import {z} from 'zod';

const ident = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_]+$/, 'Letters, digits, underscore only');

export const databaseCreateSchema = z.object({
  engine: z.enum(['mysql', 'pgsql']),
  name: ident,
  user: ident,
  password: z.string().min(1).max(128),
  access: z.string().trim().max(64).optional().transform((v) => (v ? v : undefined)),
  note: z.string().trim().max(100).optional().transform((v) => (v ? v : undefined)),
  charset: z.string().trim().max(32).optional().transform((v) => (v ? v : undefined)),
});

export const databaseDeleteSchema = z.object({
  engine: z.enum(['mysql', 'pgsql']),
  id: z.coerce.number().int(),
  name: z.string().trim().min(1),
  confirm: z.string(),
});

export type DatabaseCreateInput = z.infer<typeof databaseCreateSchema>;
export type DatabaseDeleteInput = z.infer<typeof databaseDeleteSchema>;
