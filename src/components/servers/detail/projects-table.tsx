'use client';

import {useCallback, useEffect, useRef, useState, useTransition} from 'react';
import {useTranslations} from 'next-intl';
import {toast} from 'sonner';
import {FileText, Play, Square, RotateCcw, RefreshCw, Pencil, Trash2, PlusCircle} from 'lucide-react';
import type {ProjectsResult} from '@/server/actions/projects';
import {listNodeProjectsAction, projectControlAction} from '@/server/actions/projects';
import type {ProjectOperation} from '@/lib/aapanel';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {ProjectLogsDialog} from '@/components/servers/detail/project-logs-dialog';
import {ProjectFormDialog} from '@/components/servers/detail/project-form-dialog';
import {ProjectDeleteDialog} from '@/components/servers/detail/project-delete-dialog';

export interface ProjectsTableProps {
  id: string;
  initial: ProjectsResult;
  isAdmin: boolean;
}

const OP_TOAST_KEY: Record<ProjectOperation, 'started' | 'stopped_msg' | 'restarted'> = {
  start: 'started',
  stop: 'stopped_msg',
  restart: 'restarted',
};

const PROJECTS_POLL_INTERVAL_MS = 12_000;

export function ProjectsTable({id, initial, isAdmin}: ProjectsTableProps) {
  const t = useTranslations('projects');
  const [result, setResult] = useState<ProjectsResult>(initial);
  const [pending, startTransition] = useTransition();

  // Shared by manual refresh, post-operation refresh, and the background poll.
  // A request token ensures only the latest fetch's result is applied.
  const inFlightRef = useRef(false);
  const reqIdRef = useRef(0);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    const reqId = (reqIdRef.current += 1);
    inFlightRef.current = true;
    try {
      const res = await listNodeProjectsAction(id);
      if (mountedRef.current && reqId === reqIdRef.current) setResult(res);
    } finally {
      inFlightRef.current = false;
    }
  }, [id]);

  // Light auto-refresh so status changes appear without a manual click; pauses
  // when the tab is hidden and never starts a poll while a fetch is in flight.
  useEffect(() => {
    mountedRef.current = true;
    const tick = () => {
      if (document.visibilityState === 'visible' && !inFlightRef.current) void load();
    };
    const intervalId = setInterval(tick, PROJECTS_POLL_INTERVAL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(intervalId);
    };
  }, [load]);

  function refetch() {
    startTransition(async () => {
      await load();
    });
  }

  function runOp(name: string, op: ProjectOperation) {
    startTransition(async () => {
      const res = await projectControlAction(id, name, op);
      if (res.ok) {
        toast.success(t(OP_TOAST_KEY[op]));
        await load();
      } else {
        toast.error(res.message);
      }
    });
  }

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
      <h2 className="text-base font-semibold">{t('title')}</h2>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={pending} onClick={refetch}>
          <RefreshCw className="mr-1" />
          {t('refresh')}
        </Button>
        {isAdmin && (
          <ProjectFormDialog
            mode="create"
            serverId={id}
            onDone={() => void load()}
            trigger={
              <Button size="sm">
                <PlusCircle className="mr-1 h-3.5 w-3.5" />
                {t('add')}
              </Button>
            }
          />
        )}
      </div>
    </div>
  );

  if (!result.ok) {
    return (
      <div>
        {header}
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive" role="alert">
          <p className="font-medium">{t('loadFailed')}</p>
          <p className="mt-1 text-xs opacity-80">{result.message}</p>
        </div>
      </div>
    );
  }

  const projects = result.projects;

  if (projects.length === 0) {
    return (
      <div>
        {header}
        <p className="text-sm text-muted-foreground">{t('noProjects')}</p>
      </div>
    );
  }

  return (
    <div>
      {header}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('name')}</TableHead>
            <TableHead>{t('status')}</TableHead>
            <TableHead>{t('port')}</TableHead>
            <TableHead>{t('cpu')}</TableHead>
            <TableHead>{t('mem')}</TableHead>
            <TableHead>{t('actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {projects.map((p) => (
            <TableRow key={p.name}>
              <TableCell className="font-medium">{p.name}</TableCell>
              <TableCell>
                <Badge
                  variant={
                    p.status === 'running'
                      ? 'default'
                      : p.status === 'stopped'
                      ? 'destructive'
                      : 'secondary'
                  }
                  className={
                    p.status === 'running'
                      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-0'
                      : undefined
                  }
                >
                  {t(p.status)}
                </Badge>
              </TableCell>
              <TableCell>{p.port ?? '—'}</TableCell>
              <TableCell>{p.cpu == null ? '—' : `${p.cpu.toFixed(1)}%`}</TableCell>
              <TableCell>{p.mem == null ? '—' : `${Math.round(p.mem)} MB`}</TableCell>
              <TableCell>
                <div className="flex items-center gap-1">
                  <ProjectLogsDialog
                    id={id}
                    project={p.name}
                    trigger={
                      <Button variant="ghost" size="sm" title={t('logs')}>
                        <FileText />
                        <span className="sr-only">{t('logs')}</span>
                      </Button>
                    }
                  />
                  {isAdmin && (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        title={t('start')}
                        disabled={pending || p.status === 'running'}
                        onClick={() => runOp(p.name, 'start')}
                      >
                        <Play />
                        <span className="sr-only">{t('start')}</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        title={t('stop')}
                        disabled={pending || p.status === 'stopped'}
                        onClick={() => runOp(p.name, 'stop')}
                      >
                        <Square />
                        <span className="sr-only">{t('stop')}</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        title={t('restart')}
                        disabled={pending}
                        onClick={() => runOp(p.name, 'restart')}
                      >
                        <RotateCcw />
                        <span className="sr-only">{t('restart')}</span>
                      </Button>
                      <ProjectFormDialog
                        mode="edit"
                        serverId={id}
                        projectName={p.name}
                        onDone={() => void load()}
                        trigger={
                          <Button variant="ghost" size="sm" title={t('edit')}>
                            <Pencil />
                            <span className="sr-only">{t('edit')}</span>
                          </Button>
                        }
                      />
                      <ProjectDeleteDialog
                        serverId={id}
                        projectName={p.name}
                        onDone={() => void load()}
                        trigger={
                          <Button variant="ghost" size="sm" title={t('delete')}>
                            <Trash2 />
                            <span className="sr-only">{t('delete')}</span>
                          </Button>
                        }
                      />
                    </>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
