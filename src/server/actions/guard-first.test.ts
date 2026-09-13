import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {dirname, join, relative, sep} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

/**
 * Every server action refuses a caller without a session before it does
 * anything else (ADR-0009).
 *
 * Proxy used to send a sessionless action call to the login page. That made a
 * forgotten check survivable and a lapsed session invisible: the button did
 * nothing at all (Д-30). Proxy now lets action calls through, so the check
 * inside each action is the boundary — and this is what holds it for the whole
 * class, rather than for the five files that had a test of their own.
 *
 * Each action is called with nobody signed in. It must answer `unauthenticated`
 * — not `forbidden`, which would tell an operator whose session ran out that
 * they lack a role — and must not have reached the database, a panel or the
 * network on the way. Modules and actions added later are picked up by
 * themselves.
 */

const trap = vi.hoisted(() => ({reached: [] as string[]}));

vi.mock('@/auth', () => ({auth: async () => null}));

vi.mock('@/lib/db/prisma', () => {
  // Any call through the client, however deep (`prisma.server.findUnique`,
  // `prisma.$transaction`), is recorded and fails. Reading a property is not a
  // call, so modules that only mention the client at import time load as usual.
  const client = (path: string): unknown =>
    new Proxy(function prismaTrap() {}, {
      get: (_target, prop) =>
        typeof prop === 'symbol' || prop === 'then' ? undefined : client(`${path}.${prop}`),
      apply: () => {
        trap.reached.push(path);
        return Promise.reject(new Error(`${path} reached without a session`));
      },
    });
  return {prisma: client('prisma')};
});

vi.mock('@/lib/aapanel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/aapanel')>();
  return {
    ...actual,
    createClientForServer: async () => {
      trap.reached.push('createClientForServer');
      throw new Error('a panel client was created without a session');
    },
  };
});

const ACTIONS = dirname(fileURLToPath(import.meta.url));
const SRC = join(ACTIONS, '..', '..');

const posix = (file: string): string => relative(SRC, file).split(sep).join('/');

/** Leading blank lines and comments, which may sit above a file's directive. */
const PREAMBLE = /^(?:\s+|\/\/[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*/;

/** The directive opens the file: every export of it is an action. */
function isActionModule(text: string): boolean {
  return /^['"]use server['"]/.test(text.replace(PREAMBLE, ''));
}

/**
 * The directive as a statement — how a single function opts in. At the start of
 * a line, or straight after the `{` or `;` before it on the same line:
 * `async () => {'use server'; …}` is how the sign-out form writes it, and a
 * match on a line of its own walked straight past that.
 */
const DIRECTIVE = /(?:^|[{;])\s*['"]use server['"]/m;

/**
 * Inline actions that have to work without a session, and why that is safe.
 * Anything else declared outside src/server/actions would escape the check
 * below, so it fails the first test instead.
 */
const INLINE_WITHOUT_SESSION: Record<string, string> = {
  'app/(auth)/login/page.tsx': 'signing in is what a caller without a session is there to do',
  'components/app-shell.tsx': "signing out acts on the caller's own cookie and nothing else",
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

/**
 * Actions whose answer carries counts rather than a refusal code, and why that
 * is enough. They must still refuse, and still reach nothing.
 */
const NO_CODE_ON_PURPOSE: Record<string, string> = {
  'server/actions/servers.ts#refreshVisibleStatusesAction':
    'answers with how many rows it refreshed; the toolbar shows its own failure phrase',
};

function refusalCode(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const {message, error} = result as {message?: unknown; error?: unknown};
  if (typeof message === 'string') return message;
  return typeof error === 'string' ? error : undefined;
}

describe('server actions check the session before anything else (ADR-0009)', () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    trap.reached.length = 0;
    globalThis.fetch = (async (input: unknown) => {
      trap.reached.push(`fetch ${String(input)}`);
      throw new Error('the network was reached without a session');
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('keeps every server action where this test can see it', () => {
    const files = sourceFiles(SRC).map((file) => ({file: posix(file), text: readFileSync(file, 'utf8')}));

    const modulesElsewhere = files
      .filter(({file, text}) => isActionModule(text) && !file.startsWith('server/actions/'))
      .map(({file}) => file);
    const inline = files
      .filter(({text}) => !isActionModule(text) && DIRECTIVE.test(text))
      .map(({file}) => file)
      .sort();

    expect(modulesElsewhere).toEqual([]);
    expect(inline).toEqual(Object.keys(INLINE_WITHOUT_SESSION).sort());
  });

  it(
    'refuses a caller without a session in words, and reaches nothing on the way',
    async () => {
      const offenders: string[] = [];
      const seen = new Set<string>();
      let modules = 0;

      for (const name of readdirSync(ACTIONS).sort()) {
        const full = join(ACTIONS, name);
        if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
        if (!isActionModule(readFileSync(full, 'utf8'))) continue;
        modules++;

        const mod = (await import(/* @vite-ignore */ pathToFileURL(full).href)) as Record<string, unknown>;
        for (const [exported, value] of Object.entries(mod)) {
          if (typeof value !== 'function') continue;
          const id = `${posix(full)}#${exported}`;
          seen.add(id);
          trap.reached.length = 0;

          // Arguments are never read before the check, so their shape does not
          // matter; an action that reads them first fails here either way.
          const args = Array.from({length: value.length}, () => []);
          let result: unknown;
          try {
            result = await (value as (...a: unknown[]) => Promise<unknown>)(...args);
          } catch (e) {
            offenders.push(`${id}: threw instead of refusing (${e instanceof Error ? e.message : String(e)})`);
            continue;
          }

          if (trap.reached.length > 0) {
            offenders.push(`${id}: reached ${trap.reached.join(', ')}`);
          } else if ((result as {ok?: unknown} | null)?.ok !== false) {
            offenders.push(`${id}: did not refuse`);
          } else if (!(id in NO_CODE_ON_PURPOSE) && refusalCode(result) !== 'unauthenticated') {
            offenders.push(`${id}: refused with ${JSON.stringify(refusalCode(result))}`);
          }
        }
      }

      // Guards the guard: a moved directory or a failed discovery must not leave
      // this test passing over nothing. On 2026-09-13 there were 11 modules and
      // 54 actions; the floor sits a little below so that removing an action is
      // not a reason to edit this file.
      expect(modules).toBeGreaterThanOrEqual(11);
      expect(seen.size).toBeGreaterThanOrEqual(50);
      expect(Object.keys(NO_CODE_ON_PURPOSE).filter((id) => !seen.has(id))).toEqual([]);
      expect(offenders).toEqual([]);
    },
    60_000,
  );
});
