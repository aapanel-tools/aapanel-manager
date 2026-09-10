import {describe, it, expect, vi} from 'vitest';

import ru from '../../../messages/ru.json';
import en from '../../../messages/en.json';

/**
 * The translator is backed by the real message files rather than by stubs.
 *
 * A double returning "network" for `t('network')` would prove only that the
 * function calls the key it calls. What matters is what an operator ends up
 * reading, so the test asserts the finished Russian and English sentences —
 * which also means a translation deleted from the catalogue fails here too.
 */
const locale = {current: 'ru' as 'ru' | 'en'};

/**
 * Reads one string out of the catalogue without pretending it is flat.
 *
 * Some namespaces hold nested groups (`sites.part.domains`), so the file does
 * not fit `Record<string, Record<string, string>>` and asserting that it does
 * is what a cast would be hiding. Narrowed step by step instead: anything that
 * is not a plain string is simply not a message this double can serve.
 */
function lookup(namespace: string, key: string): string | undefined {
  const messages: unknown = locale.current === 'ru' ? ru : en;
  if (!messages || typeof messages !== 'object') return undefined;
  const table = (messages as Record<string, unknown>)[namespace];
  if (!table || typeof table !== 'object') return undefined;
  const value = (table as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async (namespace: string) => {
    return (key: string, values?: Record<string, string>) => {
      let out = lookup(namespace, key) ?? `MISSING:${namespace}.${key}`;
      for (const [name, value] of Object.entries(values ?? {})) {
        out = out.replace(`{${name}}`, value);
      }
      return out;
    };
  }),
}));

import {getTranslations} from 'next-intl/server';
import {presentError} from './present';
import {AaPanelError} from './types';

describe('presentError', () => {
  it('says what kind of failure it was, in the reader’s language', async () => {
    locale.current = 'ru';
    await expect(presentError(new AaPanelError('timeout', ''))).resolves.toBe(
      'панель не ответила вовремя',
    );

    locale.current = 'en';
    await expect(presentError(new AaPanelError('timeout', ''))).resolves.toBe(
      'panel did not answer in time',
    );
  });

  it('names the server, because a fleet has more than one', async () => {
    // "panel presented a different TLS certificate" is alarming and useless
    // when twenty panels are managed and it does not say whose (Д-4).
    locale.current = 'ru';
    const message = await presentError(new AaPanelError('tls_pin_mismatch', ''), 'prod-web-01');
    expect(message).toBe('prod-web-01: панель предъявила другой сертификат TLS');
  });

  it('keeps the panel’s own words untranslated beside the translated frame', async () => {
    // They arrive from someone else's machine in whatever language it speaks.
    // Inventing a translation for them would be inventing content.
    locale.current = 'ru';
    const err = new AaPanelError('panel_error', 'The specified project does not exist');
    const message = await presentError(err, 'srv');
    expect(message).toBe('srv: панель отказала в запросе — The specified project does not exist');
  });

  it('does not say the same sentence twice', async () => {
    locale.current = 'en';
    const err = new AaPanelError('network', 'panel unreachable');
    await expect(presentError(err)).resolves.toBe('panel unreachable');
  });

  it('handles a failure that is not a panel failure at all', async () => {
    // Everything the app does can also break for ordinary reasons, and the
    // exception's message is then the only thing separating one crash from
    // another — so it is kept, framed as an unknown kind.
    locale.current = 'ru';
    await expect(presentError(new Error('socket hang up'), 'srv')).resolves.toBe(
      'srv: неизвестная ошибка — socket hang up',
    );
  });

  it('never leaves a person with nothing, whatever was thrown', async () => {
    locale.current = 'ru';
    await expect(presentError('boom')).resolves.toBe('неизвестная ошибка');
    await expect(presentError(undefined)).resolves.toBe('неизвестная ошибка');
  });

  it('falls back to the technical sentence when there is no request to translate for', async () => {
    // presentError is called from inside catch blocks. If it threw when
    // next-intl has no request scope — a background context, a test — it would
    // replace whatever actually went wrong with a failure of its own. English
    // is a worse message than Russian; no message at all is far worse than both.
    const failing = vi.mocked(getTranslations);
    failing.mockRejectedValueOnce(new Error('`getTranslations` is not supported here'));

    const err = new AaPanelError('timeout', 'Request to v2/data timed out after 10000ms');
    await expect(presentError(err, 'prod-web-01')).resolves.toBe(
      'prod-web-01: panel did not answer in time — Request to v2/data timed out after 10000ms',
    );
  });

  it('has a phrase for every kind of panel failure, in both languages', async () => {
    // The five kinds are a closed set; a new one added without a translation
    // would reach an operator as MISSING:panelError.<kind>.
    const kinds = ['network', 'timeout', 'auth', 'panel_error', 'tls_pin_mismatch'] as const;
    for (const which of ['ru', 'en'] as const) {
      locale.current = which;
      for (const kind of kinds) {
        const message = await presentError(new AaPanelError(kind, ''));
        expect(message).not.toContain('MISSING:');
        expect(message.length).toBeGreaterThan(0);
      }
    }
  });
});
