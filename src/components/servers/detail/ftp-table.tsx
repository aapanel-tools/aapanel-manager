'use client';

import {useTranslations} from 'next-intl';
import {Plus, RefreshCw} from 'lucide-react';
import type {FtpListResult} from '@/server/actions/ftp';
import {listFtpUsersAction} from '@/server/actions/ftp';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {ListIntegrityNotice} from '@/components/servers/detail/list-integrity-notice';
import {ListSearch} from '@/components/servers/detail/list-search';
import {useSearchableList} from '@/components/servers/detail/use-searchable-list';
import {FtpFormDialog} from '@/components/servers/detail/ftp-form-dialog';
import {FtpUserDialog} from '@/components/servers/detail/ftp-user-dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export interface FtpTableProps {
  id: string;
  initial: FtpListResult;
  isAdmin: boolean;
}

/**
 * The FTP accounts on one server.
 *
 * No password column, and no way to reveal one. The panel returns every
 * account's password in clear text with this very list; the app drops it at the
 * client and has nowhere to put it (§16). What is shown is what an operator
 * needs to decide something: who exists, where they land, and whether the
 * account is switched on.
 */
export function FtpTable({id, initial, isAdmin}: FtpTableProps) {
  const t = useTranslations('ftp');
  const {result, search, setSearch, applied, pending, reload} = useSearchableList<FtpListResult>(
    initial,
    (term) => listFtpUsersAction(id, term),
  );

  const header = (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-base font-semibold">{t('title')}</h2>
      <div className="flex items-center gap-2">
        <ListSearch
          value={search}
          onChange={setSearch}
          placeholder={t('searchPlaceholder')}
          busy={pending}
        />
        <Button variant="outline" size="sm" disabled={pending} onClick={() => void reload()}>
          <RefreshCw className="mr-1 h-3.5 w-3.5" />
          {t('refresh')}
        </Button>
        {isAdmin && (
          <FtpFormDialog
            id={id}
            onDone={() => void reload()}
            trigger={
              <Button size="sm">
                <Plus className="mr-1 h-3.5 w-3.5" />
                {t('add')}
              </Button>
            }
          />
        )}
      </div>
    </div>
  );

  if (!result.ok) {
    return (
      <div>
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

  // A short list of accounts that looks complete is how an operator concludes
  // an account was removed when the panel simply refused to answer (ADR-0003).
  const partial = (
    <ListIntegrityNotice
      failures={result.failures}
      truncations={result.truncations}
      labelSource={() => t('title')}
    />
  );

  if (result.users.length === 0) {
    return (
      <div>
        {header}
        {partial}
        {result.failures.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {applied ? t('noMatches', {query: applied}) : t('noUsers')}
          </p>
        )}
      </div>
    );
  }

  return (
    <div>
      {header}
      {partial}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('username')}</TableHead>
            <TableHead>{t('path')}</TableHead>
            <TableHead>{t('note')}</TableHead>
            <TableHead>{t('created')}</TableHead>
            <TableHead>{t('status')}</TableHead>
            <TableHead className="w-0" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.users.map((user) => (
            <TableRow key={user.id}>
              <TableCell className="font-medium">{user.name}</TableCell>
              <TableCell className="max-w-[20rem] truncate font-mono text-xs" title={user.path}>
                {user.path || '—'}
              </TableCell>
              <TableCell className="max-w-[14rem] truncate" title={user.note}>
                {user.note || '—'}
              </TableCell>
              <TableCell className="tabular-nums text-xs">{user.addtime || '—'}</TableCell>
              <TableCell>
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
              </TableCell>
              <TableCell className="text-right">
                <FtpUserDialog
                  id={id}
                  user={user}
                  isAdmin={isAdmin}
                  onDone={() => void reload()}
                  trigger={
                    <Button variant="ghost" size="sm">
                      {t('details')}
                    </Button>
                  }
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
