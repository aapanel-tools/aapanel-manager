'use client';

import {ThemeProvider as NextThemesProvider} from 'next-themes';
import type {ComponentProps} from 'react';

/** Thin client wrapper around next-themes so the root layout (a Server Component) can mount it. */
export function ThemeProvider(props: ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props} />;
}
