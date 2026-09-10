import {z} from 'zod';
import {FIELD} from './messages';

export const USER_ROLES = ['admin', 'viewer'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** Minimum length for any password the panel sets (account creation / reset / change). */
export const MIN_PASSWORD_LENGTH = 12;

const email = z.string().trim().toLowerCase().email(FIELD.invalidEmail).max(200, FIELD.tooLong);
const password = z
  .string()
  // The number lives in the form's hint, where it is visible before anyone
  // types, rather than in an error that only appears afterwards.
  .min(MIN_PASSWORD_LENGTH, FIELD.passwordShort)
  .max(200, FIELD.tooLong);
const role = z.enum(USER_ROLES);

/** A blank field means "leave the password unchanged" on update. */
const optionalPassword = password.optional().or(z.literal('').transform(() => undefined));

export const userCreateSchema = z.object({email, role, password});

export const userUpdateSchema = z.object({
  id: z.string().min(1),
  role,
  password: optionalPassword,
});

export const userDeleteSchema = z.object({
  id: z.string().min(1),
  confirm: z.string(),
});

export const changeOwnPasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: password,
  })
  .refine((d) => d.currentPassword !== d.newPassword, {
    message: FIELD.passwordSame,
    path: ['newPassword'],
  });

export type UserCreateInput = z.infer<typeof userCreateSchema>;
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;
export type UserDeleteInput = z.infer<typeof userDeleteSchema>;
export type ChangeOwnPasswordInput = z.infer<typeof changeOwnPasswordSchema>;
