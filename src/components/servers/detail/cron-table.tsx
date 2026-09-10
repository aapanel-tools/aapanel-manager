'use client';

import {useTranslations} from 'next-intl';
import {RefreshCw} from 'lucide-react';
import type {CronListResult} from '@/server/actions/cron';
import {listCronTasksAction} from '@/server/actions/cron';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {ListIntegrityNotice} from '@/components/servers/detail/list-integrity-notice';
import {ListSearch} from '@/components/servers/detail/list-search';
import {useSearchableList} from '@/components/servers/detail/use-searchable-list';
import {CronTaskDialog} from '@/components/servers/detail/cron-task-dialog';
import {scheduleText} from '@/components/servers/detail/cron-schedule';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export interface CronTableProps {
  id: string;
  initial: CronListResult;
  /** Whether the viewer may change anything; the task card hides its controls otherwise. */
  isAdmin: boolean;
}

/**
 * The scheduled tasks on one server, read-only.
 *
 * Cron is where a fleet breaks quietly: a backup that stopped running looks
 * exactly like one that runs, until the day someone needs the backup. So this
 * slice shows the two things that reveal that — whether a task is enabled, and
 * what its last run printed — before it offers to change anything.
 *
 * Running, stopping and deleting a task are done from the task's card, not from
 * a row here. The card is the only place the script is visible, and acting on a
 * task without seeing what it runs is how a client's site goes down — so the
 * extra click is the point of the design rather than a cost of it.
 *
 * The script itself is not a column, for the same reason it is behind a click:
 * backup scripts on a hosting panel routinely carry a database password in
 * plain text, and a table puts every one of them on screen at once.
 */
export function CronTable({id, initial, isAdmin}: CronTableProps) {
  const t = useTranslations('cron');
  const {result, search, setSearch, applied, pending, reload} = useSearchableList<CronListResult>(
    initial,
    (term) => listCronTasksAction(id, term),
  );

  const header = (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-base font-semibold">{t('title')}</h2>
      <div className="flex items-center gap-2">
        <ListSearch
          value={search}
          onChange={setSearch}
          placeholder={t('searchPlaceholder')}
          busy={pending}
        />
        <Button variant="outline" size="sm" disabled={pending} onClick={() => void reload()}>
          <RefreshCw className="mr-1 h-3.5 w-3.5" />
          {t('refresh')}
        </Button>
      </div>
    </div>
  );

  // A source that did not answer stays visible: a list that came back empty
  // because the panel refused reads exactly like a server with no scheduled
  // tasks, and that reading is how a missing backup goes unnoticed (ADR-0003).
  const partial = result.ok ? (
    <ListIntegrityNotice
      failures={result.failures}
      truncations={result.truncations}
      labelSource={() => t('title')}
    />
  ) : null;

  if (!result.ok) {
    return (
      <div>
        {header}
        <div
          className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
          role="alert"
        >
          <p className="font-medium">{t('loadFailed')}</p>
          <p className="mt-1 text-xs opacity-80">{result.message}</p>
        </div>
      </div>
    );
  }

  if (result.tasks.length === 0) {
    return (
      <div>
        {header}
        {partial}
        {/* "No scheduled tasks" is a claim about the server, and it is only
            true when the panel actually answered. With a search running it is
            not a claim about the server at all — and it names the term the rows
            were fetched with, not the one still being typed. */}
        {result.failures.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {applied ? t('noMatches', {query: applied}) : t('noTasks')}
          </p>
        )}
      </div>
    );
  }

  return (
    <div>
      {header}
      {partial}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('name')}</TableHead>
            <TableHead>{t('schedule')}</TableHead>
            <TableHead>{t('kind')}</TableHead>
            <TableHead>{t('target')}</TableHead>
            <TableHead>{t('user')}</TableHead>
            <TableHead>{t('status')}</TableHead>
            <TableHead className="w-0" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.tasks.map((task) => (
            <TableRow key={task.id}>
              <TableCell className="font-medium">{task.name || '—'}</TableCell>
              {/* The panel's own sentence, in the panel's language. Translating
                  it would mean deriving the schedule from fields whose meaning
                  has not been observed — see cron-schedule.ts. */}
              <TableCell>{scheduleText(task)}</TableCell>
              <TableCell>
                {/* The panel's own word for the kind of task: an unrecognised
                    one is information, not a rendering problem. */}
                <Badge variant="secondary" className="border-0">
                  {task.kind || '—'}
                </Badge>
              </TableCell>
              <TableCell className="max-w-[16rem] truncate" title={task.target}>
                {task.target || '—'}
              </TableCell>
              <TableCell className="font-mono text-xs">{task.user || '—'}</TableCell>
              <TableCell>
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
              </TableCell>
              <TableCell className="text-right">
                <CronTaskDialog
                  id={id}
                  task={task}
                  isAdmin={isAdmin}
                  // After anything changes, the list is re-read rather than
                  // patched in place: the panel is the truth, and a row edited
                  // locally to look right is a guess about someone else's
                  // machine (§16).
                  onDone={() => void reload()}
                  trigger={
                    <Button variant="ghost" size="sm">
                      {t('details')}
                    </Button>
                  }
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
