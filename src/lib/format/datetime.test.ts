import {readFileSync, readdirSync} from 'node:fs';
import {join, relative} from 'node:path';
import {describe, it, expect} from 'vitest';

import {formatTimestamp, formatTimestampOrNull} from './datetime';

/** Formatting by the machine's locale: different on the server and in each browser. */
const LOCALE_FORMAT = /\.toLocale(?:Date|Time)?String\(|Intl\.DateTimeFormat\b/;

describe('formatTimestamp', () => {
  const moment = new Date('2026-09-09T14:07:33.512Z');

  it('renders a stable "YYYY-MM-DD HH:MM:SS" in UTC', () => {
    expect(formatTimestamp(moment)).toBe('2026-09-09 14:07:33');
  });

  it('drops seconds when asked', () => {
    expect(formatTimestamp(moment, 'minutes')).toBe('2026-09-09 14:07');
  });

  it('accepts an ISO string, since serialised rows arrive as strings', () => {
    expect(formatTimestamp('2026-09-09T14:07:33.512Z')).toBe('2026-09-09 14:07:33');
  });

  it('does not depend on the machine timezone', () => {
    // The whole point of not localising: a server in UTC and a browser in +07
    // must render the same characters, or React reports a hydration mismatch
    // and the operator sees two different times for one event.
    const asString = formatTimestamp('2026-09-09T14:07:33.512Z');
    const asDate = formatTimestamp(new Date('2026-09-09T14:07:33.512Z'));
    expect(asString).toBe(asDate);
    expect(asString).not.toMatch(/[+Z]/);
  });
});

describe('formatTimestampOrNull', () => {
  it('passes null through for a moment that has not happened', () => {
    // A job that never started has no start time; rendering "1970-01-01" there
    // would be a lie about the machine, not a formatting detail.
    expect(formatTimestampOrNull(null)).toBeNull();
    expect(formatTimestampOrNull(undefined)).toBeNull();
  });

  it('formats a real date like formatTimestamp', () => {
    const d = new Date('2026-01-02T03:04:05.000Z');
    expect(formatTimestampOrNull(d)).toBe('2026-01-02 03:04:05');
    expect(formatTimestampOrNull(d, 'minutes')).toBe('2026-01-02 03:04');
  });
});

describe('what the app draws', () => {
  // 2026-09-14 (Д-33): one table cell used toLocaleString(). The server wrote
  // "13.09.2026, 21:04:07", an English browser "9/13/2026, 9:04:07 PM"; React
  // threw the servers table away on every load and drew it again in the
  // browser's own locale and timezone, unlike every other time in the app.
  // Dates go through formatTimestamp; numbers through next-intl's useFormatter.
  const roots = ['src/components', 'src/app'].map((root) => join(process.cwd(), root));
  const files = roots.flatMap((root) =>
    readdirSync(root, {recursive: true, encoding: 'utf8'})
      .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
      .map((name) => join(root, name)),
  );

  it('knows a locale format when it sees one', () => {
    expect(LOCALE_FORMAT.test('new Date(row.original.lastCheckedAt).toLocaleString()')).toBe(true);
    expect(LOCALE_FORMAT.test('value.toLocaleDateString("ru")')).toBe(true);
    expect(LOCALE_FORMAT.test('new Intl.DateTimeFormat(locale)')).toBe(true);
    expect(LOCALE_FORMAT.test('formatTimestamp(row.original.lastCheckedAt)')).toBe(false);
  });

  it('formats nothing by the locale of whichever machine renders it', () => {
    expect(files.length).toBeGreaterThan(50);
    const found = files
      .filter((file) => LOCALE_FORMAT.test(readFileSync(file, 'utf8')))
      .map((file) => relative(process.cwd(), file));
    expect(found).toEqual([]);
  });
});
