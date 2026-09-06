'use client';

import {useState, useTransition} from 'react';
import {useTranslations} from 'next-intl';
import {toast} from 'sonner';
import {deleteProjectAction} from '@/server/actions/projects';
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

export interface ProjectDeleteDialogProps {
  serverId: string;
  projectName: string;
  trigger: React.ReactElement;
  onDone: () => void;
}

/**
 * Deletes a project after a typed-name confirmation. Mirrors the database
 * delete dialog. The panel removes only the project's registration — the
 * on-disk directory is preserved (documented behavior).
 */
export function ProjectDeleteDialog({serverId, projectName, trigger, onDone}: ProjectDeleteDialogProps) {
  const t = useTranslations('projects');
  const [open, setOpen] = useState(false);
  const [confirmValue, setConfirmValue] = useState('');
  const [pending, start] = useTransition();

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setConfirmValue('');
  }

  function onConfirm() {
    const fd = new FormData();
    fd.set('name', projectName);
    fd.set('confirm', confirmValue);
    start(async () => {
      const res = await deleteProjectAction(serverId, fd);
      if (res.ok) {
        toast.success(t('deleted'));
        setOpen(false);
        setConfirmValue('');
        onDone();
      } else {
        toast.error(res.error);
      }
    });
  }

  const canConfirm = confirmValue === projectName;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={trigger} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('delete')}</DialogTitle>
          <DialogDescription>
            <strong>{projectName}</strong>
          </DialogDescription>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">{t('deleteHint')}</p>

        <div className="space-y-1.5">
          <Label htmlFor="pd-confirm">{t('confirmDeleteLabel')}</Label>
          <Input
            id="pd-confirm"
            value={confirmValue}
            onChange={(e) => setConfirmValue(e.target.value)}
            autoComplete="off"
            placeholder={projectName}
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
