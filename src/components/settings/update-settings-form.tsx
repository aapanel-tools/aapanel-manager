'use client';

import {useState, useTransition} from 'react';
import {useRouter} from 'next/navigation';
import {useTranslations} from 'next-intl';
import {toast} from 'sonner';
import {saveUpdateSettingsAction, type SaveSettingsResult} from '@/server/actions/updates';
import type {UpdateSettingsView, DeploymentMode} from '@/lib/version/types';
import {Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';

const INITIAL: SaveSettingsResult = {ok: false, error: ''};
const SELECT_CLASS =
  'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring';

const MODE_KEYS: Record<DeploymentMode, string> = {
  docker: 'modeDocker',
  systemd: 'modeSystemd',
  aapanel: 'modeAapanel',
  git: 'modeGit',
  manual: 'modeManual',
};

export interface UpdateSettingsFormProps {
  settings: UpdateSettingsView;
}

export function UpdateSettingsForm({settings}: UpdateSettingsFormProps) {
  const t = useTranslations('updates');
  const router = useRouter();
  const [mode, setMode] = useState<DeploymentMode>(settings.deploymentMode);
  const [result, setResult] = useState<SaveSettingsResult>(INITIAL);
  const [pending, start] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const res = await saveUpdateSettingsAction(fd);
      setResult(res);
      if (res.ok) {
        toast.success(t('saved'));
        router.refresh(); // re-run the page so the status reflects the new repo
      } else if (res.error !== 'validation') {
        toast.error(res.error);
      }
    });
  }

  const fieldErr = (name: string): string | undefined =>
    !result.ok && result.fieldErrors ? result.fieldErrors[name]?.[0] : undefined;

  const showService = mode === 'docker' || mode === 'systemd';

  return (
    <Card>
      <form onSubmit={onSubmit}>
        <CardHeader>
          <CardTitle>{t('settingsTitle')}</CardTitle>
          <CardDescription>{t('settingsHint')}</CardDescription>
        </CardHeader>

        <CardContent className="space-y-5">
          {!result.ok && result.error && result.error !== 'validation' ? (
            <p className="text-sm text-destructive" role="alert">
              {result.error}
            </p>
          ) : null}

          {/* Install method (drives the upgrade command) + optional service name, side by side */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="us-mode">{t('deploymentMode')}</Label>
              <select
                id="us-mode"
                name="deploymentMode"
                value={mode}
                onChange={(e) => setMode(e.target.value as DeploymentMode)}
                className={SELECT_CLASS}
              >
                {(Object.keys(MODE_KEYS) as DeploymentMode[]).map((m) => (
                  <option key={m} value={m}>
                    {t(MODE_KEYS[m])}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">{t('deploymentModeHint')}</p>
            </div>

            {showService ? (
              <div className="space-y-1.5">
                <Label htmlFor="us-service">{t('serviceName')}</Label>
                <Input id="us-service" name="serviceName" defaultValue={settings.serviceName ?? ''} autoComplete="off" placeholder={mode === 'docker' ? 'app' : 'aapanel'} />
                <p className="text-xs text-muted-foreground">{t('serviceNameHint')}</p>
              </div>
            ) : null}
          </div>

          {/* Self-restart — for aaPanel & git modes: the panel's OWN aaPanel, used to restart itself */}
          {mode === 'aapanel' || mode === 'git' ? (
            <div className="space-y-4 rounded-md border p-3">
              <div>
                <div className="text-sm font-medium">{t('selfTitle')}</div>
                <p className="text-xs text-muted-foreground">{t('selfHint')}</p>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="us-self-url">{t('selfBaseUrl')}</Label>
                  <Input id="us-self-url" name="selfBaseUrl" defaultValue={settings.selfBaseUrl ?? ''} autoComplete="off" placeholder="https://127.0.0.1:8888" />
                  {fieldErr('selfBaseUrl') ? <p className="text-xs text-destructive">{fieldErr('selfBaseUrl')}</p> : null}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="us-self-project">{t('selfProject')}</Label>
                  <Input id="us-self-project" name="selfProject" defaultValue={settings.selfProject ?? ''} autoComplete="off" placeholder="aapanel-manager" />
                  <p className="text-xs text-muted-foreground">{t('selfProjectHint')}</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="us-self-key">{t('selfApiKey')}</Label>
                  <Input
                    id="us-self-key"
                    name="selfApiKey"
                    type="password"
                    autoComplete="off"
                    placeholder={settings.hasSelfKey ? t('githubTokenKeep') : undefined}
                  />
                  <p className="text-xs text-muted-foreground">{t('selfApiKeyHint')}</p>
                </div>
                <div className="flex items-center gap-2 self-end pb-2">
                  <input
                    id="us-self-tls"
                    name="selfTlsMode"
                    type="checkbox"
                    defaultChecked={settings.selfTlsMode === 'PINNED'}
                    className="size-4 rounded border-input"
                  />
                  <Label htmlFor="us-self-tls" className="font-normal">{t('selfTlsPinned')}</Label>
                </div>
              </div>
            </div>
          ) : null}

          {/* Source repo override — only for a fork or a private mirror (left blank by default) */}
          <div className="space-y-4 rounded-md border p-3">
            <div>
              <div className="text-sm font-medium">{t('githubOverrideTitle')}</div>
              <p className="text-xs text-muted-foreground">{t('githubOverrideHint')}</p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="us-owner">{t('githubOwner')}</Label>
                <Input id="us-owner" name="githubOwner" defaultValue={settings.githubOwner} autoComplete="off" placeholder="aapanel-tools" />
                {fieldErr('githubOwner') ? <p className="text-xs text-destructive">{fieldErr('githubOwner')}</p> : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="us-repo">{t('githubRepo')}</Label>
                <Input id="us-repo" name="githubRepo" defaultValue={settings.githubRepo} autoComplete="off" placeholder="aapanel-manager" />
                {fieldErr('githubRepo') ? <p className="text-xs text-destructive">{fieldErr('githubRepo')}</p> : null}
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="us-token">{t('githubToken')}</Label>
                <Input
                  id="us-token"
                  name="githubToken"
                  type="password"
                  autoComplete="off"
                  placeholder={settings.hasToken ? t('githubTokenKeep') : undefined}
                />
                <p className="text-xs text-muted-foreground">{t('githubTokenHint')}</p>
              </div>
            </div>
          </div>
        </CardContent>

        <CardFooter className="justify-end">
          <Button type="submit" disabled={pending}>
            {t('save')}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
