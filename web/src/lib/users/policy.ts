/**
 * Pure authorization-safety predicates for user management.
 *
 * Kept dependency-free so the lock-out guards can be unit-tested in isolation
 * (cf. lib/servers/sort.ts). The server actions fetch the live admin count and
 * delegate the "is this allowed?" decision here.
 */

type Role = 'admin' | 'viewer';

export type DeleteDenial = 'cannotDeleteSelf' | 'lastAdmin';
export type RoleChangeDenial = 'lastAdmin';

/**
 * Why deleting a user must be blocked, or `null` if it is allowed.
 * - You can never delete your own account (avoids surprise self-lockout).
 * - You can never delete the last remaining admin (avoids total lockout).
 */
export function denyUserDeletion(opts: {
  isSelf: boolean;
  targetIsAdmin: boolean;
  adminCount: number;
}): DeleteDenial | null {
  if (opts.isSelf) return 'cannotDeleteSelf';
  if (opts.targetIsAdmin && opts.adminCount <= 1) return 'lastAdmin';
  return null;
}

/**
 * Why changing a user's role must be blocked, or `null` if it is allowed.
 * Demoting the last admin to a non-admin role would lock everyone out of
 * administration, so it is refused.
 */
export function denyRoleChange(opts: {
  targetIsAdmin: boolean;
  nextRole: Role;
  adminCount: number;
}): RoleChangeDenial | null {
  const demoting = opts.targetIsAdmin && opts.nextRole !== 'admin';
  if (demoting && opts.adminCount <= 1) return 'lastAdmin';
  return null;
}
