import {getTranslations} from 'next-intl/server';
import {getUpdateStatusAction, getUpdateSettingsAction} from '@/server/actions/updates';
import {UpdateStatusCard} from '@/components/settings/update-status-card';
import {UpdateSettingsForm} from '@/components/settings/update-settings-form';

export default async function SettingsUpdatesPage() {
  const t = await getTranslations('updates');
  const [status, settingsData] = await Promise.all([getUpdateStatusAction(), getUpdateSettingsAction()]);

  // Remount both cards when the saved config changes (after a save + router.refresh()):
  // the status card re-seeds from fresh server data, and the form re-initialises its
  // uncontrolled defaults from the new settings (no "defaultValue changed" warning).
  const settingsKey = settingsData.ok
    ? `${settingsData.settings.deploymentMode}|${settingsData.settings.githubOwner}/${settingsData.settings.githubRepo}`
    : 'default';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">{t('title')}</h2>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <UpdateStatusCard key={`status-${settingsKey}`} initial={status} />

      {settingsData.ok ? (
        <UpdateSettingsForm key={`form-${settingsKey}`} settings={settingsData.settings} />
      ) : null}
    </div>
  );
}
