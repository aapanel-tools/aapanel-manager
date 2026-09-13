/**
 * Paths on someone else's machine, in the only form this app will send them.
 *
 * Pure and shared on purpose. The page reads the address bar with it, the
 * browser builds links with it, and the server action checks the same thing a
 * second time — a server action is a public endpoint, and a link is only a
 * suggestion about what will arrive.
 *
 * These are POSIX paths on the managed server, never paths on the machine the
 * app runs on. `node:path` is deliberately not used: on a Windows development
 * box it would speak the wrong dialect (PROJECT_RULES.md §17).
 */

/** Where the section opens when the address names no directory: aaPanel keeps its sites here. */
export const DEFAULT_BROWSE_PATH = '/www/wwwroot';

/** Linux's PATH_MAX. Nothing longer can name a file on the server, so nothing longer is sent. */
export const MAX_PATH_LENGTH = 4096;

const CONTROL = /[\u0000-\u001f\u007f]/;
const CONTROL_ALL = /[\u0000-\u001f\u007f]/g;

/**
 * A directory or file path as it may be sent to a panel, or null.
 *
 * Refused rather than repaired: anything that is not a string, a relative path,
 * a path longer than Linux allows, and a path carrying control characters —
 * the panel writes what it was asked for into its own log, and a newline there
 * is a forged log line (the same reasoning as normalizeSearch).
 *
 * `..` is refused, not resolved. Resolving it would be harmless in itself — the
 * key is root either way — but it would make the path on screen and the path
 * read on the server two different strings, and the screen is what an operator
 * trusts when deciding what they are looking at.
 *
 * Repeated slashes and `.` segments are folded away, and a trailing slash is
 * dropped, so that one directory has one address.
 */
export function normalizeBrowsePath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  if (raw.length === 0 || raw.length > MAX_PATH_LENGTH) return null;
  if (CONTROL.test(raw) || !raw.startsWith('/')) return null;

  const segments: string[] = [];
  for (const part of raw.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') return null;
    segments.push(part);
  }
  return `/${segments.join('/')}`;
}

/**
 * Whether a name from a directory listing can be used to build a path.
 *
 * The panel's answer is untrusted data (§16). A name holding a slash, or one
 * that is `.` or `..`, would make joinPath() point somewhere other than the row
 * the operator clicked. A name with a control character is a real possibility —
 * Linux allows a newline in a file name — and cannot be sent back to the panel
 * under the rule normalizeBrowsePath() enforces.
 */
export function isEntryName(name: string): boolean {
  return name !== '' && name !== '.' && name !== '..' && !name.includes('/') && !CONTROL.test(name);
}

/**
 * The path of an entry inside a directory, or null when the name cannot be one.
 *
 * Null is not a reason to hide the row. A file whose name cannot be clicked is
 * still a file on a client's server, and a console that quietly leaves it out
 * of the listing is a good place to hide something. Callers show the row and
 * withhold the link.
 */
export function joinPath(dir: string, name: string): string | null {
  if (!isEntryName(name)) return null;
  const joined = dir === '/' ? `/${name}` : `${dir}/${name}`;
  return joined.length > MAX_PATH_LENGTH ? null : joined;
}

/** The directory above, or null at the root. Expects a path from normalizeBrowsePath(). */
export function parentPath(path: string): string | null {
  if (path === '/') return null;
  const cut = path.lastIndexOf('/');
  return cut <= 0 ? '/' : path.slice(0, cut);
}

/** Each step from the root down to `path`, for breadcrumbs. The root is named "/". */
export function pathCrumbs(path: string): Array<{name: string; path: string}> {
  const crumbs = [{name: '/', path: '/'}];
  let current = '';
  for (const segment of path.split('/')) {
    if (!segment) continue;
    current += `/${segment}`;
    crumbs.push({name: segment, path: current});
  }
  return crumbs;
}

/**
 * A name as it can be shown, with control characters made visible.
 *
 * React escapes markup but not a newline or a terminal escape sequence, and a
 * file called `index.php\n` would otherwise look exactly like `index.php`.
 */
export function printableName(name: string): string {
  return name.replace(
    CONTROL_ALL,
    (ch) => `\\x${ch.charCodeAt(0).toString(16).padStart(2, '0')}`,
  );
}
