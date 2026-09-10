'use client';

import {useState, useTransition} from 'react';
import {useTranslations} from 'next-intl';
import {toast} from 'sonner';
import {KeyRound, Power, PowerOff, Trash2} from 'lucide-react';
import type {FtpUser} from '@/lib/aapanel';
import {
  setFtpUserPasswordAction,
  setFtpUserEnabledAction,
  deleteFtpUserAction,
} from '@/server/actions/ftp';
import {useActionError} from '@/components/use-action-error';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Separator} from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

export interface FtpUserDialogProps {
  id: string;
  user: FtpUser;
  isAdmin: boolean;
  trigger: React.ReactElement;
  onDone: () => void;
}

/** Which operation is waiting to be confirmed, if any. */
type Pending = null | 'toggle' | 'password' | 'delete';

/**
 * One FTP account: what it is, and the three things that can be done to it.
 *
 * There is no "show password" here, and its absence is a decision rather than a
 * gap. The panel keeps these in clear text and will show them; this app is a
 * fleet console, and a client's credential on screen is also a credential in
 * the page source, in a screenshot, and over the shoulder of whoever walks past.
 * Anyone who genuinely needs the password has the panel.
 *
 * Confirmations are inline rather than nested dialogs, for the same reason the
 * scheduler's card does it that way: a dialog inside a dialog reads badly and
 * loses focus.
 */
export function FtpUserDialog({id, user, isAdmin, trigger, onDone}: FtpUserDialogProps) {
  const t = useTranslations('ftp');
  const actionError = useActionError();
  const [open, setOpen] = useState(false);
  const [pendingOp, setPendingOp] = useState<Pending>(null);
  const [confirmValue, setConfirmValue] = useState('');
  const [password, setPassword] = useState('');
  const [working, startWork] = useTransition();

  function reset() {
    setPendingOp(null);
    setConfirmValue('');
    setPassword('');
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) reset();
  }

  function toggle() {
    const fd = new FormData();
    fd.set('id', String(user.id));
    fd.set('username', user.name);
    fd.set('enabled', user.enabled ? 'false' : 'true');
    startWork(async () => {
      const res = await setFtpUserEnabledAction(id, fd);
      if (res.ok) {
        toast.success(user.enabled ? t('toastDisabled') : t('toastEnabled'));
        reset();
        onDone();
      } else {
        toast.error(actionError(res.error));
      }
    });
  }

  function changePassword() {
    const fd = new FormData();
    fd.set('id', String(user.id));
    fd.set('username', user.name);
    fd.set('password', password);
    startWork(async () => {
      const res = await setFtpUserPasswordAction(id, fd);
      if (res.ok) {
        toast.success(t('toastPassword'));
        reset();
      } else if (res.error === 'validation') {
        // The only field there is, so the message can be specific.
        toast.error(t('passwordHint'));
      } else {
        toast.error(actionError(res.error));
      }
    });
  }

  function remove() {
    const fd = new FormData();
    fd.set('id', String(user.id));
    fd.set('username', user.name);
    fd.set('confirm', confirmValue);
    startWork(async () => {
      const res = await deleteFtpUserAction(id, fd);
      if (res.ok) {
        toast.success(t('toastDeleted'));
        setOpen(false);
        reset();
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={trigger} />
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="break-all">{user.name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            {row(t('status'), (
              <Badge
                variant="secondary"
                className={
                  user.enabled
                    ? 'border-0 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                    : 'border-0 bg-muted text-muted-foreground'
                }
              >
                {user.enabled ? t('enabled') : t('disabled')}
              </Badge>
            ))}
            {row(t('path'), <span className="font-mono text-xs">{user.path || '—'}</span>)}
            {row(t('note'), user.note || '—')}
            {row(t('created'), <span className="tabular-nums">{user.addtime || '—'}</span>)}
          </div>

          {isAdmin && (
            <>
              <Separator />
              {pendingOp === null ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setPendingOp('toggle')}>
                    {user.enabled ? (
                      <PowerOff className="mr-1 h-3.5 w-3.5" />
                    ) : (
                      <Power className="mr-1 h-3.5 w-3.5" />
                    )}
                    {user.enabled ? t('disable') : t('enable')}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setPendingOp('password')}>
                    <KeyRound className="mr-1 h-3.5 w-3.5" />
                    {t('changePassword')}
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
                    {pendingOp === 'delete'
                      ? t('confirmDelete')
                      : pendingOp === 'password'
                        ? t('confirmPassword')
                        : user.enabled
                          ? t('confirmDisable')
                          : t('confirmEnable')}
                  </p>

                  {pendingOp === 'password' && (
                    <div className="space-y-1.5">
                      <Label htmlFor={`ftp-pw-${user.id}`}>{t('newPassword')}</Label>
                      <Input
                        id={`ftp-pw-${user.id}`}
                        type="password"
                        autoComplete="new-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">{t('passwordHint')}</p>
                    </div>
                  )}

                  {pendingOp === 'delete' && (
                    <div className="space-y-1.5">
                      <Label htmlFor={`ftp-confirm-${user.id}`}>
                        {t('confirmDeleteLabel', {name: user.name})}
                      </Label>
                      <Input
                        id={`ftp-confirm-${user.id}`}
                        value={confirmValue}
                        onChange={(e) => setConfirmValue(e.target.value)}
                        autoComplete="off"
                        placeholder={user.name}
                      />
                    </div>
                  )}

                  <div className="flex items-center justify-end gap-2">
                    <Button variant="outline" size="sm" disabled={working} onClick={reset}>
                      {t('cancel')}
                    </Button>
                    <Button
                      variant={pendingOp === 'delete' ? 'destructive' : 'default'}
                      size="sm"
                      disabled={
                        working ||
                        (pendingOp === 'delete' && confirmValue !== user.name) ||
                        (pendingOp === 'password' && password.length < 8)
                      }
                      onClick={
                        pendingOp === 'delete'
                          ? remove
                          : pendingOp === 'password'
                            ? changePassword
                            : toggle
                      }
                    >
                      {pendingOp === 'delete'
                        ? t('delete')
                        : pendingOp === 'password'
                          ? t('changePassword')
                          : user.enabled
                            ? t('disable')
                            : t('enable')}
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
