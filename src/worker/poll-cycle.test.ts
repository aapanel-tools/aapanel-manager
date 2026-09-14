import {describe, it, expect, vi, afterEach} from 'vitest';
import {ServerNotFoundError} from '@/lib/servers/creds';
import {log} from '@/log';
import {runPollCycle} from './poll-cycle';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runPollCycle', () => {
  it('polls every id and returns online/offline counts', async () => {
    const refresh = vi.fn(async (id: string) => ({ok: id !== 'b', online: id !== 'b'}));
    const res = await runPollCycle(['a', 'b', 'c'], 2, refresh);
    expect(refresh).toHaveBeenCalledTimes(3);
    expect(res).toEqual({total: 3, online: 2, offline: 1, failed: 0});
  });

  it('counts a thrown refresh as offline (never rejects)', async () => {
    const refresh = vi.fn(async (id: string) => {
      if (id === 'x') throw new Error('boom');
      return {ok: true, online: true};
    });
    const res = await runPollCycle(['x', 'y'], 4, refresh);
    expect(res).toEqual({total: 2, online: 1, offline: 1, failed: 1});
  });

  it('says in one line how many servers could not be refreshed, and why (Д-37)', async () => {
    const error = vi.spyOn(log, 'error');
    const refresh = vi.fn(async (id: string) => {
      if (id === 'fine') return {ok: true, online: true};
      throw Object.assign(new Error(`database unreachable while refreshing ${id}`), {code: 'P1001'});
    });

    const res = await runPollCycle(['a', 'b', 'c', 'd', 'fine'], 2, refresh);

    expect(res.failed).toBe(4);
    // One line for the cycle, not one per server: an outage must not flood the log.
    expect(error).toHaveBeenCalledTimes(1);
    const fields = error.mock.calls[0]![0] as unknown as {
      failed: number;
      examples: Array<{serverId: string; err: {message: string; code?: string}}>;
    };
    expect(fields.failed).toBe(4);
    expect(fields.examples).toHaveLength(3);
    expect(fields.examples[0]).toEqual({
      serverId: 'a',
      err: {message: 'database unreachable while refreshing a', code: 'P1001'},
    });
  });

  it('writes no error for a server removed while the cycle ran', async () => {
    const error = vi.spyOn(log, 'error');
    const debug = vi.spyOn(log, 'debug');
    const refresh = vi.fn(async (id: string) => {
      if (id === 'gone') throw new ServerNotFoundError(id);
      return {ok: true, online: true};
    });

    const res = await runPollCycle(['gone', 'here'], 2, refresh);

    expect(res).toEqual({total: 2, online: 1, offline: 1, failed: 0});
    expect(error).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledTimes(1);
  });
});
