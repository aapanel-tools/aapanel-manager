'use client';

import {useState, useTransition} from 'react';
import {useTranslations} from 'next-intl';
import {toast} from 'sonner';
import {createDatabaseAction} from '@/server/actions/databases';
import type {DbMutResult} from '@/server/actions/databases';
import type {DbEngine} from '@/lib/aapanel';
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

const INITIAL: DbMutResult = {ok: false, error: ''};

export interface DatabaseFormDialogProps {
  id: string;
  trigger: React.ReactElement;
  onDone: () => void;
}

export function DatabaseFormDialog({id, trigger, onDone}: DatabaseFormDialogProps) {
  const t = useTranslations('databases');
  const [open, setOpen] = useState(false);
  const [engine, setEngine] = useState<DbEngine>('mysql');
  const [result, setResult] = useState<DbMutResult>(INITIAL);
  const [pending, startSubmit] = useTransition();

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setResult(INITIAL);
      setEngine('mysql');
    }
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startSubmit(async () => {
      const res = await createDatabaseAction(id, fd);
      setResult(res);
      if (res.ok) {
        toast.success(t('created'));
        setOpen(false);
        onDone();
      } else if (res.error !== 'validation') {
        toast.error(res.error);
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
              {result.error}
            </p>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="dbf-engine">{t('engine')}</Label>
            <select
              id="dbf-engine"
              name="engine"
              value={engine}
              onChange={(e) => setEngine(e.target.value as DbEngine)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
              required
            >
              <option value="mysql">{t('mysql')}</option>
              <option value="pgsql">{t('pgsql')}</option>
            </select>
            {fieldErr('engine') ? (
              <p className="text-xs text-destructive">{fieldErr('engine')}</p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="dbf-name">{t('name')}</Label>
            <Input id="dbf-name" name="name" required autoComplete="off" />
            {fieldErr('name') ? (
              <p className="text-xs text-destructive">{fieldErr('name')}</p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="dbf-user">{t('user')}</Label>
            <Input id="dbf-user" name="user" required autoComplete="off" />
            {fieldErr('user') ? (
              <p className="text-xs text-destructive">{fieldErr('user')}</p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="dbf-password">{t('password')}</Label>
            <Input
              id="dbf-password"
              name="password"
              type="password"
              required
              autoComplete="new-password"
            />
            {fieldErr('password') ? (
              <p className="text-xs text-destructive">{fieldErr('password')}</p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="dbf-access">{t('access')}</Label>
            <Input
              id="dbf-access"
              name="access"
              placeholder="127.0.0.1"
              autoComplete="off"
            />
            {fieldErr('access') ? (
              <p className="text-xs text-destructive">{fieldErr('access')}</p>
            ) : null}
          </div>

          {engine === 'mysql' && (
            <div className="space-y-1.5">
              <Label htmlFor="dbf-charset">{t('charset')}</Label>
              <Input
                id="dbf-charset"
                name="charset"
                placeholder="utf8mb4"
                autoComplete="off"
              />
              {fieldErr('charset') ? (
                <p className="text-xs text-destructive">{fieldErr('charset')}</p>
              ) : null}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="dbf-note">{t('note')}</Label>
            <Input id="dbf-note" name="note" autoComplete="off" />
            {fieldErr('note') ? (
              <p className="text-xs text-destructive">{fieldErr('note')}</p>
            ) : null}
          </div>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => onOpenChange(false)}
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
