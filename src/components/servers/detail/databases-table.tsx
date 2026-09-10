'use client';

import {useState} from 'react';
import {useTranslations} from 'next-intl';
import {RefreshCw, Trash2, PlusCircle} from 'lucide-react';
import type {DbListResult} from '@/server/actions/databases';
import {listDatabasesAction} from '@/server/actions/databases';
import type {Database, DbEngine} from '@/lib/aapanel';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {ListIntegrityNotice} from '@/components/servers/detail/list-integrity-notice';
import {ListSearch} from '@/components/servers/detail/list-search';
import {useSearchableList} from '@/components/servers/detail/use-searchable-list';
import {DatabaseFormDialog} from '@/components/servers/detail/database-form-dialog';
import {DatabaseDeleteDialog} from '@/components/servers/detail/database-delete-dialog';

export interface DatabasesTableProps {
  id: string;
  initial: DbListResult;
  isAdmin: boolean;
}

type EngineFilter = 'all' | DbEngine;

export function DatabasesTable({id, initial, isAdmin}: DatabasesTableProps) {
  const t = useTranslations('databases');
  // Search goes to both engines through the action; the engine filter below
  // stays in the browser. They answer different questions: one narrows what
  // the panel looks through, the other hides half of what it returned.
  const {result, search, setSearch, applied, pending, reload} = useSearchableList<DbListResult>(
    initial,
    (term) => listDatabasesAction(id, term),
  );
  const [engineFilter, setEngineFilter] = useState<EngineFilter>('all');

  const refetch = () => void reload();

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
      <h2 className="text-base font-semibold">{t('title')}</h2>
      <div className="flex items-center gap-2">
        <ListSearch
          value={search}
          onChange={setSearch}
          placeholder={t('searchPlaceholder')}
          busy={pending}
        />
        <select
          value={engineFilter}
          onChange={(e) => setEngineFilter(e.target.value as EngineFilter)}
          className="h-8 rounded-md border border-input bg-background px-2 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
          aria-label={t('filterEngine')}
        >
          <option value="all">{t('all')}</option>
          <option value="mysql">{t('mysql')}</option>
          <option value="pgsql">{t('pgsql')}</option>
        </select>
        <Button variant="outline" size="sm" disabled={pending} onClick={refetch}>
          <RefreshCw className="mr-1 h-3.5 w-3.5" />
          {t('refresh')}
        </Button>
        {isAdmin && (
          <DatabaseFormDialog
            id={id}
            trigger={
              <Button size="sm">
                <PlusCircle className="mr-1 h-3.5 w-3.5" />
                {t('add')}
              </Button>
            }
            onDone={refetch}
          />
        )}
      </div>
    </div>
  );

  // An engine that did not answer must be visible: a shorter list looks complete,
  // and "no databases" then means the same as "MySQL is down" (ADR-0003).
  const engineLabel = (source: string): string =>
    source === 'mysql' || source === 'pgsql' ? t(source) : source;

  const partial = result.ok ? (
    <ListIntegrityNotice
      failures={result.failures}
      truncations={result.truncations}
      labelSource={engineLabel}
    />
  ) : null;

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

  /**
   * Why the table is empty — three different statements, not interchangeable.
   *
   * Rows exist but none survived the engine filter: that is about the filter,
   * and saying "no databases found" would send an operator looking for a
   * problem on the server. A search is running: that is about the term, and it
   * names the one the rows were fetched with rather than the one being typed.
   * Neither: the server really has none.
   */
  const emptyReason = (): string => {
    if (result.ok && result.databases.length > 0 && engineFilter !== 'all') {
      return t('noneForEngine', {engine: t(engineFilter)});
    }
    return applied ? t('noMatches', {query: applied}) : t('noDatabases');
  };

  const filtered: Database[] =
    engineFilter === 'all'
      ? result.databases
      : result.databases.filter((db) => db.engine === engineFilter);

  if (filtered.length === 0) {
    return (
      <div>
        {header}
        {partial}
        {/* Same reasoning as the sites table: with an engine still owing an
            answer, "no databases" states as fact what the app does not know.
            And with a search running, the honest sentence is about the term,
            not about the server. */}
        {result.failures.length === 0 && (
          <p className="text-sm text-muted-foreground">{emptyReason()}</p>
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
            <TableHead>{t('name')}</TableHead>
            <TableHead>{t('engine')}</TableHead>
            <TableHead>{t('user')}</TableHead>
            <TableHead>{t('access')}</TableHead>
            <TableHead>{t('note')}</TableHead>
            <TableHead>{t('addtime')}</TableHead>
            {isAdmin && <TableHead>{t('actions')}</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((db) => (
            <TableRow key={`${db.engine}-${db.id}`}>
              <TableCell className="font-medium">{db.name}</TableCell>
              <TableCell>
                <Badge
                  variant="secondary"
                  className={
                    db.engine === 'mysql'
                      ? 'bg-orange-500/15 text-orange-700 dark:text-orange-400 border-0'
                      : 'bg-blue-500/15 text-blue-700 dark:text-blue-400 border-0'
                  }
                >
                  {t(db.engine)}
                </Badge>
              </TableCell>
              <TableCell>{db.username}</TableCell>
              <TableCell>{db.access || '—'}</TableCell>
              <TableCell>{db.note || '—'}</TableCell>
              <TableCell>{db.addtime}</TableCell>
              {isAdmin && (
                <TableCell>
                  <div className="flex items-center gap-1">
                    <DatabaseDeleteDialog
                      id={id}
                      database={db}
                      trigger={
                        <Button variant="ghost" size="sm" aria-label={t('delete')}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      }
                      onDone={refetch}
                    />
                  </div>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
