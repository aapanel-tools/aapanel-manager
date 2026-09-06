import {describe, it, expect, beforeAll, beforeEach, afterAll, vi} from 'vitest';
import type {AaPanelClient} from '@/lib/aapanel';
import {prisma} from '@/lib/db/prisma';
import {
  JobRejected,
  createJob,
  reapInterruptedJobs,
  requestCancel,
  runNextJob,
} from './queue';

const uniq = (): string => Math.random().toString(36).slice(2, 8);
const serverIds: string[] = [];
const jobIds: string[] = [];
let userId = '';

/** A panel whose answer is decided per server name, so tests need no network. */
function fakeClientFor(behaviour: Record<string, 'ok' | 'refuse' | 'throw'>) {
  const nameById = new Map<string, string>();
  return {
    calls: [] as string[],
    async clientFor(serverId: string): Promise<AaPanelClient> {
      const name = nameById.get(serverId) ?? serverId;
      const verdict = behaviour[name] ?? 'ok';
      if (verdict === 'throw') throw new Error(`cannot reach ${name}`);
      return {
        batchOperation: async () => ({
          msg: '',
          msg_list: [{name: 'app', status: verdict === 'ok', msg: verdict === 'ok' ? 'done' : 'refused'}],
        }),
      } as unknown as AaPanelClient;
    },
    register(id: string, name: string) {
      nameById.set(id, name);
    },
  };
}

beforeAll(async () => {
  const user = await prisma.user.create({
    data: {email: `jobs-${uniq()}@t.c`, passwordHash: 'x', role: 'admin'},
  });
  userId = user.id;
  for (const name of ['alpha', 'bravo', 'charlie']) {
    const s = await prisma.server.create({
      data: {name: `${name}-${uniq()}`, baseUrl: 'https://h:1', apiSkEnc: 'enc'},
    });
    serverIds.push(s.id);
  }
});

afterAll(async () => {
  if (jobIds.length) await prisma.job.deleteMany({where: {id: {in: jobIds}}});
  await prisma.server.deleteMany({where: {id: {in: serverIds}}});
  if (userId) await prisma.user.delete({where: {id: userId}}).catch(() => {});
});

async function newJob(over: Partial<Parameters<typeof createJob>[0]> = {}): Promise<string> {
  const {id} = await createJob({
    kind: 'project.control',
    params: {project: 'app', operation: 'restart'},
    serverIds,
    createdById: userId,
    ...over,
  });
  jobIds.push(id);
  return id;
}

/** Reads a job with its items in execution order. */
async function readJob(id: string) {
  return prisma.job.findUniqueOrThrow({
    where: {id},
    include: {items: {orderBy: {position: 'asc'}}},
  });
}

describe('createJob', () => {
  it('records the servers in order and copies their names', async () => {
    const id = await newJob();
    const job = await readJob(id);

    expect(job.status).toBe('pending');
    expect(job.stopOnError).toBe(true);
    expect(job.items).toHaveLength(3);
    expect(job.items.map((i) => i.position)).toEqual([0, 1, 2]);
    expect(job.items.map((i) => i.serverId)).toEqual(serverIds);
    // The report has to survive the server being deleted afterwards.
    for (const item of job.items) expect(item.serverName).toMatch(/-/);
  });

  it('refuses an unknown kind, an empty list, and a list over the ceiling', async () => {
    await expect(newJob({kind: 'nope.nothing'})).rejects.toBeInstanceOf(JobRejected);
    await expect(newJob({serverIds: []})).rejects.toBeInstanceOf(JobRejected);
    await expect(newJob({maxServers: 2})).rejects.toBeInstanceOf(JobRejected);
  });

  it('refuses parameters that do not fit the kind', async () => {
    await expect(newJob({params: {project: 'app', operation: 'detonate'}})).rejects.toThrow();
    await expect(newJob({params: {operation: 'restart'}})).rejects.toThrow();
  });

  // A server that vanished between choosing and confirming must not quietly drop out
  // of a list the operator already approved.
  it('refuses when one of the chosen servers no longer exists', async () => {
    await expect(newJob({serverIds: [...serverIds, 'gone-forever']})).rejects.toBeInstanceOf(
      JobRejected,
    );
  });
});

