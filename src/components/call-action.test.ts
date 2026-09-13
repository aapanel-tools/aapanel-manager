import {readFileSync, readdirSync} from 'node:fs';
import {join, relative, sep} from 'node:path';
import {describe, it, expect, vi, afterEach} from 'vitest';
import {redirect} from 'next/navigation';
import {UnrecognizedActionError} from 'next/dist/client/components/unrecognized-action-error';

/** A fresh store per test: the notices are module state by design. */
async function fresh() {
  vi.resetModules();
  const {appNotices} = await import('./app-notices-store');
  const {callAction, asMessage, asError, classifyCallError} = await import('./call-action');
  return {appNotices, callAction, asMessage, asError, classifyCallError};
}

describe('callAction', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hands back what the action answered, untouched', async () => {
    const {callAction, asMessage} = await fresh();
    const answer = {ok: false as const, message: 'forbidden'};
    expect(await callAction(async () => answer, asMessage)).toBe(answer);
  });

  it('turns an action the server no longer has into `outdated`, and says so app-wide', async () => {
    const {callAction, asMessage, appNotices} = await fresh();
    const res = await callAction(async () => {
      throw new UnrecognizedActionError('Server Action "x" was not found on the server.');
    }, asMessage);
    expect(res).toEqual({ok: false, message: 'outdated'});
    expect(appNotices.getSnapshot().outdated).toBe(true);
  });

  it('turns a request that did not get through into `unreachable`, in the caller’s shape', async () => {
    const {callAction, asError, appNotices} = await fresh();
    const res = await callAction(async () => {
      throw new TypeError('Failed to fetch');
    }, asError);
    expect(res).toEqual({ok: false, error: 'unreachable'});
    // A dropped connection may pass; it is said at the button, not app-wide.
    expect(appNotices.getSnapshot().outdated).toBe(false);
  });

  it('turns anything else into `failed`, and keeps the exception for the console', async () => {
    const {callAction, asMessage} = await fresh();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await callAction(async () => {
      throw new Error('An unexpected response was received from the server.');
    }, asMessage);
    expect(res).toEqual({ok: false, message: 'failed'});
    expect(logged).toHaveBeenCalledTimes(1);
  });

  it('passes on navigation an action asks for — that is not a failure', async () => {
    const {callAction, asMessage} = await fresh();
    await expect(callAction(async () => redirect('/login'), asMessage)).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_REDIRECT'),
    });
  });

  it('holds the session notice while nobody is signed in, and lets go at the next other answer', async () => {
    const {callAction, asMessage, appNotices} = await fresh();

    await callAction(async () => ({ok: false, message: 'unauthenticated'}), asMessage);
    expect(appNotices.getSnapshot().sessionEnded).toBe(true);

    await callAction(async () => ({ok: false, error: 'unauthenticated'}), asMessage);
    expect(appNotices.getSnapshot().sessionEnded).toBe(true);

    // Every action checks the session first (ADR-0009): `forbidden` proves one.
    await callAction(async () => ({ok: false, message: 'forbidden'}), asMessage);
    expect(appNotices.getSnapshot().sessionEnded).toBe(false);
  });

  it('leaves the notices alone for an answer that is not shaped like one', async () => {
    const {callAction, asMessage, appNotices} = await fresh();
    await callAction(async () => ({ok: false, message: 'unauthenticated'}), asMessage);
    expect(await callAction(async () => undefined, asMessage)).toBeUndefined();
    expect(appNotices.getSnapshot().sessionEnded).toBe(true);
  });
});

describe('the app-wide notices', () => {
  it('tell subscribers once per change, and let a hidden session notice go', async () => {
    const {appNotices} = await fresh();
    const heard = vi.fn();
    const stop = appNotices.subscribe(heard);

    appNotices.reportSessionEnded();
    appNotices.reportSessionEnded();
    expect(heard).toHaveBeenCalledTimes(1);

    appNotices.dismissSessionEnded();
    expect(appNotices.getSnapshot().sessionEnded).toBe(false);
    expect(heard).toHaveBeenCalledTimes(2);

    stop();
    appNotices.reportOutdated();
    expect(heard).toHaveBeenCalledTimes(2);
    // What the server renders never carries a notice: nothing was called there.
    expect(appNotices.getServerSnapshot()).toEqual({outdated: false, sessionEnded: false});
  });
});

