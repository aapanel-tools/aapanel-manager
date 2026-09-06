import {describe, it, expect} from 'vitest';
import {cycleSort} from './sort';

describe('cycleSort', () => {
  it('flips ascending to descending on the active column', () => {
    expect(cycleSort({sort: 'name', dir: 'asc'}, 'name')).toEqual({sort: 'name', dir: 'desc'});
  });

  // Regression: the 3rd click used to clear the sort (TanStack default removal),
  // which our URL model can't represent, so the column got stuck on descending.
  it('flips descending back to ascending on the active column (never clears)', () => {
    expect(cycleSort({sort: 'name', dir: 'desc'}, 'name')).toEqual({sort: 'name', dir: 'asc'});
  });

  it('starts a different column at ascending', () => {
    expect(cycleSort({sort: 'name', dir: 'asc'}, 'cpu')).toEqual({sort: 'cpu', dir: 'asc'});
  });

  it('ignores the previous direction when switching columns', () => {
    expect(cycleSort({sort: 'name', dir: 'desc'}, 'tag')).toEqual({sort: 'tag', dir: 'asc'});
  });
});
