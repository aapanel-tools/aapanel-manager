import {describe, expect, it, vi, beforeEach} from 'vitest';

const authMock = vi.fn();
vi.mock('@/auth', () => ({auth: () => authMock()}));

import {requireUser, requireAdmin, AuthError} from './guards';

beforeEach(() => authMock.mockReset());

describe('guards', () => {
  it('requireUser returns the session user when authed', async () => {
    authMock.mockResolvedValue({user: {id: 'u1', email: 'a@b.com', role: 'viewer'}});
    await expect(requireUser()).resolves.toEqual({id: 'u1', email: 'a@b.com', role: 'viewer'});
  });
  it('requireUser throws when unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    await expect(requireUser()).rejects.toBeInstanceOf(AuthError);
  });
  it('requireAdmin throws for viewer', async () => {
    authMock.mockResolvedValue({user: {id: 'u1', email: 'a@b.com', role: 'viewer'}});
    await expect(requireAdmin()).rejects.toBeInstanceOf(AuthError);
  });
  it('requireAdmin passes for admin', async () => {
    authMock.mockResolvedValue({user: {id: 'u1', email: 'a@b.com', role: 'admin'}});
    await expect(requireAdmin()).resolves.toMatchObject({role: 'admin'});
  });
});
