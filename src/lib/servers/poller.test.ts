import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

// `server-only` throws under plain Node; neutralize it for the test runner.
vi.mock('server-only', () => ({}));

// Shared mock state/spies. vi.hoisted runs before the (hoisted) vi.mock factories,
// so they can safely reference these.
const h = vi.hoisted(() => ({
  lock: {granted: true},
  endSpy: vi.fn(),
  querySpy: vi.fn((_sql: string) => {}),
  findMany: vi.fn(async () => [{id: 's1'}, {id: 's2'}]),
  refreshServerStatus: vi.fn(async (_id: string) => ({ok: true, online: true})),
  runPollCycle: vi.fn(
    async (
      ids: string[],
      _concurrency: number,
      _refresh: (id: string) => Promise<{ok: boolean; online: boolean}>,
    ) => ({total: ids.length, online: ids.length, offline: 0}),
  ),
}));

vi.mock('pg', () => {
  class Client {
    on(): this {
      return this;
    }
    async connect(): Promise<void> {}
    async query(sql: string): Promise<{rows: Array<{locked: boolean}>}> {
      h.querySpy(sql);
      if (sql.includes('pg_try_advisory_lock')) return {rows: [{locked: h.lock.granted}]};
      return {rows: []};
    }
    async end(): Promise<void> {
      h.endSpy();
    }
  }
  return {Client};
});
vi.mock('@/env', () => ({
  parseEnv: () => ({POLL_INTERVAL_MS: 1_000_000, WORKER_CONCURRENCY: 7, ENABLE_POLLER: true}),
}));
vi.mock('@/log', () => ({log: {info: vi.fn(), warn: vi.fn(), error: vi.fn()}}));
vi.mock('@/lib/db/prisma', () => ({prisma: {server: {findMany: h.findMany}, $disconnect: vi.fn()}}));
vi.mock('@/lib/servers/status', () => ({refreshServerStatus: h.refreshServerStatus}));
vi.mock('@/worker/poll-cycle', () => ({runPollCycle: h.runPollCycle}));

const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

describe('startServerPoller', () => {
  beforeEach(() => {
    process.setMaxListeners(0);
    vi.useFakeTimers();
    delete (globalThis as Record<string, unknown>).__serverPoller;
    h.lock.granted = true;
    h.endSpy.mockClear();
    h.querySpy.mockClear();
    h.findMany.mockClear();
    h.refreshServerStatus.mockClear();
    h.runPollCycle.mockClear();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    delete (globalThis as Record<string, unknown>).__serverPoller;
  });

  it('polls when it acquires the advisory lock (leader)', async () => {
    const {startServerPoller} = await import('./poller');
    startServerPoller();
    await flush();

    expect(h.querySpy).toHaveBeenCalledWith(expect.stringContaining('pg_try_advisory_lock'));
    expect(h.runPollCycle).toHaveBeenCalledTimes(1);
    expect(h.runPollCycle).toHaveBeenCalledWith(['s1', 's2'], 7, expect.any(Function));
  });

  it('passes a refresh fn that delegates to refreshServerStatus', async () => {
    const {startServerPoller} = await import('./poller');
    startServerPoller();
    await flush();

    const refreshFn = h.runPollCycle.mock.calls[0][2];
    await expect(refreshFn('s1')).resolves.toEqual({ok: true, online: true});
    expect(h.refreshServerStatus).toHaveBeenCalledWith('s1');
  });

  it('does NOT poll when another process holds the lock (follower)', async () => {
    h.lock.granted = false;
    const {startServerPoller} = await import('./poller');
    startServerPoller();
    await flush();

    expect(h.querySpy).toHaveBeenCalledWith(expect.stringContaining('pg_try_advisory_lock'));
    expect(h.runPollCycle).not.toHaveBeenCalled();
    expect(h.endSpy).toHaveBeenCalled(); // released the non-leader connection
  });

  it('is idempotent — a second start does not create a second poller', async () => {
    const {startServerPoller} = await import('./poller');
    startServerPoller();
    startServerPoller();
    await flush();

    expect(h.runPollCycle).toHaveBeenCalledTimes(1);
  });
});
