'use client';

import {useState, useTransition} from 'react';
import {useTranslations} from 'next-intl';
import {toast} from 'sonner';
import {createFtpUserAction} from '@/server/actions/ftp';
import type {FtpMutResult} from '@/server/actions/ftp';
import {useActionError} from '@/components/use-action-error';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

const INITIAL: FtpMutResult = {ok: false, error: ''};

export interface FtpFormDialogProps {
  id: string;
  trigger: React.ReactElement;
  onDone: () => void;
}

/**
 * Creates an FTP account on the server.
 *
 * Two things happen on the client's machine and the form says both: a real
 * system FTP account appears, and the home directory is created if it is not
 * there. The second one outlives the first — deleting the account later leaves
 * the directory behind — which is why the path is asked for deliberately rather
 * than derived from the name.
 *
 * The password goes browser → action → panel and stops there. Nothing here
 * keeps it, and nothing sends it back: the panel will happily return it with
 * every future listing, and the app drops it at the client (§16).
 */
export function FtpFormDialog({id, trigger, onDone}: FtpFormDialogProps) {
  const t = useTranslations('ftp');
  const actionError = useActionError();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<FtpMutResult>(INITIAL);
  const [pending, startSubmit] = useTransition();

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setResult(INITIAL);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startSubmit(async () => {
      const res = await createFtpUserAction(id, fd);
      setResult(res);
      if (res.ok) {
        toast.success(t('created'));
        setOpen(false);
        onDone();
      } else if (res.error !== 'validation') {
        toast.error(actionError(res.error));
      }
    });
  }

  const fieldErr = (name: string): string | undefined =>
    !result.ok && result.fieldErrors ? result.fieldErrors[name]?.[0] : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={trigger} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('add')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          {!result.ok && result.error && result.error !== 'validation' ? (
            <p className="text-sm text-destructive" role="alert">
              {actionError(result.error)}
            </p>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="ftpf-username">{t('username')}</Label>
            <Input id="ftpf-username" name="username" required autoComplete="off" />
            {fieldErr('username') ? (
              <p className="text-xs text-destructive">{fieldErr('username')}</p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ftpf-password">{t('password')}</Label>
            <Input
              id="ftpf-password"
              name="password"
              type="password"
              required
              autoComplete="new-password"
            />
            <p className="text-xs text-muted-foreground">{t('passwordHint')}</p>
            {fieldErr('password') ? (
              <p className="text-xs text-destructive">{fieldErr('password')}</p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ftpf-path">{t('path')}</Label>
            <Input
              id="ftpf-path"
              name="path"
              required
              autoComplete="off"
              placeholder="/www/wwwroot/example"
            />
            {/* Said before the button is pressed, not after: the panel creates
                this directory, and deleting the account will not remove it. */}
            <p className="text-xs text-muted-foreground">{t('pathHint')}</p>
            {fieldErr('path') ? (
              <p className="text-xs text-destructive">{fieldErr('path')}</p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ftpf-note">{t('note')}</Label>
            <Input id="ftpf-note" name="note" autoComplete="off" />
            {fieldErr('note') ? (
              <p className="text-xs text-destructive">{fieldErr('note')}</p>
            ) : null}
          </div>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {t('create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
