import {redirect} from 'next/navigation';
import {getTranslations} from 'next-intl/server';
import {requireUser} from '@/lib/auth/guards';
import {listUsersAction} from '@/server/actions/users';
import {UsersTable} from '@/components/users/users-table';

export default async function UsersPage() {
  const user = await requireUser();
  if (user.role !== 'admin') redirect('/servers');

  const t = await getTranslations('users');
  const initial = await listUsersAction();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <UsersTable initial={initial} />
    </div>
  );
}
