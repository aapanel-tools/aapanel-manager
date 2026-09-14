import {readFileSync, readdirSync, statSync} from 'node:fs';
import {basename, join, relative} from 'node:path';
import {describe, it, expect} from 'vitest';

/**
 * Guards the source against characters nobody can see.
 *
 * A control character, a zero-width space or a replacement character written
 * straight into a file behaves exactly like its escape sequence: a regular
 * expression still matches, a test still passes, the build still succeeds.
 * What changes is everything around the code. Git may decide the file is
 * binary and stop showing its diff, a reviewer reads a string that looks empty,
 * and an editor copy-paste carries the character somewhere it does harm.
 *
 * It happened on 2026-09-13: escape sequences written through an editing tool
 * arrived in eight files as the raw characters they stood for, a NUL among
 * them, and the whole gate stayed green. The only thing that noticed was a
 * mutation script whose anchor text no longer matched.
 *
 * Tab, line feed and carriage return are the only invisible characters allowed.
 * Write every other one as an escape.
 *
 * Deliberately built without an escape sequence of its own: the replacement
 * character is made from its number, and the categories are named rather than
 * spelled out, so that this file cannot be damaged by the thing it looks for.
 */

const ROOTS = ['src', 'messages', 'prisma', 'scripts', 'e2e'];
const EXTENSIONS = /\.(ts|tsx|js|mjs|cjs|json|css|prisma|sql)$/;

/** Control, format, private-use, unassigned and surrogate code points. */
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}\p{Cs}]/u;
const REPLACEMENT = String.fromCodePoint(0xfffd);
const ALLOWED = new Set([0x09, 0x0a, 0x0d]);

/**
 * The names a sync client gives a file it could not reconcile — the two forms
 * seen in this repository: `ru (копия с компьютера <имя>).json` and
 * `probe (2).ts`. Matched against the last segment of a path only.
 */
const SYNC_COPY = [/\(копия с компьютера [^)]*\)/, / \(\d+\)(\.[\w-]+)*$/];

interface Entry {
  path: string;
  isDirectory: boolean;
}

/**
 * Every file and directory under `dir`, dependencies and dot-entries aside.
 * Directories are listed too: a sync client forks those as well.
 */
function entriesUnder(dir: string, out: Entry[] = []): Entry[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const path = join(dir, name);
    const isDirectory = statSync(path).isDirectory();
    out.push({path, isDirectory});
    if (isDirectory) entriesUnder(path, out);
  }
  return out;
}

describe('source text', () => {
  const entries = ROOTS.flatMap((root) => entriesUnder(join(process.cwd(), root)));
  const files = entries.filter((e) => !e.isDirectory && EXTENSIONS.test(e.path)).map((e) => e.path);

  it('scans a meaningful number of files, or the walk has rotted', () => {
    expect(files.length).toBeGreaterThan(150);
  });

  it('holds no character that cannot be seen', () => {
    const found: string[] = [];
    for (const file of files) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, index) => {
        for (const ch of line) {
          const code = ch.codePointAt(0) ?? 0;
          if (ALLOWED.has(code)) continue;
          if (INVISIBLE.test(ch) || ch === REPLACEMENT) {
            const hex = code.toString(16).toUpperCase().padStart(4, '0');
            found.push(`${relative(process.cwd(), file)}:${index + 1} U+${hex}`);
          }
        }
      });
    }
    // Listed rather than counted: the message has to say where to look.
    expect(found).toEqual([]);
  });

  it('knows a sync copy by its name, and a route group is not one', () => {
    const isCopy = (name: string): boolean => SYNC_COPY.some((pattern) => pattern.test(name));
    for (const name of [
      'ru (копия с компьютера HOST).json',
      'src (копия с компьютера HOST)',
      'probe (2).ts',
      'guards (12).test.ts',
      'legacy (3)',
    ]) {
      expect(isCopy(name), name).toBe(true);
    }
    for (const name of ['(app)', '(auth)', '[id]', 'page.tsx', 'ru.json', 'v2 (draft).md', 'page(2).tsx']) {
      expect(isCopy(name), name).toBe(false);
    }
  });

  it('has not been forked by a sync client', () => {
    // 2026-09-13: an edit to messages/ru.json landed in a `(копия с компьютера …)`
    // copy beside it, while ru.json kept the old text. Types, lint and every test
    // passed — the old phrase was as valid as the new one — and only a file
    // missing from `git status` gave it away. The copy is the one visible trace,
    // so its name is what this looks for: under the source roots at any depth,
    // and at the top of the repository, where the build and test configuration
    // live.
    const top = readdirSync(process.cwd()).map((name) => join(process.cwd(), name));
    const forked = [...top, ...entries.map((e) => e.path)]
      .filter((path) => SYNC_COPY.some((pattern) => pattern.test(basename(path))))
      .map((path) => relative(process.cwd(), path));
    expect(forked).toEqual([]);
  });
});
