import {getTranslations} from 'next-intl/server';
import {ChangeOwnPasswordCard} from '@/components/users/change-own-password-card';

export default async function SettingsAccountPage() {
  const t = await getTranslations('settings');
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">{t('accountTitle')}</h2>
        <p className="text-sm text-muted-foreground">{t('accountSubtitle')}</p>
      </div>

      <ChangeOwnPasswordCard />
    </div>
  );
}
