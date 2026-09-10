'use client';
import {useMemo, useState, useTransition} from 'react';
import {useRouter} from 'next/navigation';
import {useTranslations} from 'next-intl';
import {useActionError} from '@/components/use-action-error';
import {toast} from 'sonner';
import {createProjectControlJobAction} from '@/server/actions/jobs';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Switch} from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

const OPERATIONS = ['restart', 'start', 'stop'] as const;

export interface BulkProjectDialogProps {
  /** Servers on the page in view. Selection stays inside one page on purpose:
   *  a choice that survives paging makes "what am I confirming" unanswerable. */
  servers: Array<{id: string; name: string}>;
  trigger: React.ReactElement;
}

/**
 * Chooses servers, previews them, and queues one operation across all of them.
 *
 * Choice, preview and confirmation live in the same dialog deliberately: a bulk
 * operation is as dangerous as the number of machines in it (PROJECT_RULES.md §16),
 * so the list being acted on must be in front of the operator when they confirm.
 */
export function BulkProjectDialog({servers, trigger}: BulkProjectDialogProps) {
  const t = useTranslations('jobs');
  const actionError = useActionError();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [project, setProject] = useState('');
  const [operation, setOperation] = useState<(typeof OPERATIONS)[number]>('restart');
  const [stopOnError, setStopOnError] = useState(true);
  const [confirm, setConfirm] = useState('');
  const [selected, setSelected] = useState<Set<string>>(() => new Set(servers.map((s) => s.id)));
  const [error, setError] = useState('');
  const [pending, start] = useTransition();

  const chosen = useMemo(() => servers.filter((s) => selected.has(s.id)), [servers, selected]);
  const canSubmit = chosen.length > 0 && project.trim() !== '' && confirm === project.trim();

  function reset(next: boolean): void {
    setOpen(next);
    if (!next) {
      setConfirm('');
      setError('');
    }
  }

  function toggle(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function submit(): void {
    const fd = new FormData();
    fd.set('project', project.trim());
    fd.set('operation', operation);
    fd.set('stopOnError', stopOnError ? 'true' : 'false');
    fd.set('confirm', confirm);
    for (const s of chosen) fd.append('serverIds', s.id);

    start(async () => {
      const res = await createProjectControlJobAction(fd);
      if (res.ok) {
        toast.success(t('queued'));
        reset(false);
        router.push(`/jobs/${res.jobId}` as never);
      } else {
        setError(res.error);
      }
    });
  }

  /**
   * The queue's own refusals, then everything else.
   *
   * Written as a switch over literal keys rather than `t(`error.${code}`)`,
   * which is what stood here: messages.test.ts skips dynamic keys on purpose,
   * so a queue code without a translation reached the operator as the key
   * itself and the gate stayed green (Д-17, Д-20, Д-23). Codes that are not the
   * queue's own — a role refusal, a validation failure — belong to the shared
   * dictionary, which is why they are not repeated here.
   */
  function queueError(code: string): string {
    switch (code) {
      case 'unknown-kind':
        return t('error.unknown-kind');
      case 'no-servers':
        return t('error.no-servers');
      case 'too-many-servers':
        return t('error.too-many-servers');
      case 'missing-servers':
        return t('error.missing-servers');
      default:
        return actionError(code);
    }
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger render={trigger} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('bulkTitle')}</DialogTitle>
          <DialogDescription>{t('bulkHint')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {queueError(error)}
            </p>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="bp-project">{t('project')}</Label>
            <Input
              id="bp-project"
              value={project}
              onChange={(e) => setProject(e.target.value)}
              placeholder={t('projectPlaceholder')}
              autoComplete="off"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bp-operation">{t('operation')}</Label>
            <select
              id="bp-operation"
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={operation}
              onChange={(e) => setOperation(e.target.value as (typeof OPERATIONS)[number])}
            >
              {OPERATIONS.map((op) => (
                <option key={op} value={op}>
                  {t(`op.${op}`)}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>{t('servers', {n: chosen.length, total: servers.length})}</Label>
              <button
                type="button"
                className="text-xs underline underline-offset-2"
                onClick={() =>
                  setSelected(
                    chosen.length === servers.length ? new Set() : new Set(servers.map((s) => s.id)),
                  )
                }
              >
                {chosen.length === servers.length ? t('selectNone') : t('selectAll')}
              </button>
            </div>
            <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2 text-sm">
              {servers.map((s) => (
                <li key={s.id} className="flex items-center gap-2">
                  <input
                    id={`bp-s-${s.id}`}
                    type="checkbox"
                    className="size-4 rounded border-input"
                    checked={selected.has(s.id)}
                    onChange={() => toggle(s.id)}
                  />
                  <Label htmlFor={`bp-s-${s.id}`} className="font-normal">
                    {s.name}
                  </Label>
                </li>
              ))}
            </ul>
            {/* The first one runs alone: a wrong parameter reaches one machine, not all. */}
            {chosen.length > 0 ? (
              <p className="text-xs text-muted-foreground">{t('canary', {name: chosen[0]!.name})}</p>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            <Switch id="bp-stop" checked={stopOnError} onCheckedChange={setStopOnError} />
            <Label htmlFor="bp-stop">{t('stopOnError')}</Label>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bp-confirm">{t('confirmLabel')}</Label>
            <Input
              id="bp-confirm"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder={project.trim() || t('projectPlaceholder')}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">{t('confirmHint')}</p>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => reset(false)}>
            {t('cancel')}
          </Button>
          <Button type="button" disabled={!canSubmit || pending} onClick={submit}>
            {pending ? t('queueing') : t('queue')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
