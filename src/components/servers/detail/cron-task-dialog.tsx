'use client';

import {useState, useTransition} from 'react';
import {useTranslations} from 'next-intl';
import {toast} from 'sonner';
import {Play, Power, PowerOff, RefreshCw, Trash2} from 'lucide-react';
import type {CronTask} from '@/lib/aapanel';
import {
  getCronLogsAction,
  runCronTaskAction,
  setCronTaskEnabledAction,
  deleteCronTaskAction,
} from '@/server/actions/cron';
import {cronConfirmPhrase} from '@/lib/validation/cron';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Separator} from '@/components/ui/separator';
import {scheduleText, clockTime} from '@/components/servers/detail/cron-schedule';
import {useActionError} from '@/components/use-action-error';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

export interface CronTaskDialogProps {
  id: string;
  task: CronTask;
  /** Whether the viewer may change anything; the controls are hidden otherwise. */
  isAdmin: boolean;
  trigger: React.ReactElement;
  /** Re-reads the list, so the row behind this card stops showing the old state. */
  onDone: () => void;
}

/** Which operation is waiting to be confirmed, if any. */
type Pending = null | 'run' | 'toggle' | 'delete';

/**
 * One scheduled task: what it runs, what it last printed, and the three things
 * that can be done to it.
 *
 * The controls live here rather than in the table row, and that is a safety
 * decision rather than a layout one. This card is the only place the script is
 * visible, and running or deleting a task without seeing what it does is how a
 * client's site goes down. The cost is a click: to run a task you open it
 * first. These operations are rare, and doing them to many servers at once is
 * Ф-6's job, with its own staged rollout and its own preview.
 *
 * Confirmations are inline rather than nested dialogs. A dialog inside a dialog
 * works in this component kit and reads badly, and focus goes missing in it.
 *
 * The three operations are deliberately not equivalent:
 *
 *   run     — cannot be undone, but runs the script the schedule runs anyway
 *   toggle  — reversible, and the panel offers only a toggle, never a set, so
 *             the server re-reads the real state before acting
 *   delete  — irreversible, so the task's name has to be typed, and the server
 *             checks the typed phrase again rather than trusting this form
 */
