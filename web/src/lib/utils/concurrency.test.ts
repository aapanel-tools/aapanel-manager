import {describe, it, expect} from 'vitest';
import {mapLimit} from './concurrency';

describe('mapLimit', () => {
  it('preserves input order in the results', async () => {
    const out = await mapLimit([1, 2, 3, 4], 2, async (n) => n * 10);
    expect(out).toEqual([
      {ok: true, value: 10},
      {ok: true, value: 20},
      {ok: true, value: 30},
      {ok: true, value: 40},
    ]);
  });

  it('never exceeds the concurrency limit', async () => {
    let active = 0;
    let peak = 0;
    await mapLimit([...Array(10).keys()], 3, async () => {
      active++; peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
    });
    expect(peak).toBeLessThanOrEqual(3);
  });

  it('isolates rejections per item (allSettled-style)', async () => {
    const out = await mapLimit([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error('boom');
      return n;
    });
    expect(out[0]).toEqual({ok: true, value: 1});
    expect(out[1].ok).toBe(false);
    expect(out[2]).toEqual({ok: true, value: 3});
  });
});
