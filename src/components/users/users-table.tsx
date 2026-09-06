'use client';

import {useState, useTransition} from 'react';
import {useTranslations} from 'next-intl';
import {ShieldCheck, Eye, Pencil, Trash2, PlusCircle} from 'lucide-react';
import {listUsersAction, type UsersListResult} from '@/server/actions/users';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from '@/components/ui/table';
import {UserFormDialog} from '@/components/users/user-form-dialog';
import {UserEditDialog} from '@/components/users/user-edit-dialog';
import {UserDeleteDialog} from '@/components/users/user-delete-dialog';

/** Deterministic timestamp (no locale/timezone) to avoid SSR/CSR hydration drift. */
function fmt(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ');
}

export function UsersTable({initial}: {initial: UsersListResult}) {
  const t = useTranslations('users');
  const [result, setResult] = useState<UsersListResult>(initial);
  const [, startTransition] = useTransition();

  function refetch() {
    startTransition(async () => {
      setResult(await listUsersAction());
    });
  }

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-base font-semibold">{t('title')}</h2>
      <UserFormDialog
        trigger={
          <Button size="sm">
            <PlusCircle className="mr-1 h-3.5 w-3.5" />
            {t('add')}
          </Button>
        }
        onDone={refetch}
      />
    </div>
  );

  if (!result.ok) {
    return (
      <div className="space-y-3">
        {header}
        <div
          className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
          role="alert"
        >
          <p className="font-medium">{t('loadFailed')}</p>
          <p className="mt-1 text-xs opacity-80">{result.message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {header}
      {result.users.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('noUsers')}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('email')}</TableHead>
              <TableHead>{t('role')}</TableHead>
              <TableHead>{t('createdAt')}</TableHead>
              <TableHead className="text-right">{t('actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.users.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-medium">
                  {u.email}
                  {u.isSelf && (
                    <Badge variant="secondary" className="ml-2 border-0 text-xs">
                      {t('you')}
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  {u.role === 'admin' ? (
                    <Badge className="border-0 bg-violet-500/15 text-violet-700 dark:text-violet-400">
                      <ShieldCheck className="mr-1 h-3.5 w-3.5" />
                      {t('roleAdmin')}
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="border-0">
                      <Eye className="mr-1 h-3.5 w-3.5" />
                      {t('roleViewer')}
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">{fmt(u.createdAt)}</TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1">
                    <UserEditDialog
                      user={u}
                      trigger={
                        <Button variant="ghost" size="sm" aria-label={t('edit')}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      }
                      onDone={refetch}
                    />
                    {!u.isSelf && (
                      <UserDeleteDialog
                        user={u}
                        trigger={
                          <Button variant="ghost" size="sm" aria-label={t('delete')}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        }
                        onDone={refetch}
                      />
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
