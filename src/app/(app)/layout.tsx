import {redirect} from 'next/navigation';
import {auth} from '@/auth';
import {AppShell} from '@/components/app-shell';

export default async function AppLayout({children}: {children: React.ReactNode}) {
  const session = await auth();
  if (!session) redirect('/login');
  const isAdmin = (session.user as {role?: string} | undefined)?.role === 'admin';
  return <AppShell isAdmin={isAdmin}>{children}</AppShell>;
}
