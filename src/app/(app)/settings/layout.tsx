import {redirect} from 'next/navigation';
import {getTranslations} from 'next-intl/server';
import {requireUser} from '@/lib/auth/guards';
import {SettingsNav} from '@/components/settings/settings-nav';

export default async function SettingsLayout({children}: {children: React.ReactNode}) {
  const user = await requireUser();
  if (user.role !== 'admin') redirect('/servers');
  const t = await getTranslations('settings');

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <h1 className="text-xl font-semibold">{t('title')}</h1>
      <div className="flex flex-col gap-6 md:flex-row">
        <aside className="shrink-0 md:w-48">
          <SettingsNav />
        </aside>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
