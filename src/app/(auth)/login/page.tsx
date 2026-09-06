import {redirect} from 'next/navigation';
import {getTranslations} from 'next-intl/server';
import {signIn, auth} from '@/auth';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';

export default async function LoginPage({searchParams}: {searchParams: Promise<{error?: string}>}) {
  if (await auth()) redirect('/');
  const t = await getTranslations('auth');
  const {error} = await searchParams;

  async function login(formData: FormData) {
    'use server';
    try {
      await signIn('credentials', {
        email: String(formData.get('email')),
        password: String(formData.get('password')),
        redirectTo: '/',
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'digest' in error) throw error; // NEXT_REDIRECT
      redirect('/login?error=1');
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form action={login} className="w-full max-w-sm space-y-4 rounded-xl border p-6">
        <h1 className="text-xl font-semibold">{t('signIn')}</h1>
        {error ? <p className="text-sm text-destructive" role="alert">{t('invalid')}</p> : null}
        <div className="space-y-2">
          <Label htmlFor="email">{t('email')}</Label>
          <Input id="email" name="email" type="email" required autoComplete="email" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">{t('password')}</Label>
          <Input id="password" name="password" type="password" required autoComplete="current-password" />
        </div>
        <Button type="submit" className="w-full">{t('signIn')}</Button>
      </form>
    </main>
  );
}
