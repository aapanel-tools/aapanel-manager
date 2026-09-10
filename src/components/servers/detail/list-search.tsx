'use client';

import {Search, X} from 'lucide-react';
import {useTranslations} from 'next-intl';
import {Input} from '@/components/ui/input';
// Deep path on purpose: the '@/lib/aapanel' barrel is server-only, and this is
// a client component. paging.ts imports nothing but a type, so it bundles.
import {MAX_SEARCH_LENGTH} from '@/lib/aapanel/paging';

export interface ListSearchProps {
  value: string;
  onChange: (value: string) => void;
  /**
   * What this list can be searched by, in the operator's language. Each
   * section names its own field: "by domain" and "by database name" are
   * different promises, and a shared "Search…" would keep both.
   */
  placeholder: string;
  /** True while the answer for what is typed is still on its way. */
  busy?: boolean;
}

/**
 * The search box for a list that is narrowed by the panel, not in the browser.
 *
 * One component for all three sections, for the same reason there is one
 * integrity banner: this box is a promise about where the search happens, and
 * a promise worded three ways is three promises.
 *
 * The length cap is the same constant the server enforces. Repeating it here
 * is not the guard — the guard is on the server, where a browser cannot reach
 * it — it just stops an accidental paste from being silently cut later.
 */
export function ListSearch({value, onChange, placeholder, busy = false}: ListSearchProps) {
  const t = useTranslations('listSearch');

  return (
    <div className="relative">
      <Search
        className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          // Escape clears — the shortcut people already expect from a search
          // box, and the fastest way back to the whole list.
          if (e.key === 'Escape' && value) {
            e.preventDefault();
            onChange('');
          }
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        aria-busy={busy || undefined}
        maxLength={MAX_SEARCH_LENGTH}
        className="w-56 pl-7 pr-7 [&::-webkit-search-cancel-button]:appearance-none"
      />
      {value.length > 0 && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label={t('clear')}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
