import {readFileSync, readdirSync} from 'node:fs';
import {join, relative, sep} from 'node:path';
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

/**
 * Places where an action's answer may reach a person without being put into
 * words, each with the reason it is allowed to.
 *
 * Keyed by file and expression. A new entry needs a reason that would survive
 * someone asking "why is this one not translated" a year from now.
 */
const UNTRANSLATED_ON_PURPOSE: Record<string, string> = {
  'src/components/overview/attention-list.tsx: r.error':
    "the poller's stored English sentence (ServerStatus.error), not an action's refusal — kept in one language on purpose, see Д-21",
  'src/components/servers/server-form-dialog.tsx: res.message':
    'the connection probe’s technical summary on success, not a refusal — recorded as Д-29',
};

describe('every place a component shows what an action said', () => {
  it('puts it into words first', () => {
    // Д-23 checked what actions refuse with; this checks where those refusals
    // go. The first version of this test did not exist, and 25 places printed
    // `unauthenticated` or `forbidden` straight onto the screen (Д-26).
    //
    // Three positions count: a JSX child, a toast, and a state setter — once a
    // raw code is in state, it is rendered from a variable no pattern can
    // follow, so the rule is to translate before storing. An attribute is not
    // a position: it hands the value to a component, and the one component
    // that takes an action's message (FailureNotice) translates it itself.
    const positions: Array<{where: string; pattern: RegExp}> = [
      {where: 'rendered', pattern: /(?<![=\w])\{\s*([\w.?!]+\.(?:message|error))\s*\}/g},
      {where: 'toasted', pattern: /\btoast\.\w+\(\s*([\w.?!]+\.(?:message|error))\s*[,)]/g},
      {where: 'stored', pattern: /\bset[A-Z]\w*\(\s*([\w.?!]+\.(?:message|error))\s*\)/g},
    ];

    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, {withFileTypes: true})) {
        const full = join(dir, entry.name);
        // The UI kit never receives an action's answer; its `error.message` is
        // a form library's own object.
        if (entry.isDirectory()) {
          if (full.endsWith(join('components', 'ui'))) continue;
          walk(full);
        } else if (entry.name.endsWith('.tsx')) {
          files.push(full);
        }
      }
    };
    walk(join(process.cwd(), 'src', 'components'));
    walk(join(process.cwd(), 'src', 'app'));
    expect(files.length).toBeGreaterThan(50);

    const raw: string[] = [];
    for (const file of files) {
      const rel = relative(process.cwd(), file).split(sep).join('/');
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, index) => {
        for (const {where, pattern} of positions) {
          for (const match of line.matchAll(pattern)) {
            const key = `${rel}: ${match[1]!}`;
            if (key in UNTRANSLATED_ON_PURPOSE) continue;
            raw.push(`${rel}:${index + 1} ${where} ${match[1]!}`);
          }
        }
      });
    }

    expect(raw).toEqual([]);
  });
});
