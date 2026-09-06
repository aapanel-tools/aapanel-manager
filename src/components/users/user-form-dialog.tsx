'use client';

import {useState, useTransition} from 'react';
import {useTranslations} from 'next-intl';
import {toast} from 'sonner';
import {createUserAction, type UserMutResult} from '@/server/actions/users';
import {USER_ROLES} from '@/lib/validation/user';
import {KNOWN_USER_ERRORS} from '@/components/users/errors';
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

const INITIAL: UserMutResult = {ok: false, error: ''};
const SELECT_CLASS =
  'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring';

export function UserFormDialog({trigger, onDone}: {trigger: React.ReactElement; onDone: () => void}) {
  const t = useTranslations('users');
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<UserMutResult>(INITIAL);
  const [pending, start] = useTransition();

  const errText = (code: string) => (KNOWN_USER_ERRORS.has(code) ? t(`err.${code}`) : code);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setResult(INITIAL);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const res = await createUserAction(fd);
      setResult(res);
      if (res.ok) {
        toast.success(t('createdToast'));
        setOpen(false);
        onDone();
      } else if (res.error !== 'validation') {
        toast.error(errText(res.error));
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
        <form key={open ? 'open' : 'closed'} onSubmit={onSubmit} className="space-y-4">
          {!result.ok && result.error && result.error !== 'validation' ? (
            <p className="text-sm text-destructive" role="alert">
              {errText(result.error)}
            </p>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="uf-email">{t('email')}</Label>
            <Input id="uf-email" name="email" type="email" required autoComplete="off" />
            {fieldErr('email') ? <p className="text-xs text-destructive">{fieldErr('email')}</p> : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="uf-role">{t('role')}</Label>
            <select id="uf-role" name="role" defaultValue="viewer" className={SELECT_CLASS} required>
              {USER_ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(r === 'admin' ? 'roleAdmin' : 'roleViewer')}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="uf-password">{t('password')}</Label>
            <Input id="uf-password" name="password" type="password" required autoComplete="new-password" />
            <p className="text-xs text-muted-foreground">{t('passwordHint')}</p>
            {fieldErr('password') ? <p className="text-xs text-destructive">{fieldErr('password')}</p> : null}
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
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
