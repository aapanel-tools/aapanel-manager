'use client';
import {useState, useTransition} from 'react';
import {useRouter} from 'next/navigation';
import {useTranslations} from 'next-intl';
import {useActionError} from '@/components/use-action-error';
import {toast} from 'sonner';
import {deleteServerAction} from '@/server/actions/servers';
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

export interface DeleteServerDialogProps {
  server: {id: string; name: string};
  trigger: React.ReactElement;
}

/**
 * Removing a server registration, behind the same typed confirmation that
 * removing a database has.
 *
 * The asymmetry it replaces ran the wrong way: deleting one database asked the
 * operator to type its name, while deleting the registration that holds the
 * panel's api_sk and its pinned fingerprint took two clicks. The real guard is
 * on the server — this only stops the mis-click before it travels.
 */
export function DeleteServerDialog({server, trigger}: DeleteServerDialogProps) {
  const t = useTranslations('servers');
  // An action refuses for its own reasons too — wrong role, a form that did
  // not validate — and those arrived as bare English tokens (Д-23).
  const actionError = useActionError();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmValue, setConfirmValue] = useState('');
  const [pending, start] = useTransition();

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setConfirmValue('');
  }

  function onConfirm() {
    const fd = new FormData();
    fd.set('id', server.id);
    fd.set('confirm', confirmValue);
    start(async () => {
      const res = await deleteServerAction(fd);
      if (res.ok) {
        toast.success(t('deleted'));
        setOpen(false);
        router.refresh();
      } else {
        toast.error(actionError(res.message));
      }
    });
  }

  const canConfirm = confirmValue.trim() === server.name;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={trigger} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('delete')}</DialogTitle>
          <DialogDescription>{t('confirmDelete', {name: server.name})}</DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="srvd-confirm">{t('confirmDeleteLabel')}</Label>
          <Input
            id="srvd-confirm"
            value={confirmValue}
            onChange={(e) => setConfirmValue(e.target.value)}
            autoComplete="off"
            placeholder={server.name}
          />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            {t('cancel')}
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={pending || !canConfirm}>
            {t('delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
