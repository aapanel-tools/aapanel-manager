'use client';

import {useState, useTransition} from 'react';
import {useTranslations} from 'next-intl';
import {toast} from 'sonner';
import {deleteDatabaseAction} from '@/server/actions/databases';
import type {Database} from '@/lib/aapanel';
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

export interface DatabaseDeleteDialogProps {
  id: string;
  database: Database;
  trigger: React.ReactElement;
  onDone: () => void;
}

export function DatabaseDeleteDialog({id, database, trigger, onDone}: DatabaseDeleteDialogProps) {
  const t = useTranslations('databases');
  const [open, setOpen] = useState(false);
  const [confirmValue, setConfirmValue] = useState('');
  const [pending, start] = useTransition();

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setConfirmValue('');
  }

  function onConfirm() {
    const fd = new FormData();
    fd.set('engine', database.engine);
    fd.set('id', String(database.id));
    fd.set('name', database.name);
    fd.set('confirm', confirmValue);
    start(async () => {
      const res = await deleteDatabaseAction(id, fd);
      if (res.ok) {
        toast.success(t('deleted'));
        setOpen(false);
        onDone();
      } else {
        toast.error(res.error);
      }
    });
  }

  const canConfirm = confirmValue === database.name;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={trigger} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('delete')}</DialogTitle>
          <DialogDescription>
            {database.engine.toUpperCase()} / <strong>{database.name}</strong>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="dbd-confirm">{t('confirmDeleteLabel')}</Label>
          <Input
            id="dbd-confirm"
            value={confirmValue}
            onChange={(e) => setConfirmValue(e.target.value)}
            autoComplete="off"
            placeholder={database.name}
          />
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            {t('cancel')}
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={!canConfirm || pending}
          >
            {t('delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
