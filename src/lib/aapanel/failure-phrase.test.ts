import {describe, it, expect} from 'vitest';

import ru from '../../../messages/ru.json';
import en from '../../../messages/en.json';
import {asFailureKind, failurePhrase, withPanelWords, type PhraseTranslator} from './failure-phrase';
import type {FailureKind} from './types';

/**
 * A translator over the real catalogue rather than a stub, so a phrase deleted
 * from it fails here. messages.test.ts cannot see keys called through a
 * parameter, which is how every caller of these helpers asks for them — this is
 * the gate for those keys.
 */
function translator(messages: unknown): PhraseTranslator {
  return (key, values) => {
    const table = (messages as {panelError?: Record<string, unknown>}).panelError ?? {};
    const raw = table[key];
    let out = typeof raw === 'string' ? raw : `MISSING:panelError.${key}`;
    for (const [name, value] of Object.entries(values ?? {})) out = out.replace(`{${name}}`, value);
    return out;
  };
}

const KINDS: FailureKind[] = ['network', 'timeout', 'auth', 'panel_error', 'tls_pin_mismatch', 'unknown'];

describe('failurePhrase', () => {
  it('has a phrase of its own for every kind, in both languages', () => {
    for (const [lang, messages] of [
      ['ru', ru],
      ['en', en],
    ] as const) {
      const t = translator(messages);
      const phrases = KINDS.map((kind) => failurePhrase(kind, t));
      for (const phrase of phrases) expect(phrase, lang).not.toContain('MISSING:');
      // Two kinds sharing a sentence would not tell an operator which one it was.
      expect(new Set(phrases).size, lang).toBe(KINDS.length);
    }
  });

  it('says a failure of the app itself is the app’s, and where its details are', () => {
    // Not "unknown error": that reads as a fault of the server being looked at,
    // and sends an operator looking for an outage that is not there (Д-35).
    expect(failurePhrase('unknown', translator(ru))).toBe(
      'сбой в самом приложении — подробности в журнале приложения',
    );
  });
});

describe('withPanelWords', () => {
  const t = translator(ru);

  it('keeps the panel’s own words beside the phrase, untranslated', () => {
    expect(withPanelWords('панель отказала в запросе', 'IP validation failed', t)).toBe(
      'панель отказала в запросе — IP validation failed',
    );
  });

  it('shows the phrase alone when there are no words, or they only repeat it', () => {
    expect(withPanelWords('панель недоступна', null, t)).toBe('панель недоступна');
    expect(withPanelWords('панель недоступна', undefined, t)).toBe('панель недоступна');
    expect(withPanelWords('панель недоступна', '', t)).toBe('панель недоступна');
    expect(withPanelWords('панель недоступна', 'панель недоступна', t)).toBe('панель недоступна');
  });
});

describe('asFailureKind', () => {
  it('reads back every kind that is written', () => {
    for (const kind of KINDS) expect(asFailureKind(kind)).toBe(kind);
  });

  it('reads anything else as the app’s own failure, not as a missing phrase', () => {
    // A newer build may have written a kind this one does not know (ADR-0012).
    for (const raw of ['solar_flare', '', 'NETWORK', null, undefined, 42]) {
      expect(asFailureKind(raw)).toBe('unknown');
    }
  });
});
