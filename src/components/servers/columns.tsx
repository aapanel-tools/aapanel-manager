'use client';
import Link from 'next/link';
import type {Route} from 'next';
import type {ColumnDef} from '@tanstack/react-table';
import type {ServerRow} from '@/lib/servers/query';
import {StatusBadge} from './status-badge';
import {cpuText, percentText} from './metric-text';

/** `t` is passed in from the table so headers are translated without a hook here. */
export function buildColumns(t: (key: string) => string): ColumnDef<ServerRow>[] {
  return [
    {accessorKey: 'name', header: t('name'), enableSorting: true, enableHiding: false, size: 200,
      cell: ({row}) => (
        <Link href={`/servers/${row.original.id}` as Route} className="font-medium text-primary hover:underline">
          {row.original.name}
        </Link>
      )},
    {accessorKey: 'tag', header: t('tag'), enableSorting: true, size: 120,
      cell: ({row}) => row.original.tag ?? '—'},
    {id: 'status', header: t('status'), enableSorting: false, size: 110,
      cell: ({row}) => <StatusBadge online={row.original.online} />},
    {accessorKey: 'cpu', header: t('cpu'), enableSorting: true, size: 90,
      cell: ({row}) => cpuText(row.original.cpu)},
    {accessorKey: 'mem', header: t('mem'), enableSorting: true, size: 90,
      cell: ({row}) => percentText(row.original.mem)},
    {accessorKey: 'disk', header: t('disk'), enableSorting: true, size: 90,
      cell: ({row}) => percentText(row.original.disk)},
    {accessorKey: 'baseUrl', header: t('baseUrl'), enableSorting: false, size: 240},
    {id: 'lastCheckedAt', accessorKey: 'lastCheckedAt', header: t('lastChecked'), enableSorting: true, size: 170,
      cell: ({row}) => (row.original.lastCheckedAt ? new Date(row.original.lastCheckedAt).toLocaleString() : t('never'))},
  ];
}
