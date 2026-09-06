'use client';
import {useCallback, useEffect, useRef, useState, useTransition} from 'react';
import {usePathname, useRouter, useSearchParams} from 'next/navigation';
import {useTranslations} from 'next-intl';
import {toast} from 'sonner';
import {Layers, Plus, RefreshCw} from 'lucide-react';
import type {ServerListParams} from '@/lib/validation/server';
import {refreshVisibleStatusesAction} from '@/server/actions/servers';
import {BulkProjectDialog} from '@/components/jobs/bulk-project-dialog';
import {ServerFormDialog} from './server-form-dialog';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';

const STATUSES = ['all', 'online', 'offline', 'unknown'] as const;

export interface ServersToolbarProps {
  params: ServerListParams;
  isAdmin: boolean;
  /** Servers on the page in view — refreshed together, and the pool a bulk
   *  operation may act on. */
  visible: Array<{id: string; name: string}>;
}

export function ServersToolbar({params, isAdmin, visible}: ServersToolbarProps) {
  const visibleIds = visible.map((s) => s.id);
  const t = useTranslations('servers');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [q, setQ] = useState(params.q ?? '');

  const push = useCallback(
    (updates: Record<string, string | number | undefined>) => {
      const sp = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(updates)) {
        if (v === undefined || v === '') sp.delete(k);
        else sp.set(k, String(v));
      }
      startTransition(() => router.push(`${pathname}?${sp.toString()}` as never));
    },
    [router, pathname, searchParams],
  );

  // Debounce the search box into the URL (reset to page 1). Skip first render.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const id = setTimeout(() => push({q: q.trim() || undefined, page: 1}), 300);
    return () => clearTimeout(id);
    // push is stable via useCallback; intentionally only depend on q
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  function onRefreshVisible() {
    if (visibleIds.length === 0) return;
    startTransition(async () => {
      const res = await refreshVisibleStatusesAction(visibleIds);
      if (res.ok) toast.success(t('refreshedN', {n: res.refreshed, failed: res.failed}));
      else toast.error(t('refreshFailed'));
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t('search')}
        className="h-9 w-full max-w-xs"
      />
      <select
        className="h-9 rounded-md border bg-background px-2 text-sm"
        value={params.status}
        onChange={(e) => push({status: e.target.value === 'all' ? undefined : e.target.value, page: 1})}
        aria-label={t('filterStatus')}
      >
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {s === 'all' ? t('all') : t(s)}
          </option>
        ))}
      </select>
      <div className="ml-auto flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={isPending || visibleIds.length === 0}
          onClick={onRefreshVisible}
        >
          <RefreshCw className="mr-2 size-4" />
          {t('refreshVisible')}
        </Button>
        {isAdmin && visible.length > 0 ? (
          <BulkProjectDialog
            servers={visible}
            trigger={
              <Button variant="outline" size="sm">
                <Layers className="mr-2 size-4" />
                {t('bulk')}
              </Button>
            }
          />
        ) : null}
        {isAdmin ? (
          <ServerFormDialog
            mode="create"
            trigger={
              <Button size="sm">
                <Plus className="mr-2 size-4" />
                {t('add')}
              </Button>
            }
          />
        ) : null}
      </div>
    </div>
  );
}
