import {describe, it, expect, vi, beforeEach} from 'vitest';

// Mock the Auth.js entrypoint so importing the real guards module does not pull
// in next-auth → next/server (which fails to resolve under vitest).
vi.mock('@/auth', () => ({auth: vi.fn(async () => null)}));

const guard = vi.hoisted(() => ({role: 'admin' as 'admin' | 'viewer', id: 'admin-1'}));
vi.mock('@/lib/auth/guards', async (orig) => {
  const actual = await orig<typeof import('@/lib/auth/guards')>();
  return {
    ...actual,
    requireAdmin: vi.fn(async () => {
      if (guard.role !== 'admin') throw new actual.AuthError('forbidden');
      return {id: guard.id, email: 'admin@example.com', role: 'admin' as const};
    }),
    requireUser: vi.fn(async () => ({id: guard.id, email: 'admin@example.com', role: guard.role})),
  };
});

const db = vi.hoisted(() => ({
  user: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));
vi.mock('@/lib/db/prisma', () => ({prisma: db}));
vi.mock('next/cache', () => ({revalidatePath: vi.fn()}));
vi.mock('@/lib/audit', () => ({recordAudit: vi.fn(async () => null)}));
vi.mock('@/lib/crypto/password', () => ({
  hashPassword: vi.fn(async (p: string) => `hash:${p}`),
  verifyPassword: vi.fn(async (h: string, p: string) => h === `hash:${p}`),
}));

import {
  listUsersAction,
  createUserAction,
  updateUserAction,
  deleteUserAction,
  changeOwnPasswordAction,
} from './users';

const LONGPW = 'x'.repeat(12);
const NEWPW = 'y'.repeat(12);

function fd(obj: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(obj)) f.set(k, v);
  return f;
}

beforeEach(() => {
  guard.role = 'admin';
  guard.id = 'admin-1';
  Object.values(db.user).forEach((fn) => fn.mockReset());
});

describe('listUsersAction', () => {
  it('forbids non-admins', async () => {
    guard.role = 'viewer';
    const res = await listUsersAction();
    expect(res).toEqual({ok: false, message: 'forbidden'});
  });

  it('returns users, marks self, and serialises createdAt to ISO', async () => {
    const when = new Date('2026-01-02T03:04:05.000Z');
    db.user.findMany.mockResolvedValueOnce([
      {id: 'admin-1', email: 'admin@example.com', role: 'admin', createdAt: when},
      {id: 'v1', email: 'v@x.co', role: 'viewer', createdAt: when},
    ]);
    const res = await listUsersAction();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.users).toHaveLength(2);
      expect(res.users[0]).toMatchObject({id: 'admin-1', isSelf: true, createdAt: '2026-01-02T03:04:05.000Z'});
      expect(res.users[1].isSelf).toBe(false);
    }
  });
});

describe('createUserAction', () => {
  it('forbids non-admins', async () => {
    guard.role = 'viewer';
    const res = await createUserAction(fd({email: 'a@b.co', role: 'viewer', password: LONGPW}));
    expect(res).toEqual({ok: false, error: 'forbidden'});
  });

  it('rejects invalid input with a validation error', async () => {
    const res = await createUserAction(fd({email: 'bad', role: 'viewer', password: 'short'}));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('validation');
    expect(db.user.create).not.toHaveBeenCalled();
  });

  it('creates a user with a hashed password', async () => {
    db.user.create.mockResolvedValueOnce({id: 'u2'});
    const res = await createUserAction(fd({email: 'New@X.co', role: 'admin', password: LONGPW}));
    expect(res).toEqual({ok: true});
    expect(db.user.create).toHaveBeenCalledWith({
      data: {email: 'new@x.co', role: 'admin', passwordHash: `hash:${LONGPW}`},
    });
  });

  it('maps a duplicate email to emailTaken', async () => {
    db.user.create.mockRejectedValueOnce({code: 'P2002'});
    const res = await createUserAction(fd({email: 'dupe@x.co', role: 'viewer', password: LONGPW}));
    expect(res).toEqual({ok: false, error: 'emailTaken'});
  });
});

