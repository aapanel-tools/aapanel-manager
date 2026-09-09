import {readFileSync, readdirSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {describe, it, expect} from 'vitest';

import en from '../../messages/en.json';
import ru from '../../messages/ru.json';

/**
 * Guards the one kind of defect the rest of the gate cannot see.
 *
 * A missing translation key type-checks, lints, passes every test and builds
 * cleanly. It fails in the browser, at runtime, as `MISSING_MESSAGE` — and only
 * on the screen that uses it. `servers.bulk` lived in the code for weeks that
 * way: its button shows only to an admin who has at least one server, so nobody
 * hit it until the app was opened with a server registered.
 *
 * The check is deliberately dumb. It reads the source as text and matches
 * `useTranslations('ns')` against `t('key')`, because anything cleverer means
 * running the app, and the point is to catch this without doing so. Dynamic
 * keys — `t(`part.${x}`)` — are skipped rather than guessed at: a false alarm
 * here would train people to ignore the test, which costs more than the misses.
 */

const SRC = join(process.cwd(), 'src');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Every `namespace.key` a source file asks next-intl for, by plain literal. */
function usedKeys(source: string): string[] {
  // `const t = useTranslations('servers')` — several per file is normal.
  const scopes = new Map<string, string>();
  const declaration = /const\s+(\w+)\s*=\s*useTranslations\(\s*['"]([\w.]+)['"]\s*\)/g;
  for (const m of source.matchAll(declaration)) scopes.set(m[1], m[2]);
  if (scopes.size === 0) return [];

  const used: string[] = [];
  for (const [binding, namespace] of scopes) {
    // t('key') and t.rich('key', …); a template literal is a dynamic key and
    // is left alone on purpose.
    const call = new RegExp(`\\b${binding}(?:\\.rich)?\\(\\s*'([\\w.]+)'`, 'g');
    for (const m of source.matchAll(call)) used.push(`${namespace}.${m[1]}`);
  }
  return used;
}

function has(messages: unknown, path: string): boolean {
  return path.split('.').reduce<unknown>((node, part) => {
    if (node && typeof node === 'object' && part in node) {
      return (node as Record<string, unknown>)[part];
    }
    return undefined;
  }, messages) !== undefined;
}

function flatten(messages: unknown, prefix = ''): string[] {
  if (!messages || typeof messages !== 'object') return [prefix];
  return Object.entries(messages).flatMap(([key, value]) =>
    value && typeof value === 'object' ? flatten(value, `${prefix}${key}.`) : [`${prefix}${key}`],
  );
}

describe('translations', () => {
  const files = sourceFiles(SRC);

  it('scans a meaningful number of files, or the regex has rotted', () => {
    // Without this, a change to how translations are imported would turn the
    // whole test green by finding nothing to check.
    const withTranslations = files.filter((f) => usedKeys(readFileSync(f, 'utf8')).length > 0);
    expect(withTranslations.length).toBeGreaterThan(10);
  });

  it('has every key the interface asks for, in both languages', () => {
    const missing: string[] = [];
    for (const file of files) {
      for (const key of usedKeys(readFileSync(file, 'utf8'))) {
        const where = file.slice(process.cwd().length + 1).replace(/\\/g, '/');
        if (!has(ru, key)) missing.push(`ru: ${key} (${where})`);
        if (!has(en, key)) missing.push(`en: ${key} (${where})`);
      }
    }
    // Listed rather than counted: the message has to say which key, or the
    // person who broke it has to go looking.
    expect(missing).toEqual([]);
  });

  it('keeps the two languages the same shape', () => {
    // A key present in one language and not the other is half a translation:
    // the interface works for one operator and shows MISSING_MESSAGE to the next.
    const inRu = flatten(ru).sort();
    const inEn = flatten(en).sort();
    expect(inRu.filter((k) => !inEn.includes(k))).toEqual([]);
    expect(inEn.filter((k) => !inRu.includes(k))).toEqual([]);
  });
});
