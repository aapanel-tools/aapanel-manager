/**
 * Stable error codes the user-management actions return in `error`. The UI maps
 * these to localised messages (`users.err.*`); any other string is shown verbatim
 * (e.g. an unexpected runtime message), so a missing key never crashes rendering.
 */
export const KNOWN_USER_ERRORS = new Set([
  'emailTaken',
  'lastAdmin',
  'cannotDeleteSelf',
  'confirmMismatch',
  'wrongPassword',
  'notFound',
  'forbidden',
]);