/**
 * Every call to a server action from client code goes through callAction.
 *
 * The rule is one for all places, not a list of the ones that matter: a list
 * cannot be checked and drifts from the code. A call left bare falls, on the
 * day the app updates or the connection drops, into silence, into a section
 * replaced by its error boundary, or into Next's error page (Д-31).
 */
describe('every server action call in client code', () => {
  const SRC = join(process.cwd(), 'src');

  /** Places that catch a failed call themselves, and why that is right there. */
  const HANDLED_ON_PURPOSE: Record<string, string> = {
    'src/components/settings/update-actions.tsx':
      'a dropped call during apply or rollback means the app is restarting, and the screen waits for the new version on that basis',
  };

  function clientFiles(dir: string, out: {rel: string; text: string}[] = []) {
    for (const entry of readdirSync(dir, {withFileTypes: true})) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        clientFiles(full, out);
      } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        const text = readFileSync(full, 'utf8');
        if (/^\s*['"]use client['"]/.test(text)) out.push({rel: relative(process.cwd(), full).split(sep).join('/'), text});
      }
    }
    return out;
  }

  /** The names a file imports from the server actions, types aside. */
  function importedActions(text: string): string[] {
    const names: string[] = [];
    for (const m of text.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s+from\s+['"]@\/server\/actions\/[^'"]+['"]/g)) {
      if (m[1]) continue;
      for (const part of m[2]!.split(',')) {
        const name = part.trim();
        if (!name || name.startsWith('type ')) continue;
        names.push(name.split(/\s+as\s+/).pop()!.trim());
      }
    }
    return names;
  }

  const WRAPPED = /callAction\(\s*(?:async\s*)?\(\s*\)\s*=>\s*(?:await\s+)?$/;

  /**
   * Comments blanked out, offsets kept: a comment may name an action, and a
   * name in prose is not a call.
   */
  function withoutComments(text: string): string {
    return text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (comment) => comment.replace(/[^\n]/g, ' '));
  }

  it('goes through callAction, and is never passed around where this cannot see it', () => {
    const bare: string[] = [];
    let calls = 0;

    for (const {rel, text: source} of clientFiles(SRC)) {
      if (rel in HANDLED_ON_PURPOSE) continue;
      const text = withoutComments(source);
      const imports = [...text.matchAll(/import\s[^;]*?from\s+['"][^'"]+['"];?/g)].map((m) => [
        m.index!,
        m.index! + m[0].length,
      ]);
      for (const name of importedActions(text)) {
        for (const m of text.matchAll(new RegExp(`(?<![\\w.$])${name}(?![\\w$])`, 'g'))) {
          const at = m.index!;
          if (imports.some(([start, end]) => at >= start && at < end)) continue;
          if (/typeof\s+$/.test(text.slice(Math.max(0, at - 16), at))) continue;
          const line = text.slice(0, at).split('\n').length;
          // A reference handed to a variable or a prop is called somewhere this
          // test cannot follow (the server form once picked create or update
          // into `action` and called that), so it counts as bare.
          if (!/^\s*\(/.test(text.slice(at + name.length))) {
            bare.push(`${rel}:${line} ${name} (passed around)`);
            continue;
          }
          calls += 1;
          if (!WRAPPED.test(text.slice(Math.max(0, at - 160), at))) bare.push(`${rel}:${line} ${name}`);
        }
      }
    }

    // Guards the guard: a broken import pattern must not leave this passing over nothing.
    expect(calls).toBeGreaterThanOrEqual(40);
    expect(bare).toEqual([]);
  });
});
