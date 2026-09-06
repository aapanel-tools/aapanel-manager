'use client';

import {useMemo} from 'react';
import {usePathname, useRouter} from 'next/navigation';
import type {Route} from 'next';
import {useTranslations} from 'next-intl';
import {Combobox} from '@base-ui/react/combobox';
import {Check, ChevronsUpDown} from 'lucide-react';
import {cn} from '@/lib/utils';
import type {ServerOption} from '@/lib/servers/query';

export interface ServerSwitcherProps {
  currentId: string;
  servers: ServerOption[];
}

/**
 * Searchable switcher between servers, shown on the server detail pages.
 *
 * Selecting a server navigates to the same sub-section (e.g. .../databases) of
 * the chosen server, falling back to its overview. The current server is marked
 * but not pre-filled into the input, so opening the list shows every server.
 */
export function ServerSwitcher({currentId, servers}: ServerSwitcherProps) {
  const t = useTranslations('detail');
  const router = useRouter();
  const pathname = usePathname();

  // Current sub-section after /servers/<id> (e.g. "databases"); empty = overview.
  const section = useMemo(() => {
    const match = pathname.match(/^\/servers\/[^/]+\/(.+)$/);
    return match ? match[1] : '';
  }, [pathname]);

  function handleValueChange(next: ServerOption | null) {
    if (!next || next.id === currentId) return;
    const target = section ? `/servers/${next.id}/${section}` : `/servers/${next.id}`;
    router.push(target as Route);
  }

  return (
    <Combobox.Root
      items={servers}
      onValueChange={handleValueChange}
      itemToStringLabel={(server: ServerOption) => server.name}
    >
      <div className="relative inline-flex h-9 w-60 max-w-full items-center">
        <Combobox.Input
          placeholder={t('switchServer')}
          aria-label={t('switchServer')}
          className="h-full w-full rounded-md border bg-background pl-3 pr-9 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        />
        <Combobox.Trigger
          aria-label={t('switchServer')}
          className="absolute right-1 inline-flex size-7 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronsUpDown className="size-4" />
        </Combobox.Trigger>
      </div>

      <Combobox.Portal>
        <Combobox.Positioner sideOffset={4} className="isolate z-50 outline-none">
          <Combobox.Popup className="max-h-(--available-height) w-(--anchor-width) origin-(--transform-origin) overflow-y-auto overscroll-contain rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0">
            <Combobox.Empty className="px-2 py-1.5 text-sm text-muted-foreground">
              {t('noServers')}
            </Combobox.Empty>
            <Combobox.List>
              {(server: ServerOption) => (
                <Combobox.Item
                  key={server.id}
                  value={server}
                  className="relative flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                >
                  <span className="flex-1 truncate">{server.name}</span>
                  {server.tag ? (
                    <span className="truncate text-xs text-muted-foreground">{server.tag}</span>
                  ) : null}
                  <Check
                    className={cn('size-3.5 shrink-0', server.id === currentId ? 'opacity-100' : 'opacity-0')}
                  />
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
