/**
 * What a schema says when a field is wrong — as a key, never as a sentence.
 *
 * The schemas run in two places with different needs. On the server there is no
 * locale: an action validates a form long before anyone knows who is reading
 * the answer, and a message written in English there arrives in a Russian
 * interface as English (Д-24). In the browser there is a locale, and that is
 * where the sentence belongs. So the schema names the problem and the browser
 * says it — the same split describeError() and presentError() draw for panel
 * failures, and useActionError() draws for an action's own refusals.
 *
 * Keys carry no numbers on purpose. "At least 12 characters" belongs under the
 * field as a hint that is visible before anyone types, not in an error that
 * appears after; keeping the limit out of the key also keeps two places from
 * disagreeing about it.
 *
 * Anything a schema does not name explicitly — zod's own wording for a missing
 * value, a bad email, a string that is too long — falls through to `invalid`,
 * which is generic but translated. That is the floor: no English reaches an
 * operator, whether or not anyone remembered to annotate a constraint.
 */
export const FIELD = {
  /** Left empty, and the field is required. */
  required: 'required',
  /** Longer than the field allows. */
  tooLong: 'tooLong',
  /** Letters, digits, dot, dash, underscore — names the system will accept. */
  nameCharset: 'nameCharset',
  /** Letters, digits and underscore only — database identifiers. */
  identifierCharset: 'identifierCharset',
  /** A key from package.json's scripts. */
  scriptKey: 'scriptKey',
  /** A Node.js version label, e.g. v24.13.0. */
  nodeVersion: 'nodeVersion',
  /** Must start with "/" — the panel resolves anything else against its own cwd. */
  absolutePath: 'absolutePath',
  /** Must not climb out of its tree with "..". */
  noParentDir: 'noParentDir',
  /** Must be an http(s) address. */
  httpUrl: 'httpUrl',
  /** Not a valid address at all. */
  invalidUrl: 'invalidUrl',
  /** Not a valid email address. */
  invalidEmail: 'invalidEmail',
  /** Shorter than a password reachable from the internet should be. */
  passwordShort: 'passwordShort',
  /** An api_sk that short is almost certainly a paste that went wrong. */
  apiSkShort: 'apiSkShort',
  /** A SHA-256 fingerprint is 64 hex digits. */
  fingerprintLength: 'fingerprintLength',
  /** The new password repeats the current one. */
  passwordSame: 'passwordSame',
  /** The typed confirmation does not match the name it must match. */
  confirmName: 'confirmName',
  /** Outside the range of TCP ports. */
  portRange: 'portRange',
  /** Anything else: wrong, without a more specific word for it. */
  invalid: 'invalid',
} as const;

export type FieldMessage = (typeof FIELD)[keyof typeof FIELD];

const KEYS: ReadonlySet<string> = new Set(Object.values(FIELD));

/**
 * Is this string one of the keys above?
 *
 * Pure, so both the browser dictionary and the test that guards the whole class
 * can ask without rendering anything.
 */
export function isFieldMessage(raw: unknown): raw is FieldMessage {
  return typeof raw === 'string' && KEYS.has(raw);
}
