import {describe, it, expect} from 'vitest';

import {DEFAULT_PAGE_LIMIT, describePage, readPanelTotal} from './paging';

describe('readPanelTotal', () => {
  it('reads the count out of the markup the panel actually sends', () => {
    // Verbatim from a live panel's project list (docs/*/nodejs-projects.md).
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
