'use client';

import {useSyncExternalStore} from 'react';
import {useTheme} from 'next-themes';
import {useTranslations} from 'next-intl';
import {Sun, Contrast, Moon} from 'lucide-react';
import {cn} from '@/lib/utils';

const OPTIONS = [
  {value: 'light', Icon: Sun},
  {value: 'dim', Icon: Contrast},
  {value: 'dark', Icon: Moon},
] as const;

// "Is this rendering on the client?" without set-state-in-effect: useSyncExternalStore
// returns the server snapshot (false) during SSR and the first hydration render — so it
// matches the server markup — then switches to the client snapshot (true) afterwards.
const subscribe = () => () => {};
function useMounted(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

/**
 * Three-way theme switcher: light / dim (gray) / dark.
 *
 * next-themes resolves the active theme synchronously on the client, so the
 * highlight is gated on `mounted` to keep SSR and hydration markup identical.
 */
export function ThemeToggle() {
  const t = useTranslations('theme');
  const {theme, setTheme} = useTheme();
  const mounted = useMounted();

  return (
    <div role="group" aria-label={t('label')} className="inline-flex items-center rounded-md border p-0.5">
      {OPTIONS.map(({value, Icon}) => {
        const active = mounted && theme === value;
        return (
          <button
            key={value}
            type="button"
            aria-label={t(value)}
            aria-pressed={active}
            title={t(value)}
            onClick={() => setTheme(value)}
            className={cn(
              'inline-flex size-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-foreground',
              active && 'bg-accent text-foreground',
            )}
          >
            <Icon className="size-4" />
          </button>
        );
      })}
    </div>
  );
}
