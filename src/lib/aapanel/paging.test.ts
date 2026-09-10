import {describe, it, expect} from 'vitest';

import {
  DEFAULT_PAGE_LIMIT,
  MAX_SEARCH_LENGTH,
  describePage,
  normalizeSearch,
  readPanelTotal,
} from './paging';

describe('readPanelTotal', () => {
  it('reads the count out of the markup the panel actually sends', () => {
    // Verbatim from a live v8 panel’s project list.
    const page = "<div><span class='Pcurrent'>1</span><span class='Pcount'>Total 3</span></div>";
    expect(readPanelTotal(page)).toBe(3);
  });

  it('reads a count with thousands of rows', () => {
    expect(readPanelTotal('<div>Total 1200</div>')).toBe(1200);
  });

  it('says "unknown" rather than "none" when there is nothing to read', () => {
    // The distinction is the whole point: a caller that reads null as 0 turns
    // an unreadable answer into a claim that the panel is empty.
    expect(readPanelTotal('')).toBeNull();
    expect(readPanelTotal(undefined)).toBeNull();
    expect(readPanelTotal(null)).toBeNull();
    expect(readPanelTotal('<div>共 3 条</div>')).toBeNull();
  });
});

describe('describePage', () => {
  const page = (total: number) => `<div><span class='Pcount'>Total ${total}</span></div>`;

  it('says nothing when the list is whole', () => {
    // The ordinary case, and the one that must stay quiet: a notice on every
    // list would be ignored by the time it mattered.
    expect(describePage('sites', 7, 1000, page(7))).toBeNull();
  });

  it('reports exactly what is missing when the panel says how much there is', () => {
    expect(describePage('sites', 1000, 1000, page(1200))).toEqual({
      source: 'sites',
      shown: 1000,
      total: 1200,
    });
  });

  it('trusts the panel over the row count when the two disagree', () => {
    // Exactly `limit` rows and the panel says that is all: complete, not
    // suspicious. Without this the app would cry wolf on every list whose
    // length happens to land on the limit.
    expect(describePage('sites', 1000, 1000, page(1000))).toBeNull();
  });

  it('falls back to the row count when the markup cannot be read', () => {
    // No total, but a source that returned everything it was asked for. The
    // count depends on no markup at all, which is why it is the fallback.
    expect(describePage('mysql', 1000, 1000, '')).toEqual({
      source: 'mysql',
      shown: 1000,
      total: null,
    });
  });

  it('stays quiet on a short list even with no markup at all', () => {
    expect(describePage('mysql', 12, 1000, undefined)).toBeNull();
  });

  it('names the source it is talking about', () => {
    // On the databases page two engines are merged into one list; a warning
    // that does not say which engine sends the operator looking in both.
    expect(describePage('pgsql', 50, 50, '')?.source).toBe('pgsql');
  });

  it('has a default limit high enough that hitting it is news', () => {
    expect(DEFAULT_PAGE_LIMIT).toBeGreaterThanOrEqual(1000);
  });
});

describe('normalizeSearch', () => {
  it('sends nothing at all when nothing was asked for', () => {
    // Empty is the panel idiom for "no filter": these endpoints already
    // receive `search=` on every ordinary list request.
    expect(normalizeSearch('')).toBe('');
    expect(normalizeSearch(undefined)).toBe('');
    expect(normalizeSearch(null)).toBe('');
    expect(normalizeSearch('   ')).toBe('');
  });

  it('leaves an ordinary term exactly as typed', () => {
    expect(normalizeSearch('shop.example.com')).toBe('shop.example.com');
    expect(normalizeSearch('  wp_main  ')).toBe('wp_main');
    // A non-Latin name is a name, not something to sanitize away.
    expect(normalizeSearch('магазин.рф')).toBe('магазин.рф');
  });

  it('strips control characters that could forge a line in the panel log', () => {
    // The panel writes what it was asked for into its own log. A newline in a
    // search term is a forged log entry waiting to happen, and no domain,
    // database or project name contains one.
    expect(normalizeSearch('site\n2026-01-01 admin logged in')).toBe(
      'site 2026-01-01 admin logged in',
    );
    expect(normalizeSearch('a\r\nb')).toBe('a  b');
    expect(normalizeSearch('a\u0000b')).toBe('a b');
    expect(normalizeSearch('a\u007fb')).toBe('a b');
  });

  it('cuts an over-long term instead of refusing it', () => {
    const long = 'x'.repeat(MAX_SEARCH_LENGTH + 50);
    const cut = normalizeSearch(long);
    expect(cut).toHaveLength(MAX_SEARCH_LENGTH);
    // Cutting widens the search — a prefix matches everything the full term
    // would have matched and more — so the error direction is extra rows,
    // never missing ones.
    expect(long.startsWith(cut)).toBe(true);
  });

  it('cuts by character, not by code unit', () => {
    // Slicing a string of astral characters at a code-unit boundary would send
    // half a surrogate pair to the panel — a malformed string, not a search.
    const term = '🌐'.repeat(MAX_SEARCH_LENGTH + 10);
    const cut = normalizeSearch(term);
    expect(Array.from(cut)).toHaveLength(MAX_SEARCH_LENGTH);
    // Stated as an exact value rather than as "no trailing surrogate": the
    // last code unit of a whole emoji is a low surrogate too, so only the
    // exact string tells a clean cut from half a character.
    expect(cut).toBe('🌐'.repeat(MAX_SEARCH_LENGTH));
  });

  it('refuses anything that is not a string, rather than crashing on it', () => {
    // The nearest caller is a server action, and a TypeScript annotation is
    // not a runtime check: whatever a browser sends arrives here as-is.
    expect(normalizeSearch({} as unknown)).toBe('');
    expect(normalizeSearch(42 as unknown)).toBe('');
    expect(normalizeSearch(['a'] as unknown)).toBe('');
  });
});
