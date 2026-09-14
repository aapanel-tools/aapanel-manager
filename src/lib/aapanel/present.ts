import 'server-only';
import {getTranslations} from 'next-intl/server';
import type {ActionErrorCode} from '@/components/use-action-error';
import {AuditUnavailableError} from '@/lib/audit';
import {ServerNotFoundError} from '@/lib/servers/creds';
import {failurePhrase, withPanelWords, type PhraseTranslator} from './failure-phrase';
import {AaPanelError, describeError} from './types';

/**
 * What an operator is told when something they asked for failed.
 *
 * Two different answers, and which one depends on whose failure it was.
 *
 * **A panel failure** — unreachable, slow, the key or the request refused —
 * becomes a sentence in the reader's own language. It is the twin of
 * describeError(), and the difference between them is *when*, not how well.
 * describeError() produces the technical English sentence that goes into the
 * application log, read later by whoever investigates. A translated string cannot
 * be kept like that: it would freeze in the language of whichever process wrote
 * it (the same reason ADR-0012 stores a kind, not a phrase). This one runs inside
 * a request, where next-intl knows the locale of the person about to read the
 * message, and its result goes straight back to that request. Nothing keeps it.
 *
 * The panel's own words are appended untranslated on purpose. They come from
 * someone else's machine in whatever language that panel speaks, and inventing a
 * translation for them would be inventing content.
 *
 * **Anything else** is the app's own failure — the database, a key that no
 * longer decrypts, a bug — and becomes an action error code (use-action-error.ts)
 * that the browser puts into words. Its message is never passed on (Д-35): for a
 * database failure it is Prisma's text with the query and the paths of the build
 * on the server's disk, which helps no operator and shows the app's insides to
 * anyone looking at the screen. The caller writes the error to the application
 * log, which is where it helps. A code rather than a sentence also keeps the
 * server card honest: it reads a sentence as the panel's refusal ("the server is
 * unavailable"), and blaming a server for the app's own failure sends an
 * operator looking for an outage that is not there.
 */
export async function presentError(err: unknown, serverName?: string): Promise<string> {
  if (!(err instanceof AaPanelError)) return appFailureCode(err);

  let t: PhraseTranslator;
  try {
    t = await getTranslations('panelError');
  } catch {
    // No request to take a locale from — a background job, a test, or any
    // context next-intl does not serve. Fall back to the technical sentence
    // rather than throwing: this function is called from inside catch blocks,
    // and a helper that fails while describing a failure replaces a real error
    // with its own. English beats losing what actually went wrong. Only a panel
    // failure gets this far, so the sentence carries no text of the app's own.
    return describeError(err, serverName);
  }

  const message = withPanelWords(failurePhrase(err.kind, t), err.message, t);

  // The server's name is what makes a message usable on a fleet: "panel
  // presented a different TLS certificate" is alarming and useless when twenty
  // panels are managed and it does not say whose (Д-4).
  return serverName ? t('withServer', {server: serverName, message}) : message;
}

/** The code for a failure of the app's own, by what it was. */
function appFailureCode(err: unknown): ActionErrorCode {
  // Removed between the page loading and the click: nothing broke (Д-34).
  if (err instanceof ServerNotFoundError) return 'notFound';
  // Refused before the panel was touched, because it could not be recorded (Д-19).
  if (err instanceof AuditUnavailableError) return 'auditUnavailable';
  return 'failed';
}