describe('runNextJob', () => {
  // runNextJob claims the OLDEST pending job, so each test must be the only one with
  // work waiting. Jobs left pending by earlier tests in this file are retired here —
  // explicitly, rather than as a side effect of some other test happening to run first.
  beforeEach(async () => {
    if (jobIds.length) {
      await prisma.job.updateMany({
        where: {id: {in: jobIds}, status: 'pending'},
        data: {status: 'cancelled'},
      });
    }
  });

  // Note: there is deliberately no "returns false on an empty queue" test. It would
  // assert something about the whole Job table, which no test can own while the suite
  // runs files in parallel against one database.

  it('runs every server and reports success', async () => {
    const id = await newJob();
    const panel = fakeClientFor({});

    expect(await runNextJob({clientFor: panel.clientFor, concurrency: 2})).toBe(true);
    const job = await readJob(id);
    expect(job.status).toBe('succeeded');
    expect(job.startedAt).not.toBeNull();
    expect(job.finishedAt).not.toBeNull();
    expect(job.items.map((i) => i.status)).toEqual(['succeeded', 'succeeded', 'succeeded']);
    expect(job.items[0]!.message).toBe('done');
  });

  // The canary is the whole point of staged rollout: a bad parameter reaches one
  // machine, not fifty.
  it('stops after the canary fails and never touches the rest', async () => {
    const id = await newJob();
    const job = await readJob(id);
    const panel = fakeClientFor({});
    panel.register(job.items[0]!.serverId!, 'canary');

    const failing = {
      clientFor: async (): Promise<AaPanelClient> => {
        throw new Error('panel unreachable');
      },
      concurrency: 2,
    };
    // Only the first item runs; the rest are skipped, not failed.
    expect(await runNextJob(failing)).toBe(true);
    const after = await readJob(id);
    expect(after.status).toBe('failed');
    expect(after.items.map((i) => i.status)).toEqual(['failed', 'skipped', 'skipped']);
    expect(after.items[0]!.message).toContain('panel unreachable');
    expect(after.items[1]!.message).toContain('stopped');
  });

  it('keeps going past a failure when asked not to stop', async () => {
    const id = await newJob({stopOnError: false});
    let call = 0;
    const deps = {
      clientFor: async (): Promise<AaPanelClient> => {
        call += 1;
        if (call === 1) throw new Error('first one is down');
        return {
          batchOperation: async () => ({msg: '', msg_list: [{name: 'app', status: true, msg: 'done'}]}),
        } as unknown as AaPanelClient;
      },
      concurrency: 2,
    };

    expect(await runNextJob(deps)).toBe(true);
    const job = await readJob(id);
    expect(job.status).toBe('failed');
    const statuses = job.items.map((i) => i.status).sort();
    expect(statuses).toEqual(['failed', 'succeeded', 'succeeded']);
  });

  it('treats a panel refusal as a failure even though the request succeeded', async () => {
    const id = await newJob();
    const deps = {
      clientFor: async (): Promise<AaPanelClient> =>
        ({
          batchOperation: async () => ({
            msg: '',
            msg_list: [{name: 'app', status: false, msg: 'project not found'}],
          }),
        }) as unknown as AaPanelClient,
      concurrency: 2,
    };

    expect(await runNextJob(deps)).toBe(true);
    const job = await readJob(id);
    expect(job.status).toBe('failed');
    expect(job.items[0]!.status).toBe('failed');
    expect(job.items[0]!.message).toBe('project not found');
  });

  it('stops at the next server when cancellation is asked for', async () => {
    const id = await newJob({stopOnError: false});
    let started = 0;
    const deps = {
      clientFor: async (): Promise<AaPanelClient> => {
        started += 1;
        // Cancel while the canary is in flight: it must finish, the rest must not start.
        if (started === 1) await requestCancel(id);
        return {
          batchOperation: async () => ({msg: '', msg_list: [{name: 'app', status: true, msg: 'done'}]}),
        } as unknown as AaPanelClient;
      },
      concurrency: 2,
    };

    expect(await runNextJob(deps)).toBe(true);
    const job = await readJob(id);
    expect(job.status).toBe('cancelled');
    expect(job.items[0]!.status).toBe('succeeded');
    expect(job.items.slice(1).map((i) => i.status)).toEqual(['skipped', 'skipped']);
    expect(job.items[1]!.message).toContain('Cancelled');
    // The server already in flight was never abandoned half-done.
    expect(started).toBe(1);
  });

  it('fails a job whose kind this build no longer knows, instead of hanging', async () => {
    const id = await newJob();
    await prisma.job.update({where: {id}, data: {kind: 'removed.kind'}});
    const panel = fakeClientFor({});

    expect(await runNextJob({clientFor: panel.clientFor, concurrency: 2})).toBe(true);
    const job = await readJob(id);
    expect(job.status).toBe('failed');
    expect(job.items.every((i) => i.status === 'skipped')).toBe(true);
  });
});

describe('requestCancel', () => {
  it('does nothing to a job that already finished', async () => {
    const id = await newJob();
    await prisma.job.update({where: {id}, data: {status: 'succeeded'}});
    expect(await requestCancel(id)).toBe(false);
  });
});

describe('reapInterruptedJobs', () => {
  // A restart in the middle leaves rows claiming work is in progress that nobody
  // is doing. Left alone they stay that way forever.
  it('turns a job left mid-flight into an honest failure', async () => {
    const id = await newJob();
    const job = await readJob(id);
    await prisma.job.update({where: {id}, data: {status: 'running', startedAt: new Date()}});
    await prisma.jobItem.update({where: {id: job.items[0]!.id}, data: {status: 'running'}});

    const reaped = await reapInterruptedJobs();
    expect(reaped).toBeGreaterThanOrEqual(1);

    const after = await readJob(id);
    expect(after.status).toBe('failed');
    expect(after.items[0]!.status).toBe('failed');
    expect(after.items[0]!.message).toContain('Interrupted');
    expect(after.items[1]!.status).toBe('skipped');
  });

  it('reports nothing to do when no job was running', async () => {
    await prisma.job.updateMany({where: {id: {in: jobIds}}, data: {status: 'succeeded'}});
    expect(await reapInterruptedJobs()).toBe(0);
  });
});

afterAll(() => vi.restoreAllMocks());
