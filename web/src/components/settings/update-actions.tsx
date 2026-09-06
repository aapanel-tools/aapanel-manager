'use client';

import {useState} from 'react';
import {useTranslations} from 'next-intl';
import {toast} from 'sonner';
import {ArrowUpCircle, Download, RotateCcw, Loader2, Check, X, Circle} from 'lucide-react';
import {
  stageUpdateAction,
  activateUpdateAction,
  rollbackUpdateAction,
  gitUpdateAction,
  gitRollbackAction,
  getUpdateProgressAction,
} from '@/server/actions/updates';
import type {DeploymentMode} from '@/lib/version/types';
import {UPDATE_STEPS, deriveStepStates, type StepState, type UpdateStep} from '@/lib/deploy/update-status';
import {Button} from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface UpdateActionsProps {
  deploymentMode: DeploymentMode;
  /** Whether one-click bundle staging is wired (APP_RELEASE_ROOT + adapter). */
  stagingSupported: boolean;
  /** Whether the panel's own aaPanel self-restart target is configured. */
  selfRestartConfigured: boolean;
  bundleAvailable: boolean;
  updateAvailable: boolean;
  latestVersion: string | null;
  stagedVersion: string | null;
  previousVersion: string | null;
  currentVersion: string;
  /** Re-fetch status in the parent card after a change completes. */
  onChanged: () => void;
}

type Confirm = {kind: 'update' | 'rollback'; version: string} | null;
type Phase = 'idle' | 'staging' | 'restarting';

const HEALTH_POLL_MS = 2_500;
/** How often the UI polls the runner's structured step progress (git mode). */
const PROGRESS_POLL_MS = 2_000;
/** Bundle activate just restarts; git also installs+builds, so it needs longer. */
const RESTART_TIMEOUT_MS = 180_000;
const GIT_TIMEOUT_MS = 900_000;

/** One row icon in the git update checklist. */
function StepIcon({state}: {state: StepState}) {
  if (state === 'done') return <Check className="size-4 text-green-600" aria-hidden />;
  if (state === 'running') return <Loader2 className="size-4 animate-spin" aria-hidden />;
  if (state === 'failed') return <X className="size-4 text-destructive" aria-hidden />;
  return <Circle className="size-4 text-muted-foreground" aria-hidden />;
}

/** Maps server action error codes to localized text (falls back to the raw message). */
const ERR_KEYS: Record<string, string> = {
  'unsupported-mode': 'errUnsupportedMode',
  'self-restart-not-configured': 'errSelfNotConfigured',
  'not-a-git-repo': 'errNotGitRepo',
  'update-in-progress': 'errUpdateInProgress',
  'up-to-date': 'updateUpToDate',
  'nothing-staged': 'errNothingStaged',
  'release-not-found': 'errReleaseNotFound',
};