describe('updateUserAction', () => {
  it('blocks demoting the last admin', async () => {
    db.user.findUnique.mockResolvedValueOnce({id: 'admin-2', email: 'a2@x.co', role: 'admin'});
    db.user.count.mockResolvedValueOnce(1);
    const res = await updateUserAction(fd({id: 'admin-2', role: 'viewer'}));
    expect(res).toEqual({ok: false, error: 'lastAdmin'});
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it('allows demotion when other admins remain', async () => {
    db.user.findUnique.mockResolvedValueOnce({id: 'admin-2', email: 'a2@x.co', role: 'admin'});
    db.user.count.mockResolvedValueOnce(2);
    db.user.update.mockResolvedValueOnce({id: 'admin-2'});
    const res = await updateUserAction(fd({id: 'admin-2', role: 'viewer'}));
    expect(res).toEqual({ok: true});
    expect(db.user.update).toHaveBeenCalledWith({where: {id: 'admin-2'}, data: {role: 'viewer'}});
  });

  it('resets the password when one is provided', async () => {
    db.user.findUnique.mockResolvedValueOnce({id: 'v1', email: 'v@x.co', role: 'viewer'});
    db.user.update.mockResolvedValueOnce({id: 'v1'});
    const res = await updateUserAction(fd({id: 'v1', role: 'viewer', password: NEWPW}));
    expect(res).toEqual({ok: true});
    expect(db.user.update).toHaveBeenCalledWith({where: {id: 'v1'}, data: {role: 'viewer', passwordHash: `hash:${NEWPW}`}});
    expect(db.user.count).not.toHaveBeenCalled(); // no role change → no admin-count check
  });

  it('returns notFound for a missing user', async () => {
    db.user.findUnique.mockResolvedValueOnce(null);
    const res = await updateUserAction(fd({id: 'ghost', role: 'viewer'}));
    expect(res).toEqual({ok: false, error: 'notFound'});
  });
});

describe('deleteUserAction', () => {
  it('blocks deleting your own account', async () => {
    db.user.findUnique.mockResolvedValueOnce({id: 'admin-1', email: 'admin@example.com', role: 'admin'});
    db.user.count.mockResolvedValueOnce(3);
    const res = await deleteUserAction(fd({id: 'admin-1', confirm: 'admin@example.com'}));
    expect(res).toEqual({ok: false, error: 'cannotDeleteSelf'});
    expect(db.user.delete).not.toHaveBeenCalled();
  });

  it('blocks deleting the last admin', async () => {
    db.user.findUnique.mockResolvedValueOnce({id: 'admin-2', email: 'a2@x.co', role: 'admin'});
    db.user.count.mockResolvedValueOnce(1);
    const res = await deleteUserAction(fd({id: 'admin-2', confirm: 'a2@x.co'}));
    expect(res).toEqual({ok: false, error: 'lastAdmin'});
    expect(db.user.delete).not.toHaveBeenCalled();
  });

  it('rejects a confirmation that does not match the email', async () => {
    db.user.findUnique.mockResolvedValueOnce({id: 'v1', email: 'v@x.co', role: 'viewer'});
    const res = await deleteUserAction(fd({id: 'v1', confirm: 'wrong@x.co'}));
    expect(res).toEqual({ok: false, error: 'confirmMismatch'});
    expect(db.user.delete).not.toHaveBeenCalled();
  });

  it('deletes a viewer when confirmation matches', async () => {
    db.user.findUnique.mockResolvedValueOnce({id: 'v1', email: 'v@x.co', role: 'viewer'});
    db.user.count.mockResolvedValueOnce(2);
    db.user.delete.mockResolvedValueOnce({id: 'v1'});
    const res = await deleteUserAction(fd({id: 'v1', confirm: 'V@X.co'})); // case-insensitive confirm
    expect(res).toEqual({ok: true});
    expect(db.user.delete).toHaveBeenCalledWith({where: {id: 'v1'}});
  });
});

describe('changeOwnPasswordAction', () => {
  it('rejects a wrong current password', async () => {
    db.user.findUnique.mockResolvedValueOnce({passwordHash: 'hash:correct'});
    const res = await changeOwnPasswordAction(fd({currentPassword: 'wrong', newPassword: NEWPW}));
    expect(res).toEqual({ok: false, error: 'wrongPassword'});
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it('rejects when the new password equals the current (validation)', async () => {
    const res = await changeOwnPasswordAction(fd({currentPassword: LONGPW, newPassword: LONGPW}));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('validation');
  });

  it('changes the password when the current one is correct', async () => {
    db.user.findUnique.mockResolvedValueOnce({passwordHash: 'hash:correct'});
    db.user.update.mockResolvedValueOnce({id: 'admin-1'});
    const res = await changeOwnPasswordAction(fd({currentPassword: 'correct', newPassword: NEWPW}));
    expect(res).toEqual({ok: true});
    expect(db.user.update).toHaveBeenCalledWith({where: {id: 'admin-1'}, data: {passwordHash: `hash:${NEWPW}`}});
  });
});
