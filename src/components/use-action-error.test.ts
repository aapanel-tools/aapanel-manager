import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {describe, it, expect} from 'vitest';

import en from '../../messages/en.json';
import ru from '../../messages/ru.json';
import {actionErrorCode, isActionErrorCode} from './use-action-error';

/**
 * Guards the second half of the defect Д-21 opened.
 *
 * Panel failures now reach an operator in their own language. An action also
 * refuses for reasons of its own — wrong role, a form that did not validate, a
 * confirmation phrase that did not match — and those travel as short codes.
 * Nothing about a code is wrong; showing one to a person is.
 */

describe('actionErrorCode', () => {
  it('recognises the codes actions actually return', () => {
    for (const code of ['unauthenticated', 'forbidden', 'validation', 'confirm', 'invalid', 'failed', 'notFound']) {
      expect(actionErrorCode(code)).toBe(code);
      expect(isActionErrorCode(code)).toBe(true);
    }
  });

  it('maps the older spellings onto the same refusals', () => {
    // One refusal with two names, and three hand-written ways of saying "the
    // request did not carry what it needed".
    expect(actionErrorCode('confirmMismatch')).toBe('confirm');
    expect(actionErrorCode('missing id')).toBe('validation');
    expect(actionErrorCode('api_sk required')).toBe('validation');
    expect(actionErrorCode('empty path')).toBe('validation');
  });

  it('leaves a finished sentence alone', () => {
    // By the time most failures reach here they are already a sentence in the
    // reader's language, made by presentError(). Replacing one with a generic
    // phrase would trade a specific explanation for a vague one.
    const sentence = 'prod-web-01: панель не ответила вовремя — Request timed out';
    expect(actionErrorCode(sentence)).toBeNull();
    expect(isActionErrorCode(sentence)).toBe(false);
  });

  it('does not fall over on something that is not a string', () => {
    expect(actionErrorCode(undefined)).toBeNull();
    expect(actionErrorCode(null)).toBeNull();
    expect(actionErrorCode({code: 'forbidden'})).toBeNull();
  });
});

describe('the shared refusal vocabulary', () => {
  const CODES = ['unauthenticated', 'forbidden', 'validation', 'confirm', 'invalid', 'failed', 'notFound'];

  it('has a phrase for every code, in both languages', () => {
    for (const code of CODES) {
      expect(Object.keys(ru.actionError)).toContain(code);
      expect(Object.keys(en.actionError)).toContain(code);
    }
  });

  it('carries no phrase nobody asks for', () => {
    // A key left behind after a code is renamed reads as a supported refusal.
    expect(Object.keys(ru.actionError).sort()).toEqual([...CODES].sort());
    expect(Object.keys(en.actionError).sort()).toEqual([...CODES].sort());
  });
});

/**
 * Codes that belong to one module and are translated inside it.
 *
 * Listed here so this test can tell "translated somewhere else" from "nobody
 * ever wrote a phrase for it". The value says where to look when one of them
 * turns up untranslated on screen.
 */
const DOMAIN_CODES: Record<string, string> = {
  alreadyFinished: 'jobs.error.* — job-detail.tsx',
  emailTaken: 'users.err.* — components/users/errors.ts',
  wrongPassword: 'users.err.* — components/users/errors.ts',
  'unsupported-mode': 'updates.err* — update-actions.tsx ERR_KEYS',
  'self-restart-not-configured': 'updates.err* — update-actions.tsx ERR_KEYS',
  'not-a-git-repo': 'updates.err* — update-actions.tsx ERR_KEYS',
  'update-in-progress': 'updates.err* — update-actions.tsx ERR_KEYS',
  'up-to-date': 'updates.err* — update-actions.tsx ERR_KEYS',
  'nothing-staged': 'updates.err* — update-actions.tsx ERR_KEYS',
  'release-not-found': 'updates.err* — update-actions.tsx ERR_KEYS',
  'no-target': 'updates.err* — update-actions.tsx ERR_KEYS',
  // These three carry the tool's own output in `message`, which is shown
  // instead of the code — the same rule that leaves a panel's words untranslated.
  'stage-failed': 'shown as the message it carries',
  'activate-failed': 'shown as the message it carries',
  'rollback-failed': 'shown as the message it carries',
};

describe('every refusal an action can return', () => {
  it('is either shared vocabulary or a module’s own, never a bare token', () => {
    // Deliberately dumb, like messages.test.ts: it reads the actions as text and
    // collects the literals they refuse with. Anything new that nobody wrote a
    // phrase for shows up here rather than on an operator's screen.
    const dir = join(process.cwd(), 'src', 'server', 'actions');
    const refusal = /\{\s*ok:\s*false\s*,\s*(?:error|message):\s*'([^']+)'/g;

    const unknown: string[] = [];
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue;
      const source = readFileSync(join(dir, file), 'utf8');
      for (const match of source.matchAll(refusal)) {
        const code = match[1]!;
        if (actionErrorCode(code) === null && !(code in DOMAIN_CODES)) {
          unknown.push(`${code} (src/server/actions/${file})`);
        }
      }
    }

    // Listed rather than counted: the message has to name the code and the file,
    // or whoever added it has to go looking.
    expect(unknown).toEqual([]);
  });
});