export function UpdateActions(props: UpdateActionsProps) {
  const {
    deploymentMode,
    stagingSupported,
    selfRestartConfigured,
    bundleAvailable,
    updateAvailable,
    latestVersion,
    stagedVersion,
    previousVersion,
    currentVersion,
    onChanged,
  } = props;
  const t = useTranslations('updates');
  const [phase, setPhase] = useState<Phase>('idle');
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [steps, setSteps] = useState<Record<UpdateStep, StepState> | null>(null);
  const busy = phase !== 'idle';
  const isGit = deploymentMode === 'git';

  const stepLabel: Record<UpdateStep, string> = {
    download: t('stepDownload'),
    install: t('stepInstall'),
    migrate: t('stepMigrate'),
    build: t('stepBuild'),
    restart: t('stepRestart'),
  };

  const errText = (code: string, message?: string): string => {
    const key = ERR_KEYS[code];
    return key ? t(key) : message || code;
  };

  /** Polls the public health probe until it reports the target version, or times out. */
  async function waitForVersion(target: string, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, HEALTH_POLL_MS));
      try {
        const res = await fetch('/api/health', {cache: 'no-store'});
        if (res.ok) {
          const body = (await res.json()) as {version?: string};
          if (body.version === target) return true;
        }
      } catch {
        // The app is restarting — the connection drops; keep polling.
      }
    }
    return false;
  }

  // Bundle mode: download + migrate the latest release (no restart yet).
  function doStage(): void {
    if (!latestVersion || busy) return;
    setPhase('staging');
    void (async () => {
      try {
        const res = await stageUpdateAction(latestVersion);
        if (res.ok) {
          toast.success(t('prepared', {version: res.version}));
          onChanged();
        } else {
          toast.error(res.message || errText(res.error));
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      } finally {
        setPhase('idle');
      }
    })();
  }

  /** Runs an apply/rollback (bundle or git), then polls health for the new version. */
  function runDeploy(kind: 'update' | 'rollback', target: string): void {
    setConfirm(null);
    setPhase('restarting');
    setSteps(null);
    const timeoutMs = isGit ? GIT_TIMEOUT_MS : RESTART_TIMEOUT_MS;

    // Git mode writes structured step progress; poll it to drive the checklist.
    let polling = isGit;
    if (isGit) {
      void (async () => {
        while (polling) {
          try {
            const p = await getUpdateProgressAction();
            if (p.ok && p.status) setSteps(deriveStepStates(p.status));
          } catch {
            // The app may be mid-restart — keep polling.
          }
          await new Promise((r) => setTimeout(r, PROGRESS_POLL_MS));
        }
      })();
    }

    void (async () => {
      let res: {ok: boolean; error?: string; message?: string; target?: string; version?: string} | undefined;
      try {
        if (isGit) {
          res = kind === 'update' ? await gitUpdateAction() : await gitRollbackAction(target);
        } else {
          res = kind === 'update' ? await activateUpdateAction() : await rollbackUpdateAction(target);
        }
      } catch {
        // The restart can drop this request's connection — treat as "in progress".
        res = undefined;
      }
      if (res && !res.ok) {
        polling = false;
        toast.error(res.message || errText(res.error ?? 'error'));
        setPhase('idle');
        setSteps(null);
        return;
      }
      const effective = res?.target ?? res?.version ?? target;
      const ok = await waitForVersion(effective, timeoutMs);
      polling = false;
      setPhase('idle');
      setSteps(null);
      toast[ok ? 'success' : 'error'](ok ? t('updateApplied', {version: effective}) : t('updateTimeout'));
      onChanged();
    })();
  }

  // --- which primary action is offered, and why it may be disabled ----------
  // Git: one-click update straight to the latest. Bundle: stage → apply.
  const canGitUpdate = isGit && selfRestartConfigured && updateAvailable && Boolean(latestVersion);
  const canPrepare = !isGit && stagingSupported && selfRestartConfigured && updateAvailable && bundleAvailable && Boolean(latestVersion);
  const primaryReason = !selfRestartConfigured
    ? t('updateNeedsSelfConfig')
    : !isGit && !stagingSupported
      ? t('updateNeedsServer')
      : !updateAvailable
        ? t('updateUpToDate')
        : !isGit && !bundleAvailable
          ? t('noBundle')
          : '';

  const canRollback = selfRestartConfigured && Boolean(previousVersion) && (isGit || stagingSupported);
  const rollbackReason = !previousVersion
    ? t('rollbackNoPrev')
    : !selfRestartConfigured
      ? t('updateNeedsSelfConfig')
      : !isGit && !stagingSupported
        ? t('updateNeedsServer')
        : '';

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div>
        <div className="text-sm font-medium">{t('autoUpdate')}</div>
        <p className="text-xs text-muted-foreground">{isGit ? t('autoUpdateHintGit') : t('autoUpdateHint')}</p>
      </div>

      {phase === 'restarting' ? (
        isGit && steps ? (
          <div className="space-y-2" role="status">
            <p className="text-sm font-medium">{t('applyingGit')}</p>
            <ul className="space-y-1">
              {UPDATE_STEPS.map((step) => {
                const state = steps[step];
                return (
                  <li key={step} className="flex items-center gap-2 text-sm">
                    <StepIcon state={state} />
                    <span
                      className={
                        state === 'pending'
                          ? 'text-muted-foreground'
                          : state === 'failed'
                            ? 'text-destructive'
                            : undefined
                      }
                    >
                      {stepLabel[step]}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" />
            {isGit ? t('applyingGit') : t('applying')}
          </p>
        )
      ) : null}

      <div className="flex flex-wrap gap-2">
        {/* Primary: apply staged (bundle) / prepare (bundle) / update (git) / disabled */}
        {!isGit && stagedVersion ? (
          <Button size="sm" disabled={busy} onClick={() => setConfirm({kind: 'update', version: stagedVersion})}>
            <ArrowUpCircle className="mr-1 size-4" />
            {t('applyUpdate', {version: stagedVersion})}
          </Button>
        ) : canGitUpdate ? (
          <Button size="sm" disabled={busy} onClick={() => latestVersion && setConfirm({kind: 'update', version: latestVersion})}>
            <ArrowUpCircle className="mr-1 size-4" />
            {t('updateTo', {version: latestVersion ?? ''})}
          </Button>
        ) : canPrepare ? (
          <Button size="sm" disabled={busy} onClick={doStage}>
            {phase === 'staging' ? <Loader2 className="mr-1 size-4 animate-spin" /> : <Download className="mr-1 size-4" />}
            {t('prepareUpdate', {version: latestVersion ?? ''})}
          </Button>
        ) : (
          <Button size="sm" disabled title={primaryReason}>
            <ArrowUpCircle className="mr-1 size-4" />
            {t('updateLabel')}
          </Button>
        )}

        <Button
          variant="outline"
          size="sm"
          disabled={busy || !canRollback}
          title={rollbackReason}
          onClick={() => previousVersion && setConfirm({kind: 'rollback', version: previousVersion})}
        >
          <RotateCcw className="mr-1 size-4" />
          {previousVersion ? t('rollbackTo', {version: previousVersion}) : t('rollbackLabel')}
        </Button>
      </div>

      {/* One muted line explaining the current state of the buttons above. */}
      {!isGit && stagedVersion ? (
        <p className="text-xs text-muted-foreground">{t('stagedReady', {version: stagedVersion})}</p>
      ) : !canGitUpdate && !canPrepare && primaryReason ? (
        <p className="text-xs text-muted-foreground">{primaryReason}</p>
      ) : null}

      <Dialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirm?.kind === 'rollback' ? t('confirmRollbackTitle') : t('confirmApplyTitle')}</DialogTitle>
            <DialogDescription>
              {confirm?.kind === 'rollback'
                ? t(isGit ? 'confirmGitRollbackBody' : 'confirmRollbackBody', {version: confirm?.version ?? '', current: currentVersion})
                : t(isGit ? 'confirmGitUpdateBody' : 'confirmApplyBody', {version: confirm?.version ?? '', current: currentVersion})}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>
              {t('cancel')}
            </Button>
            <Button onClick={() => confirm && runDeploy(confirm.kind, confirm.version)}>{t('confirm')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
