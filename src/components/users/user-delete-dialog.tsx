'use client';

import {useState, useTransition} from 'react';
import {useTranslations} from 'next-intl';
import {toast} from 'sonner';
import {deleteUserAction, type UserView} from '@/server/actions/users';
import {KNOWN_USER_ERRORS} from '@/components/users/errors';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

export interface UserDeleteDialogProps {
  user: UserView;
  trigger: React.ReactElement;
  onDone: () => void;
}

export function UserDeleteDialog({user, trigger, onDone}: UserDeleteDialogProps) {
  const t = useTranslations('users');
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [pending, start] = useTransition();

  const errText = (code: string) => (KNOWN_USER_ERRORS.has(code) ? t(`err.${code}`) : code);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setConfirm('');
  }

  function onConfirm() {
    const fd = new FormData();
    fd.set('id', user.id);
    fd.set('confirm', confirm);
    start(async () => {
      const res = await deleteUserAction(fd);
      if (res.ok) {
        toast.success(t('deletedToast'));
        setOpen(false);
        onDone();
      } else {
        toast.error(errText(res.error));
      }
    });
  }

  const canConfirm = confirm.trim().toLowerCase() === user.email.toLowerCase();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={trigger} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('deleteTitle')}</DialogTitle>
          <DialogDescription>
            <strong>{user.email}</strong>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="ud-confirm">{t('confirmDeleteLabel')}</Label>
          <Input
            id="ud-confirm"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="off"
            placeholder={user.email}
          />
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            {t('cancel')}
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={!canConfirm || pending}>
            {t('delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
