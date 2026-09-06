'use client';

import {useCallback, useEffect, useRef, useState, useTransition} from 'react';
import {useTranslations} from 'next-intl';
import {RefreshCw} from 'lucide-react';
import {getProjectLogsAction} from '@/server/actions/projects';
import {Button} from '@/components/ui/button';
import {Label} from '@/components/ui/label';
import {Switch} from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

export interface ProjectLogsDialogProps {
  id: string;
  project: string;
  trigger: React.ReactElement;
}

const LOGS_POLL_INTERVAL_MS = 4_000;
/** Distance (px) from the bottom within which we treat the view as "pinned". */
const PIN_THRESHOLD_PX = 40;

/**
 * Project log viewer with an optional "Live" mode.
 *
 * The panel's `get_project_log` returns the whole log each call (no tail/stream
 * endpoint), so Live mode polls on an interval rather than streaming. Polling
 * runs only while the dialog is open and the tab is visible, never overlaps an
 * in-flight request, updates the text silently (no loading flash), and
 * auto-scrolls to the bottom only when the user is already pinned there.
 */
export function ProjectLogsDialog({id, project, trigger}: ProjectLogsDialogProps) {
  const t = useTranslations('projects');
  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [pending, startTransition] = useTransition();

  // A request token ensures only the latest fetch's result is applied; the
  // in-flight flag stops the poll from stacking requests.
  const inFlightRef = useRef(false);
  const reqIdRef = useRef(0);
  const mountedRef = useRef(true);
  const preRef = useRef<HTMLPreElement>(null);
  const pinnedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    const reqId = (reqIdRef.current += 1);
    inFlightRef.current = true;
    try {
      const res = await getProjectLogsAction(id, project);
      if (!mountedRef.current || reqId !== reqIdRef.current) return;
      if (res.ok) {
        setLogs(res.logs);
        setError(null);
      } else {
        // Keep the last good log on a transient poll failure; surface the error.
        setError(res.message);
      }
    } finally {
      inFlightRef.current = false;
    }
  }, [id, project]);

  // Live polling: only while open + live + tab visible, never overlapping.
  useEffect(() => {
    if (!open || !live) return;
    const tick = () => {
      if (document.visibilityState === 'visible' && !inFlightRef.current) void load();
    };
    const intervalId = setInterval(tick, LOGS_POLL_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [open, live, load]);

  // Auto-scroll to the bottom on new content when the user is pinned there.
  useEffect(() => {
    if (logs === null) return;
    const el = preRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [logs]);

  function refresh() {
    startTransition(async () => {
      await load();
    });
  }

  function toggleLive(next: boolean) {
    setLive(next);
    if (next) void load(); // fetch immediately, then the interval takes over
  }

  function onScroll(e: React.UIEvent<HTMLPreElement>) {
    const el = e.currentTarget;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < PIN_THRESHOLD_PX;
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setLogs(null);
      setError(null);
      setLive(false);
      pinnedRef.current = true;
      refresh();
    } else {
      setLive(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('logsTitle', {name: project})}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          {pending && logs === null && (
            <p className="text-xs text-muted-foreground animate-pulse">{t('loading')}</p>
          )}

          {error && logs === null && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          {logs !== null &&
            (logs.trim() === '' ? (
              <p className="text-sm text-muted-foreground">{t('logsEmpty')}</p>
            ) : (
              <>
                {error && (
                  <p className="text-xs text-destructive" role="alert">
                    {t('logsUpdateFailed')}: {error}
                  </p>
                )}
                <pre
                  ref={preRef}
                  onScroll={onScroll}
                  className="max-h-[60vh] overflow-auto whitespace-pre-wrap text-xs bg-muted rounded-md p-3"
                >
                  {logs}
                </pre>
              </>
            ))}

          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-2">
              <Switch id={`logs-live-${project}`} checked={live} onCheckedChange={toggleLive} />
              <Label htmlFor={`logs-live-${project}`} className="text-sm">
                {t('logsLive')}
              </Label>
              {live && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  {t('logsLiveOn')}
                </span>
              )}
            </div>
            <Button variant="outline" size="sm" disabled={pending} onClick={refresh}>
              <RefreshCw className="mr-1" />
              {t('logsRefresh')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