export function CronTaskDialog({id, task, isAdmin, trigger, onDone}: CronTaskDialogProps) {
  const t = useTranslations('cron');
  // Refusals of the action's own — wrong role, a confirmation that did not
  // match — come back as codes and are put into words in one shared place.
  const actionError = useActionError();
  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState<string | null>(null);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [pendingOp, setPendingOp] = useState<Pending>(null);
  const [confirmValue, setConfirmValue] = useState('');
  const [loadingLogs, startLogs] = useTransition();
  const [working, startWork] = useTransition();

  const phrase = cronConfirmPhrase(task);

  function loadLogs() {
    startLogs(async () => {
      const res = await getCronLogsAction(id, task.id);
      if (res.ok) {
        setLogs(res.logs);
        setLogsError(null);
      } else {
        // The last good output is kept: a failed refresh says nothing about
        // what the task printed the last time anyone could read it.
        setLogsError(res.message);
      }
    });
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next && logs === null && !loadingLogs) loadLogs();
    if (!next) {
      setPendingOp(null);
      setConfirmValue('');
    }
  }

  function runNow() {
    const fd = new FormData();
    fd.set('id', String(task.id));
    fd.set('name', task.name);
    startWork(async () => {
      const res = await runCronTaskAction(id, fd);
      if (res.ok) {
        toast.success(t('toastRan'));
        setPendingOp(null);
        // The panel answers when it has started the task, not when the task is
        // done, so this may well show the previous run's output. The card says
        // as much above the log rather than pretending otherwise.
        loadLogs();
        onDone();
      } else {
        toast.error(actionError(res.error));
      }
    });
  }

  function toggle() {
    const fd = new FormData();
    fd.set('id', String(task.id));
    fd.set('name', task.name);
    fd.set('enabled', task.enabled ? 'false' : 'true');
    startWork(async () => {
      const res = await setCronTaskEnabledAction(id, fd);
      if (res.ok) {
        // `already` means the panel was found in the requested state and
        // nothing was sent — worth saying, because it means this screen and
        // that panel had disagreed.
        toast.success(
          res.message === 'already'
            ? t('toastAlready')
            : task.enabled
              ? t('toastDisabled')
              : t('toastEnabled'),
        );
        setPendingOp(null);
        onDone();
      } else {
        toast.error(actionError(res.error));
      }
    });
  }

  function remove() {
    const fd = new FormData();
    fd.set('id', String(task.id));
    fd.set('name', task.name);
    fd.set('confirm', confirmValue);
    startWork(async () => {
      const res = await deleteCronTaskAction(id, fd);
      if (res.ok) {
        toast.success(t('toastDeleted'));
        setOpen(false);
        setPendingOp(null);
        setConfirmValue('');
        onDone();
      } else {
        toast.error(actionError(res.error));
      }
    });
  }

  const row = (label: string, value: React.ReactNode) => (
    <div className="flex items-baseline justify-between gap-4 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right break-all">{value}</span>
    </div>
  );

  const time = clockTime(task);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={trigger} />
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="break-all">{task.name || t('untitled')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            {row(t('status'), (
              <Badge
                variant="secondary"
                className={
                  task.enabled
                    ? 'border-0 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                    : 'border-0 bg-muted text-muted-foreground'
                }
              >
                {task.enabled ? t('enabled') : t('disabled')}
              </Badge>
            ))}
            {row(t('schedule'), scheduleText(task))}
            {/* The same schedule as the panel stores it, beside the sentence it
                writes. Two reasons for showing raw fields at all: the sentence
                arrives in the panel's language, which on a fleet is not always
                the reader's, and the fields are what a later slice will edit.
                Labelled as storage rather than as a time, because they are not
                one — an every-N-minutes task carries an hour and a minute that
                say nothing about when it runs, and a row called "Time" beside
                "every 4 minutes" invites exactly the wrong conclusion. */}
            {row(
              t('scheduleFields'),
              <span className="font-mono text-xs">
                {[task.type || '—', time].filter(Boolean).join(' · ')}
              </span>,
            )}
            {row(t('kind'), task.kind || '—')}
            {row(t('target'), task.target || '—')}
            {row(t('user'), <span className="font-mono text-xs">{task.user || '—'}</span>)}
          </div>

          <Separator />

          <div>
            <h3 className="mb-2 text-sm font-medium">{t('scriptSection')}</h3>
            {task.script.trim() === '' ? (
              // Not every task has one: a backup or a log rotation is configured
              // through the panel's own fields, and has no script to show.
              <p className="text-sm text-muted-foreground">{t('noScript')}</p>
            ) : (
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
                {task.script}
              </pre>
            )}
          </div>

          <Separator />

          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-sm font-medium">{t('logSection')}</h3>
              <Button variant="outline" size="sm" disabled={loadingLogs} onClick={loadLogs}>
                <RefreshCw className="mr-1 h-3.5 w-3.5" />
                {t('refresh')}
              </Button>
            </div>
            <p className="mb-2 text-xs text-muted-foreground">{t('logIsLastRunOnly')}</p>

            {logsError && (
              <p className="mb-2 text-xs text-destructive" role="alert">
                {logsError}
              </p>
            )}

            {loadingLogs && logs === null && (
              <p className="text-sm text-muted-foreground">{t('loading')}</p>
            )}

            {logs !== null &&
              (logs.trim() === '' ? (
                <p className="text-sm text-muted-foreground">{t('logEmpty')}</p>
              ) : (
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
                  {logs}
                </pre>
              ))}
          </div>

          {isAdmin && (
            <>
              <Separator />
              {pendingOp === null ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setPendingOp('run')}>
                    <Play className="mr-1 h-3.5 w-3.5" />
                    {t('runNow')}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setPendingOp('toggle')}>
                    {task.enabled ? (
                      <PowerOff className="mr-1 h-3.5 w-3.5" />
                    ) : (
                      <Power className="mr-1 h-3.5 w-3.5" />
                    )}
                    {task.enabled ? t('stopTask') : t('startTask')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto text-destructive hover:text-destructive"
                    onClick={() => setPendingOp('delete')}
                  >
                    <Trash2 className="mr-1 h-3.5 w-3.5" />
                    {t('delete')}
                  </Button>
                </div>
              ) : (
                <div
                  className="space-y-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3"
                  role="alertdialog"
                  aria-label={t('confirmTitle')}
                >
                  <p className="text-sm">
                    {pendingOp === 'run'
                      ? t('confirmRun')
                      : pendingOp === 'delete'
                        ? t('confirmDelete')
                        : task.enabled
                          ? t('confirmStop')
                          : t('confirmStart')}
                  </p>

                  {pendingOp === 'delete' && (
                    <div className="space-y-1.5">
                      <Label htmlFor={`cron-confirm-${task.id}`}>
                        {t('confirmDeleteLabel', {phrase})}
                      </Label>
                      <Input
                        id={`cron-confirm-${task.id}`}
                        value={confirmValue}
                        onChange={(e) => setConfirmValue(e.target.value)}
                        autoComplete="off"
                        placeholder={phrase}
                      />
                    </div>
                  )}

                  <div className="flex items-center justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={working}
                      onClick={() => {
                        setPendingOp(null);
                        setConfirmValue('');
                      }}
                    >
                      {t('cancel')}
                    </Button>
                    <Button
                      variant={pendingOp === 'delete' ? 'destructive' : 'default'}
                      size="sm"
                      // The typed phrase is checked here so the button cannot be
                      // pressed by accident, and again on the server, where a
                      // browser cannot reach in and skip it.
                      disabled={working || (pendingOp === 'delete' && confirmValue !== phrase)}
                      onClick={
                        pendingOp === 'run' ? runNow : pendingOp === 'delete' ? remove : toggle
                      }
                    >
                      {pendingOp === 'run'
                        ? t('runNow')
                        : pendingOp === 'delete'
                          ? t('delete')
                          : task.enabled
                            ? t('stopTask')
                            : t('startTask')}
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
