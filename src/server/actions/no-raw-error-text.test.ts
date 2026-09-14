import {describe, it, expect} from 'vitest';
import {readdirSync, readFileSync} from 'node:fs';
import {join, relative, sep} from 'node:path';

/**
 * What an operator is told about a failure is decided in one place (Д-35).
 *
 * presentError() turns a panel failure into a phrase in the reader's language and
 * anything else into a code, and never passes on the text of the app's own
 * exception — for a database failure that is Prisma's message, with the query and
 * the paths of the build on the server's disk. One helper doing it right is worth
 * little if an action next to it reads `err.message` itself, or reaches for
 * describeError(), which writes the technical sentence meant for the log.
 *
 * Checked on the source rather than by calling every action with every failure:
 * the rule is about what the code is allowed to reach for, and the helper's own
 * behaviour is pinned down in present.test.ts.
 */
const root = process.cwd();
const ACTIONS = join(root, 'src', 'server', 'actions');
const SCREENS = [join(root, 'src', 'components'), join(root, 'src', 'app')];

const rel = (file: string): string => relative(root, file).split(sep).join('/');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, {withFileTypes: true})) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Code lines only: a comment may name what it warns against. */
function codeLines(file: string): Array<{n: number; text: string}> {
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((text, i) => ({n: i + 1, text}))
    .filter(({text}) => !/^\s*(\/\/|\*|\/\*)/.test(text));
}

/** The server actions that show panel failures — the ones this rule is about. */
const panelActions = sourceFiles(ACTIONS).filter((file) => {
  const source = readFileSync(file, 'utf8');
  return source.startsWith("'use server'") && source.includes('presentError(');
});

describe('failure text an operator is shown', () => {
  it('finds the actions that show panel failures, or the scan has rotted', () => {
    // cron, databases, files, firewall, ftp, projects, servers, sites.
    expect(panelActions.length).toBeGreaterThanOrEqual(8);
  });

  it('leaves a caught error’s own text to presentError() in every one of them', () => {
    const offences: string[] = [];
    for (const file of panelActions) {
      for (const {n, text} of codeLines(file)) {
        if (/\b(?:err|e|error|cause)\.message\b|String\(\s*(?:err|e|error)\s*\)/.test(text)) {
          offences.push(`${rel(file)}:${n}: ${text.trim()}`);
        }
      }
    }
    expect(offences).toEqual([]);
  });

  it('never shows describeError(), the sentence written for the log', () => {
    const offences: string[] = [];
    for (const file of [...sourceFiles(ACTIONS), ...SCREENS.flatMap(sourceFiles)]) {
      for (const {n, text} of codeLines(file)) {
        if (/\bdescribeError\(/.test(text)) offences.push(`${rel(file)}:${n}: ${text.trim()}`);
      }
    }
    expect(offences).toEqual([]);
  });
});
