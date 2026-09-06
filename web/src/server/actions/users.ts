'use server';
import {revalidatePath} from 'next/cache';
import type {Role} from '@prisma/client';
import {requireUser, requireAdmin, AuthError} from '@/lib/auth/guards';
import type {SessionUser} from '@/lib/auth/guards';
import {prisma} from '@/lib/db/prisma';
import {hashPassword, verifyPassword} from '@/lib/crypto/password';
import {recordAudit} from '@/lib/audit';
import {log} from '@/log';
import {
  userCreateSchema,
  userUpdateSchema,
  userDeleteSchema,
  changeOwnPasswordSchema,
} from '@/lib/validation/user';
import {denyUserDeletion, denyRoleChange} from '@/lib/users/policy';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface UserView {
  id: string;
  email: string;
  role: Role;
  createdAt: string; // ISO 8601 — formatted deterministically on the client
  isSelf: boolean;
}

export type UsersListResult = {ok: true; users: UserView[]} | {ok: false; message: string};

export type UserMutResult =
  | {ok: true}
  | {ok: false; error: string; fieldErrors?: Record<string, string[]>};

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown error';
}

/** Prisma unique-constraint violation (e.g. duplicate email). */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as {code?: unknown}).code === 'P2002';
}

// ---------------------------------------------------------------------------
// Actions (admin only, except changeOwnPassword)
// ---------------------------------------------------------------------------

/** Lists app users (never returns password hashes). Requires admin role. */
export async function listUsersAction(): Promise<UsersListResult> {
  let actor: SessionUser;
  try {
    actor = await requireAdmin();
  } catch {
    return {ok: false, message: 'forbidden'};
  }
  try {
    const rows = await prisma.user.findMany({
      select: {id: true, email: true, role: true, createdAt: true},
      orderBy: [{role: 'asc'}, {createdAt: 'asc'}],
    });
    return {
      ok: true,
      users: rows.map((r) => ({
        id: r.id,
        email: r.email,
        role: r.role,
        createdAt: r.createdAt.toISOString(),
        isSelf: r.id === actor.id,
      })),
    };
  } catch (err) {
    log.error({err}, 'listUsersAction failed');
    return {ok: false, message: describeError(err)};
  }
}

/** Creates a user with a hashed password. Requires admin role. */
export async function createUserAction(formData: FormData): Promise<UserMutResult> {
  let actor: SessionUser;
  try {
    actor = await requireAdmin();
  } catch (e) {
    return {ok: false, error: e instanceof AuthError ? e.code : 'forbidden'};
  }
  const parsed = userCreateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {ok: false, error: 'validation', fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>};
  }
  const {email, role, password} = parsed.data;
  try {
    const passwordHash = await hashPassword(password);
    await prisma.user.create({data: {email, role, passwordHash}});
    await recordAudit({userId: actor.id, action: 'user.create', target: email, result: 'ok'});
    revalidatePath('/users');
    return {ok: true};
  } catch (err) {
    if (isUniqueViolation(err)) return {ok: false, error: 'emailTaken'};
    log.error({err}, 'createUserAction failed');
    await recordAudit({userId: actor.id, action: 'user.create', target: email, result: 'error'});
    return {ok: false, error: describeError(err)};
  }
}

/** Updates a user's role and, optionally, their password (blank = keep). Requires admin role. */
export async function updateUserAction(formData: FormData): Promise<UserMutResult> {
  let actor: SessionUser;
  try {
    actor = await requireAdmin();
  } catch (e) {
    return {ok: false, error: e instanceof AuthError ? e.code : 'forbidden'};
  }
  const parsed = userUpdateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {ok: false, error: 'validation', fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>};
  }
  const {id, role, password} = parsed.data;
  try {
    const target = await prisma.user.findUnique({where: {id}, select: {id: true, email: true, role: true}});
    if (!target) return {ok: false, error: 'notFound'};

    if (target.role !== role) {
      const adminCount = await prisma.user.count({where: {role: 'admin'}});
      const denial = denyRoleChange({targetIsAdmin: target.role === 'admin', nextRole: role, adminCount});
      if (denial) return {ok: false, error: denial};
    }

    const data: {role: Role; passwordHash?: string} = {role};
    if (password) data.passwordHash = await hashPassword(password);
    await prisma.user.update({where: {id}, data});
    await recordAudit({userId: actor.id, action: 'user.update', target: target.email, result: 'ok'});
    revalidatePath('/users');
    return {ok: true};
  } catch (err) {
    log.error({err, id}, 'updateUserAction failed');
    await recordAudit({userId: actor.id, action: 'user.update', target: id, result: 'error'});
    return {ok: false, error: describeError(err)};
  }
}

/** Deletes a user (type-the-email confirmation + lock-out guards). Requires admin role. */
export async function deleteUserAction(formData: FormData): Promise<UserMutResult> {
  let actor: SessionUser;
  try {
    actor = await requireAdmin();
  } catch (e) {
    return {ok: false, error: e instanceof AuthError ? e.code : 'forbidden'};
  }
  const parsed = userDeleteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return {ok: false, error: 'validation'};
  const {id, confirm} = parsed.data;
  try {
    const target = await prisma.user.findUnique({where: {id}, select: {id: true, email: true, role: true}});
    if (!target) return {ok: false, error: 'notFound'};
    if (confirm.trim().toLowerCase() !== target.email.toLowerCase()) return {ok: false, error: 'confirmMismatch'};

    const adminCount = await prisma.user.count({where: {role: 'admin'}});
    const denial = denyUserDeletion({
      isSelf: target.id === actor.id,
      targetIsAdmin: target.role === 'admin',
      adminCount,
    });
    if (denial) return {ok: false, error: denial};

    await prisma.user.delete({where: {id}}); // authored audit logs keep their row (userId set null)
    await recordAudit({userId: actor.id, action: 'user.delete', target: `${target.email} (${id})`, result: 'ok'});
    revalidatePath('/users');
    return {ok: true};
  } catch (err) {
    log.error({err, id}, 'deleteUserAction failed');
    await recordAudit({userId: actor.id, action: 'user.delete', target: id, result: 'error'});
    return {ok: false, error: describeError(err)};
  }
}

/** Changes the signed-in user's own password (verifies the current one). Any authenticated user. */
export async function changeOwnPasswordAction(formData: FormData): Promise<UserMutResult> {
  let actor: SessionUser;
  try {
    actor = await requireUser();
  } catch (e) {
    return {ok: false, error: e instanceof AuthError ? e.code : 'unauthenticated'};
  }
  const parsed = changeOwnPasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {ok: false, error: 'validation', fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>};
  }
  const {currentPassword, newPassword} = parsed.data;
  try {
    const me = await prisma.user.findUnique({where: {id: actor.id}, select: {passwordHash: true}});
    if (!me) return {ok: false, error: 'notFound'};
    if (!(await verifyPassword(me.passwordHash, currentPassword))) return {ok: false, error: 'wrongPassword'};

    const passwordHash = await hashPassword(newPassword);
    await prisma.user.update({where: {id: actor.id}, data: {passwordHash}});
    await recordAudit({userId: actor.id, action: 'user.changePassword', result: 'ok'});
    return {ok: true};
  } catch (err) {
    log.error({err}, 'changeOwnPasswordAction failed');
    await recordAudit({userId: actor.id, action: 'user.changePassword', result: 'error'});
    return {ok: false, error: describeError(err)};
  }
}
