'use client';

import {useState, useTransition} from 'react';
import {useTranslations} from 'next-intl';
import {RefreshCw} from 'lucide-react';
import type {CronTask} from '@/lib/aapanel';
import {getCronLogsAction} from '@/server/actions/cron';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {Separator} from '@/components/ui/separator';
import {scheduleText, clockTime} from '@/components/servers/detail/cron-schedule';
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
  trigger: React.ReactElement;
}

/**
 * Read-only card for one scheduled task: what it runs, and what it last printed.
 *
 * Everything except the output is already in hand — the list carries it — so
 * the card opens filled in and the one call to the panel is the log. That call
 * happens on open rather than on mount because the table renders one of these
 * per row, and a card nobody opened must not reach a production panel
 * (ADR-0004).
 *
 * The script is shown here and nowhere else. It is what makes a scheduled task
 * comprehensible, and it is also where a hosting panel keeps `mysqldump
 * -p<password>` — so it is behind a deliberate click, never in a listing, and
 * never in a log line the app writes (§16).
 *
 * The log is one run, not a history: the panel keeps only the most recent
 * output. A task that fails every night looks the same as one that failed once,
 * and the card says so rather than letting a clean log read as proof.
 */
export function CronTaskDialog({id, task, trigger}: CronTaskDialogProps) {
  const t = useTranslations('cron');
  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState<string | null>(null);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function loadLogs() {
    startTransition(async () => {
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
    if (next && logs === null && !pending) loadLogs();
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
              <Button variant="outline" size="sm" disabled={pending} onClick={loadLogs}>
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

            {pending && logs === null && (
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
