import 'server-only';
import {getTranslations} from 'next-intl/server';
import {AaPanelError, describeError, type AaPanelErrorKind} from './types';

/**
 * A panel failure in the reader's own language.
 *
 * The twin of describeError(), and the difference between them is *when*, not
 * how well. describeError() produces the technical English sentence that goes
 * into logs and into `ServerStatus.error`, where it is stored and read back
 * later by whoever opens the page. A translated string cannot go there: it
 * would freeze in the language of whichever process happened to write it, and
 * the next operator would read someone else's language out of the database.
 *
 * This one runs inside a request, where next-intl knows the locale of the
 * person who is about to read the message, and its result is returned straight
 * to that request. Nothing keeps it.
 *
 * The panel's own words are appended untranslated on purpose. They come from
 * someone else's machine in whatever language that panel speaks, and inventing
 * a translation for them would be inventing content. The frame around them is
 * ours and is translated; what the panel said stays what the panel said.
 */
export async function presentError(err: unknown, serverName?: string): Promise<string> {
  let t: Translator;
  try {
    t = await getTranslations('panelError');
  } catch {
    // No request to take a locale from — a background job, a test, or any
    // context next-intl does not serve. Fall back to the technical sentence
    // rather than throwing: this function is called from inside catch blocks,
    // and a helper that fails while describing a failure replaces a real error
    // with its own. English beats losing what actually went wrong.
    return describeError(err, serverName);
  }

  const phrase = kindPhrase(err, t);
  const detail = panelWords(err, phrase);
  const message = detail ? t('withDetail', {message: phrase, detail}) : phrase;

  // The server's name is what makes a message usable on a fleet: "panel
  // presented a different TLS certificate" is alarming and useless when twenty
  // panels are managed and it does not say whose (Д-4).
  return serverName ? t('withServer', {server: serverName, message}) : message;
}

/** What next-intl hands back, narrowed to what this module asks of it. */
type Translator = (key: string, values?: Record<string, string>) => string;

/**
 * The frame: what kind of failure this is, in one phrase.
 *
 * Written as a switch over literal keys rather than `t(err.kind)`, which would
 * read better and cost more: messages.test.ts skips dynamic keys on purpose, so
 * a template literal here would put these five strings back outside the gate —
 * exactly the blind spot Д-17 was about.
 */
function kindPhrase(err: unknown, t: Translator): string {
  const kind: AaPanelErrorKind | 'unknown' = err instanceof AaPanelError ? err.kind : 'unknown';
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
    default:
      return t('unknown');
  }
}

/**
 * Whatever the failure itself has to add, beyond its kind.
 *
 * For a panel error that is the panel's own words; for anything else it is the
 * exception's message, which is the only thing that distinguishes one crash
 * from another. Dropped when it merely repeats the phrase, so the operator is
 * not shown the same sentence twice.
 */
function panelWords(err: unknown, phrase: string): string | null {
  const raw = err instanceof Error ? err.message : null;
  if (!raw || raw === phrase) return null;
  return raw;
}
