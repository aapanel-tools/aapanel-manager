import {describe, it, expect, vi} from 'vitest';
import {runPollCycle} from './poll-cycle';

describe('runPollCycle', () => {
  it('polls every id and returns online/offline counts', async () => {
    const refresh = vi.fn(async (id: string) => ({ok: id !== 'b', online: id !== 'b'}));
    const res = await runPollCycle(['a', 'b', 'c'], 2, refresh);
    expect(refresh).toHaveBeenCalledTimes(3);
    expect(res).toEqual({total: 3, online: 2, offline: 1});
  });

  it('counts a thrown refresh as offline (never rejects)', async () => {
    const refresh = vi.fn(async (id: string) => {
      if (id === 'x') throw new Error('boom');
      return {ok: true, online: true};
    });
    const res = await runPollCycle(['x', 'y'], 4, refresh);
    expect(res).toEqual({total: 2, online: 1, offline: 1});
  });
});
