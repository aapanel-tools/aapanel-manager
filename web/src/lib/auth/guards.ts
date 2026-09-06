import {auth} from '@/auth';
import type {Role} from '@prisma/client';

export class AuthError extends Error {
  constructor(public code: 'unauthenticated' | 'forbidden') {
    super(code);
    this.name = 'AuthError';
  }
}

export interface SessionUser {id: string; email: string; role: Role;}

export async function requireUser(): Promise<SessionUser> {
  const session = await auth();
  if (!session?.user) throw new AuthError('unauthenticated');
  return session.user as SessionUser;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== 'admin') throw new AuthError('forbidden');
  return user;
}
