import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {describe, it, expect} from 'vitest';

import en from '../../messages/en.json';
import ru from '../../messages/ru.json';
import {FIELD, isFieldMessage} from '@/lib/validation/messages';

/**
 * Guards the last place English could reach a Russian-speaking operator.
 *
 * Д-21 translated what the panel says when it fails; Д-23 translated an
 * action's own refusals; this covers the check that one field failed. All three
 * follow the same rule — the server names the problem, the browser says it —
 * and this test exists because the schemas are the easiest place to forget it:
 * a message written there reads perfectly well to whoever writes it.
 */

describe('the field message vocabulary', () => {
  const KEYS = Object.values(FIELD);

  it('has a phrase for every key, in both languages', () => {
    for (const key of KEYS) {
      expect(Object.keys(ru.fieldError)).toContain(key);
      expect(Object.keys(en.fieldError)).toContain(key);
    }
  });

  it('carries no phrase nobody asks for', () => {
    expect(Object.keys(ru.fieldError).sort()).toEqual([...KEYS].sort());
    expect(Object.keys(en.fieldError).sort()).toEqual([...KEYS].sort());
  });

  it('recognises its own keys and nothing else', () => {
    expect(isFieldMessage(FIELD.absolutePath)).toBe(true);
    expect(isFieldMessage('Must be an absolute path')).toBe(false);
    expect(isFieldMessage(undefined)).toBe(false);
  });
});

describe('the validation schemas', () => {
  it('name what is wrong with a key, never with a sentence', () => {
    // Deliberately dumb, like messages.test.ts: it reads the schemas as text
    // and looks for a quoted string where a message belongs. A sentence there
    // is English on a Russian screen the moment someone fills a form in wrong,
    // and nothing else in the gate would notice (Д-24).
    const dir = join(process.cwd(), 'src', 'lib', 'validation');

    // A message is the last argument of a constraint, or sits under `message:`
    // in a refinement's options. The patterns stay anchored to one line each —
    // matching a refinement's argument loosely would trip over the commas
    // inside the predicate itself, which is how the first draft of this test
    // reported `'https:'` from an array as a stray message.
    const patterns = [
      /\.(?:min|max|length)\([^,)]+,\s*'([^']+)'\)/g,
      /\.regex\(\/.*?\/[a-z]*,\s*'([^']+)'\)/g,
      /\.(?:email|url|nonempty)\(\s*'([^']+)'\s*\)/g,
      /^\s*\},?\s*'([^']+)'\)/gm,
      /\.refine\(.*,\s*'([^']+)'\)\s*[;,)]?\s*$/gm,
      /message:\s*'([^']+)'/g,
    ];

    const prose: string[] = [];
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.ts') || file.endsWith('.test.ts') || file === 'messages.ts') continue;
      const source = readFileSync(join(dir, file), 'utf8');
      for (const pattern of patterns) {
        for (const match of source.matchAll(pattern)) {
          const message = match[1]!;
          if (!isFieldMessage(message)) prose.push(`"${message}" (src/lib/validation/${file})`);
        }
      }
    }

    // Listed rather than counted: the message has to name the sentence and the
    // file, or whoever wrote it has to go looking.
    expect(prose).toEqual([]);
  });
});
