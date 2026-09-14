import type {FailureKind} from './types';

/** What next-intl hands back, narrowed to what these helpers ask of it. */
export type PhraseTranslator = (key: string, values?: Record<string, string>) => string;

const KINDS: ReadonlySet<string> = new Set<FailureKind>([
  'network',
  'timeout',
  'auth',
  'panel_error',
  'tls_pin_mismatch',
  'unknown',
]);

/**
 * A kind read back from storage, as one this build can put into words.
 *
 * `ServerStatus.errorKind` is a plain string on purpose (ADR-0012): a kind added
 * to the code later must not need a migration, and a status write must never
 * fail over one. The price is that the column can hold a value this build does
 * not know — written by a newer build before a rollback, say — and that value
 * reads as the app's own failure rather than reaching an operator as a missing
 * translation.
 */
export function asFailureKind(raw: unknown): FailureKind {
  return typeof raw === 'string' && KINDS.has(raw) ? (raw as FailureKind) : 'unknown';
}

/**
 * The frame: what kind of failure this is, in one phrase.
 *
 * One copy for the three places that say it — presentError() on the server, the
 * notice under an incomplete list, and the fleet summary — because three copies
 * of the same six sentences drift.
 *
 * Written as a switch over literal keys rather than `t(kind)`. messages.test.ts
 * cannot see keys called through a parameter at all, so failure-phrase.test.ts
 * checks every kind against the real catalogues instead; the literal keys keep
 * that check honest about which strings exist.
 */
export function failurePhrase(kind: FailureKind, t: PhraseTranslator): string {
  switch (kind) {
    case 'network':
      return t('network');
    case 'timeout':
      return t('timeout');
    case 'auth':
      return t('auth');
    case 'panel_error':
      return t('panel_error');
    case 'tls_pin_mismatch':
      return t('tls_pin_mismatch');
    case 'unknown':
      return t('unknown');
    default:
      return unworded(kind, t);
  }
}

/**
 * The phrase with the failure's own words beside it, when they add anything.
 *
 * The words are the panel's, from someone else's machine in whatever language it
 * speaks, and stay untranslated: inventing a translation for them would be
 * inventing content. Dropped when they only repeat the phrase, so nobody is shown
 * one sentence twice.
 */
export function withPanelWords(
  phrase: string,
  words: string | null | undefined,
  t: PhraseTranslator,
): string {
  return words && words !== phrase ? t('withDetail', {message: phrase, detail: words}) : phrase;
}

/**
 * A kind with no case above: a type error at the call site, and the app's-own
 * phrase should a value ever get past the type at runtime.
 */
function unworded(_kind: never, t: PhraseTranslator): string {
  return t('unknown');
}
