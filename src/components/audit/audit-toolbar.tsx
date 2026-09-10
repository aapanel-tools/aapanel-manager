'use client';
import {useCallback, useEffect, useRef, useState, useTransition} from 'react';
import {usePathname, useRouter, useSearchParams} from 'next/navigation';
import {useTranslations} from 'next-intl';
import type {AuditListParams} from '@/lib/validation/audit';
import {Input} from '@/components/ui/input';

// 'started' overlaps 'error' on purpose — see the schema. Labels come from
// t(r), a dynamic key, which messages.test.ts skips by design: a new option
// here has to be checked in the browser, not by the gate.
const RESULTS = ['all', 'ok', 'error', 'started'] as const;
const SELECT_CLASS = 'h-9 rounded-md border bg-background px-2 text-sm';

export interface AuditToolbarProps {
  params: AuditListParams;
  servers: Array<{id: string; name: string}>;
  users: Array<{id: string; email: string}>;
}

/** Date input wants YYYY-MM-DD; the parsed param is a Date. */
function asInputDate(value: Date | undefined): string {
  return value ? value.toISOString().slice(0, 10) : '';
}

export function AuditToolbar({params, servers, users}: AuditToolbarProps) {
  const t = useTranslations('audit');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
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

  // Debounce the search box into the URL (reset to page 1). Skip first render,
  // otherwise mounting would immediately push the current value back.
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

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t('search')}
        className="h-9 w-full max-w-xs"
      />

      <select
        className={SELECT_CLASS}
        value={params.serverId ?? ''}
        onChange={(e) => push({serverId: e.target.value || undefined, page: 1})}
        aria-label={t('filterServer')}
      >
        <option value="">{t('allServers')}</option>
        {servers.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>

      <select
        className={SELECT_CLASS}
        value={params.userId ?? ''}
        onChange={(e) => push({userId: e.target.value || undefined, page: 1})}
        aria-label={t('filterUser')}
      >
        <option value="">{t('allUsers')}</option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.email}
          </option>
        ))}
      </select>

      <select
        className={SELECT_CLASS}
        value={params.result}
        onChange={(e) => push({result: e.target.value === 'all' ? undefined : e.target.value, page: 1})}
        aria-label={t('filterResult')}
      >
        {RESULTS.map((r) => (
          <option key={r} value={r}>
            {t(r)}
          </option>
        ))}
      </select>

      <input
        type="date"
        className={SELECT_CLASS}
        value={asInputDate(params.from)}
        onChange={(e) => push({from: e.target.value || undefined, page: 1})}
        aria-label={t('from')}
      />
      <input
        type="date"
        className={SELECT_CLASS}
        value={asInputDate(params.to)}
        onChange={(e) => push({to: e.target.value || undefined, page: 1})}
        aria-label={t('to')}
      />
    </div>
  );
}
