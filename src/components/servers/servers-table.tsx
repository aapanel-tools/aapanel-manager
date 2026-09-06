'use client';

import {useCallback, useEffect, useState, useTransition} from 'react';
import {usePathname, useRouter, useSearchParams} from 'next/navigation';
import {useTranslations} from 'next-intl';
import {
  type ColumnDef,
  type ColumnSizingState,
  type PaginationState,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import {toast} from 'sonner';
import {ArrowDown, ArrowUp, ChevronsUpDown, Pencil, RefreshCw, SlidersHorizontal, Trash2} from 'lucide-react';
import type {ServerRow} from '@/lib/servers/query';
import type {ServerListParams} from '@/lib/validation/server';
import {cycleSort, type ServerSortField} from '@/lib/servers/sort';
import {refreshServerStatusAction} from '@/server/actions/servers';
import {buildColumns} from './columns';
import {ServerFormDialog} from './server-form-dialog';
import {DeleteServerDialog} from './delete-server-dialog';
import {Button} from '@/components/ui/button';
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const VIS_KEY = 'servers:cols';
const SIZE_KEY = 'servers:sizes';
const PAGE_SIZES = [10, 25, 50, 100] as const;

export interface ServersTableProps {
  data: ServerRow[];
  total: number;
  params: ServerListParams;
  isAdmin: boolean;
}

export function ServersTable({data, total, params, isAdmin}: ServersTableProps) {
  const t = useTranslations('servers');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // Persisted client-only UI state (hydrate in effect to avoid SSR mismatch).
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  useEffect(() => {
    try {
      const v = localStorage.getItem(VIS_KEY);
      if (v) setColumnVisibility(JSON.parse(v) as VisibilityState);
      const s = localStorage.getItem(SIZE_KEY);
      if (s) setColumnSizing(JSON.parse(s) as ColumnSizingState);
    } catch {
      /* ignore corrupt localStorage */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(VIS_KEY, JSON.stringify(columnVisibility));
    } catch {
      /* quota */
    }
  }, [columnVisibility]);
  useEffect(() => {
    try {
      localStorage.setItem(SIZE_KEY, JSON.stringify(columnSizing));
    } catch {
      /* quota */
    }
  }, [columnSizing]);

  // URL writer — preserves existing params (q/status/tag) and updates the rest.
  const pushParams = useCallback(
    (updates: Record<string, string | number | undefined>) => {
      const sp = new URLSearchParams(searchParams.toString());
      for (const [k, val] of Object.entries(updates)) {
        if (val === undefined || val === '') sp.delete(k);
        else sp.set(k, String(val));
      }
      startTransition(() => router.push(`${pathname}?${sp.toString()}` as never));
    },
    [router, pathname, searchParams],
  );

  // The URL is the single source of truth for sorting/pagination.
  const sorting: SortingState = [{id: params.sort, desc: params.dir === 'desc'}];
  const pagination: PaginationState = {pageIndex: params.page - 1, pageSize: params.pageSize};
  const pageCount = Math.max(1, Math.ceil(total / params.pageSize));

  const onRefreshRow = useCallback(
    (id: string) => {
      startTransition(async () => {
        const res = await refreshServerStatusAction(id);
        if (res.ok) {
          toast.success(t('refreshed'));
          router.refresh();
        } else {
          toast.error(res.message);
        }
      });
    },
    [router, t],
  );

  const columns: ColumnDef<ServerRow>[] = [
    ...buildColumns((k) => t(k)),
    {
      id: 'actions',
      header: '',
      enableSorting: false,
      enableHiding: false,
      enableResizing: false,
      size: 120,
      cell: ({row}) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            aria-label={t('refresh')}
            disabled={isPending}
            onClick={() => onRefreshRow(row.original.id)}
          >
            <RefreshCw className="size-4" />
          </Button>
          {isAdmin ? (
            <>
              <ServerFormDialog
                mode="edit"
                server={row.original}
                trigger={
                  <Button variant="ghost" size="sm" aria-label={t('edit')}>
                    <Pencil className="size-4" />
                  </Button>
                }
              />
              <DeleteServerDialog
                server={{id: row.original.id, name: row.original.name}}
                trigger={
                  <Button variant="ghost" size="sm" aria-label={t('delete')}>
                    <Trash2 className="size-4" />
                  </Button>
                }
              />
            </>
          ) : null}
        </div>
      ),
    },
  ];

  const table = useReactTable<ServerRow>({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    manualPagination: true,
    pageCount,
    columnResizeMode: 'onChange',
    state: {sorting, pagination, columnVisibility, columnSizing},
    onColumnVisibilityChange: setColumnVisibility,
    onColumnSizingChange: setColumnSizing,
    onPaginationChange: (updater) => {
      const next = typeof updater === 'function' ? updater(pagination) : updater;
      pushParams({page: next.pageIndex + 1, pageSize: next.pageSize});
    },
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
            <SlidersHorizontal className="mr-2 size-4" />
            {t('columns')}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {table
              .getAllColumns()
              .filter((c) => c.getCanHide())
              .map((column) => {
                const header = column.columnDef.header;
                const label = typeof header === 'string' && header ? header : column.id;
                return (
                  <DropdownMenuCheckboxItem
                    key={column.id}
                    checked={column.getIsVisible()}
                    onCheckedChange={(value) => column.toggleVisibility(!!value)}
                  >
                    {label}
                  </DropdownMenuCheckboxItem>
                );
              })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <Table style={{width: table.getCenterTotalSize()}}>
          <TableHeader className="sticky top-0 z-10 bg-background">
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();
                  return (
                    <TableHead key={header.id} style={{width: header.getSize()}} className="relative select-none">
                      <button
                        type="button"
                        disabled={!canSort}
                        // Two-state cycle (asc ⇄ desc). `canSort` guarantees the column id is a
                        // sortable field (name/tag/cpu/mem/lastCheckedAt), all in ServerSortField.
                        onClick={
                          canSort
                            ? () =>
                                pushParams({
                                  ...cycleSort(
                                    {sort: params.sort, dir: params.dir},
                                    header.column.id as ServerSortField,
                                  ),
                                  page: 1,
                                })
                            : undefined
                        }
                        className={canSort ? 'flex items-center gap-1' : 'flex cursor-default items-center gap-1'}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {canSort ? (
                          sorted === 'asc' ? (
                            <ArrowUp className="size-3" />
                          ) : sorted === 'desc' ? (
                            <ArrowDown className="size-3" />
                          ) : (
                            <ChevronsUpDown className="size-3 opacity-50" />
                          )
                        ) : null}
                      </button>
                      {header.column.getCanResize() ? (
                        <span
                          onMouseDown={header.getResizeHandler()}
                          onTouchStart={header.getResizeHandler()}
                          className="absolute right-0 top-0 h-full w-1 cursor-col-resize touch-none select-none hover:bg-border"
                          aria-hidden
                        />
                      ) : null}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody className={isPending ? 'opacity-60 transition-opacity' : undefined}>
            {table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.original.id}
                className="duration-200 animate-in fade-in-0 slide-in-from-bottom-1 motion-reduce:animate-none"
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} style={{width: cell.column.getSize()}} className="truncate">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {t('page')} {params.page} {t('of')} {pageCount} · {total}
        </p>
        <div className="flex items-center gap-2">
          <select
            className="h-8 rounded-md border bg-background px-2 text-sm"
            value={params.pageSize}
            onChange={(e) => pushParams({pageSize: Number(e.target.value), page: 1})}
            aria-label={t('perPage')}
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <Button variant="outline" size="sm" disabled={params.page <= 1 || isPending} onClick={() => pushParams({page: params.page - 1})}>
            {t('prev')}
          </Button>
          <Button variant="outline" size="sm" disabled={params.page >= pageCount || isPending} onClick={() => pushParams({page: params.page + 1})}>
            {t('next')}
          </Button>
        </div>
      </div>
    </div>
  );
}
