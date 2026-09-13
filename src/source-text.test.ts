import {readFileSync, readdirSync, statSync} from 'node:fs';
import {join, relative} from 'node:path';
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

const ROOTS = ['src', 'messages', 'prisma', 'scripts'];
const EXTENSIONS = /\.(ts|tsx|js|mjs|cjs|json|css|prisma|sql)$/;

/** Control, format, private-use, unassigned and surrogate code points. */
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}\p{Cs}]/u;
const REPLACEMENT = String.fromCodePoint(0xfffd);
const ALLOWED = new Set([0x09, 0x0a, 0x0d]);

function sourceFiles(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (EXTENSIONS.test(entry)) out.push(full);
  }
  return out;
}

describe('source text', () => {
  const files = ROOTS.flatMap((root) => sourceFiles(join(process.cwd(), root)));

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
});
