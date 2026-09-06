import Link from 'next/link';
import type {Route} from 'next';
import {getTranslations} from 'next-intl/server';
import {signOut} from '@/auth';
import {Button} from '@/components/ui/button';
import {ThemeToggle} from '@/components/theme-toggle';

export async function AppShell({children, isAdmin = false}: {children: React.ReactNode; isAdmin?: boolean}) {
  const t = await getTranslations('nav');
  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b px-4 py-2">
        <nav className="flex items-center gap-4">
          <Link href="/servers" className="font-semibold">aaPanel Manager</Link>
          <Link href="/servers" className="text-sm text-muted-foreground">{t('servers')}</Link>
          {isAdmin && (
            <Link href={'/jobs' as Route} className="text-sm text-muted-foreground">{t('jobs')}</Link>
          )}
          {isAdmin && (
            <Link href={'/audit' as Route} className="text-sm text-muted-foreground">{t('audit')}</Link>
          )}
          {isAdmin && (
            <Link href={'/users' as Route} className="text-sm text-muted-foreground">{t('users')}</Link>
          )}
          {isAdmin && (
            <Link href={'/settings' as Route} className="text-sm text-muted-foreground">{t('settings')}</Link>
          )}
        </nav>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <form action={async () => {'use server'; await signOut({redirectTo: '/login'});}}>
            <Button variant="ghost" size="sm" type="submit">{t('signOut')}</Button>
          </form>
        </div>
      </header>
      <main className="p-4">{children}</main>
    </div>
  );
}
