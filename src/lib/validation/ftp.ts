import {z} from 'zod';

/**
 * Input schemas for the FTP module.
 *
 * Everything here arrives from a browser and ends up creating or removing a
 * real system account on someone else's server, so each field is checked rather
 * than trusted: a server action is a public endpoint.
 */

const userId = z.coerce.number().int().nonnegative();

/**
 * An FTP login name.
 *
 * Deliberately narrow. The name is passed to the panel, which passes it to the
 * system's FTP daemon, and a name carrying a space, a slash or a shell
 * character is a problem waiting for somewhere to happen. Anything a real
 * account needs fits in this set.
 */
const username = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(/^[A-Za-z0-9._-]+$/, 'Letters, digits, dot, underscore, hyphen only');

/**
 * The home directory.
 *
 * Absolute, because the panel creates it if it does not exist and a relative
 * path would be resolved against whatever the panel's process happens to be
 * sitting in. `..` is refused outright: an account whose home climbs out of the
 * tree it was meant for is a mistake, whether it was made on purpose or not.
 */
const homePath = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^\//, 'Must be an absolute path')
  .refine((v) => !v.split('/').includes('..'), 'Must not contain ".."');

/**
 * A password on its way to a client's server.
 *
 * The lower bound is a real guard rather than decoration — an FTP account is
 * reachable from the whole internet — and the upper one keeps a paste accident
 * from travelling. It is never logged, never returned, and never stored here.
 */
const password = z.string().min(8).max(128);

export const ftpCreateSchema = z.object({
  username,
  password,
  path: homePath,
  note: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((v) => (v ? v : undefined)),
});

export const ftpPasswordSchema = z.object({
  id: userId,
  username,
  password,
});

export const ftpStatusSchema = z.object({
  id: userId,
  username,
  /** Where the switch is going, not where it came from. */
  enabled: z.enum(['true', 'false']).transform((v) => v === 'true'),
});

export const ftpDeleteSchema = z.object({
  id: userId,
  username,
  confirm: z.string(),
});

export type FtpCreateFields = z.infer<typeof ftpCreateSchema>;
export type FtpPasswordFields = z.infer<typeof ftpPasswordSchema>;
export type FtpStatusFields = z.infer<typeof ftpStatusSchema>;
export type FtpDeleteFields = z.infer<typeof ftpDeleteSchema>;
