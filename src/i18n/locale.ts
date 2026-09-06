import {cookies} from 'next/headers';

export const LOCALES = ['ru', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'ru';
const COOKIE = 'NEXT_LOCALE';

export async function getLocale(): Promise<Locale> {
  const value = (await cookies()).get(COOKIE)?.value;
  return (LOCALES as readonly string[]).includes(value ?? '') ? (value as Locale) : DEFAULT_LOCALE;
}

export async function setLocale(locale: Locale): Promise<void> {
  (await cookies()).set(COOKIE, locale, {path: '/', maxAge: 60 * 60 * 24 * 365});
}
