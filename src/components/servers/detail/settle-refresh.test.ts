import {readFileSync, readdirSync} from 'node:fs';
import {join, relative, sep} from 'node:path';
import {describe, it, expect} from 'vitest';
import {settled, settleRefresh} from './settle-refresh';

/**
 * Every searchable list says when it shows rows a refresh could not renew.
 *
 * The hook keeps the rows (settle-refresh.ts); a section that took them and
 * rendered no notice would show old rows as if they were fresh — worse than the
 * blank it replaced.
 */
describe('every searchable list', () => {
  it('renders StaleNotice and DataAge', () => {
    const SRC = join(process.cwd(), 'src');
    const users: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, {withFileTypes: true})) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name)) {
          const text = readFileSync(full, 'utf8');
          if (/\buseSearchableList\s*[<(]/.test(text)) users.push(relative(process.cwd(), full).split(sep).join('/'));
          // Both halves of saying how old the rows are: always (DataAge), and
          // after a refresh that brought nothing (StaleNotice, У-8).
          if (/\buseSearchableList\s*[<(]/.test(text) && !(/<StaleNotice\b/.test(text) && /<DataAge\b/.test(text))) {
            silent.push(relative(process.cwd(), full).split(sep).join('/'));
          }
        }
      }
    };
    const silent: string[] = [];
    walk(SRC);
    // Guards the guard: six sections use the hook today.
    expect(users.length).toBeGreaterThanOrEqual(6);
    expect(silent).toEqual([]);
  });
});

type Answer = {ok: true; rows: string[]} | {ok: false; message: string};

const rows = (...names: string[]): Answer => ({ok: true, rows: names});
const refusal = (message: string): Answer => ({ok: false, message});

const T1 = new Date('2026-09-14T10:00:00Z');
const T2 = new Date('2026-09-14T10:00:12Z');
const T3 = new Date('2026-09-14T10:00:24Z');

describe('settleRefresh', () => {
  it('shows a good answer, and remembers when it came', () => {
    const next = settleRefresh(settled(rows('a')), rows('a', 'b'), T1);
    expect(next).toEqual({result: rows('a', 'b'), failure: null, fetchedAt: T1});
  });

  it('keeps the rows on screen when a refresh brings nothing, and says why', () => {
    const before = settleRefresh(settled(rows('a')), rows('a', 'b'), T1);
    const after = settleRefresh(before, refusal('unreachable'), T2);
    expect(after.result).toEqual(rows('a', 'b'));
    expect(after.failure).toBe('unreachable');
    // The rows are as old as they were: the failed attempt is not a fetch.
    expect(after.fetchedAt).toBe(T1);
  });

  it('keeps the rows the page arrived with, without inventing when they were fetched', () => {
    const after = settleRefresh(settled(rows('a')), refusal('outdated'), T2);
    expect(after).toEqual({result: rows('a'), failure: 'outdated', fetchedAt: null});
  });

  it('shows the refusal itself while there never was any data', () => {
    const after = settleRefresh(settled(refusal('prod-web-01: панель недоступна')), refusal('unreachable'), T2);
    expect(after).toEqual({result: refusal('unreachable'), failure: null, fetchedAt: null});
  });

  it('reports the latest reason on a second failure, and clears it at the next good answer', () => {
    let state = settleRefresh(settled(rows('a')), rows('a'), T1);
    state = settleRefresh(state, refusal('unreachable'), T2);
    state = settleRefresh(state, refusal('failed'), T3);
    expect(state.failure).toBe('failed');
    expect(state.fetchedAt).toBe(T1);

    state = settleRefresh(state, rows('b'), T3);
    expect(state).toEqual({result: rows('b'), failure: null, fetchedAt: T3});
  });

  it('reads the reason from `error` too, and never leaves it empty', () => {
    type Mut = {ok: true; rows: string[]} | {ok: false; error: string};
    const start = settled<Mut>({ok: true, rows: ['a']});
    expect(settleRefresh(start, {ok: false, error: 'forbidden'}, T2).failure).toBe('forbidden');
    expect(settleRefresh(start, {ok: false, error: ''}, T2).failure).toBe('failed');
  });
});
