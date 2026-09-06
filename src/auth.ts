import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import type {Role} from '@prisma/client';
import {prisma} from '@/lib/db/prisma';
import {verifyPassword} from '@/lib/crypto/password';
import {signInSchema} from '@/lib/validation/auth';

export const {handlers, auth, signIn, signOut} = NextAuth({
  // Self-hosted single-tenant panel: trust the app's own host header so Auth.js
  // does not throw `UntrustedHost` in production (it only auto-trusts the host on
  // Vercel or in development). Without this, every auth route 500s behind the
  // operator's reverse proxy. See README / .env.example (optional AUTH_URL override).
  trustHost: true,
  session: {strategy: 'jwt'},
  pages: {signIn: '/login'},
  providers: [
    Credentials({
      credentials: {email: {}, password: {}},
      authorize: async (raw) => {
        const parsed = signInSchema.safeParse(raw);
        if (!parsed.success) return null;
        const {email, password} = parsed.data;
        const user = await prisma.user.findUnique({where: {email}});
        if (!user) return null;
        const ok = await verifyPassword(user.passwordHash, password);
        if (!ok) return null;
        return {id: user.id, email: user.email, role: user.role};
      },
    }),
  ],
  callbacks: {
    jwt({token, user}) {
      if (user) {
        token.id = user.id as string;
        token.role = (user as {role: Role}).role;
      }
      return token;
    },
    session({session, token}) {
      session.user.id = token.id;
      session.user.role = token.role;
      return session;
    },
  },
});
