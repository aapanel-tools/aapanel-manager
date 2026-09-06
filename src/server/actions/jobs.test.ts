import {describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll} from 'vitest';

vi.mock('@/auth', () => ({auth: vi.fn(async () => null)}));

const guard = vi.hoisted(() => ({user: {id: '', email: 'a@b.c', role: 'admin' as 'admin' | 'viewer'}}));
vi.mock('@/lib/auth/guards', async (orig) => {
  const actual = await orig<typeof import('@/lib/auth/guards')>();
  return {
    ...actual,
    requireUser: vi.fn(async () => guard.user),
    requireAdmin: vi.fn(async () => {
      if (guard.user.role !== 'admin') throw new actual.AuthError('forbidden');
      return guard.user;
    }),
  };
});
vi.mock('next/cache', () => ({revalidatePath: vi.fn()}));

import {prisma} from '@/lib/db/prisma';
import {cancelJobAction, createProjectControlJobAction} from './jobs';

const uniq = (): string => Math.random().toString(36).slice(2, 8);
const serverIds: string[] = [];
const jobIds: string[] = [];
const auditIds: string[] = [];
let userId = '';

function fd(fields: Record<string, string>, servers: string[] = serverIds): FormData {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  for (const id of servers) form.append('serverIds', id);
  return form;
}

beforeAll(async () => {
  const user = await prisma.user.create({
    data: {email: `jobact-${uniq()}@t.c`, passwordHash: 'x', role: 'admin'},
  });
  userId = user.id;
  guard.user.id = user.id;
  for (let i = 0; i < 2; i += 1) {
    const s = await prisma.server.create({
      data: {name: `act-${uniq()}`, baseUrl: 'https://h:1', apiSkEnc: 'enc'},
    });
    serverIds.push(s.id);
  }
});

beforeEach(() => {
  guard.user.role = 'admin';
});

// Jobs created here are never meant to run. Left pending they would be picked up by
// the queue tests running in a parallel worker against the same database, so this
// file cleans up after itself rather than leaving work in a shared queue.
afterEach(async () => {
  if (jobIds.length) {
    await prisma.job.updateMany({
      where: {id: {in: jobIds}, status: 'pending'},
      data: {status: 'cancelled'},
    });
  }
});

afterAll(async () => {
  if (jobIds.length) await prisma.job.deleteMany({where: {id: {in: jobIds}}});
  const audits = await prisma.auditLog.findMany({where: {userId}, select: {id: true}});
  auditIds.push(...audits.map((a) => a.id));
  if (auditIds.length) await prisma.auditLog.deleteMany({where: {id: {in: auditIds}}});
  await prisma.server.deleteMany({where: {id: {in: serverIds}}});
  if (userId) await prisma.user.delete({where: {id: userId}}).catch(() => {});
});

describe('createProjectControlJobAction', () => {
  it('queues a pending job over the chosen servers and records it in the journal', async () => {
    const res = await createProjectControlJobAction(
      fd({project: 'api', operation: 'restart', confirm: 'api', stopOnError: 'true'}),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    jobIds.push(res.jobId);

    const job = await prisma.job.findUniqueOrThrow({
      where: {id: res.jobId},
      include: {items: {orderBy: {position: 'asc'}}},
    });
    // Nothing runs inside the request: the leader picks it up (ADR-0005).
    expect(job.status).toBe('pending');
    expect(job.items.map((i) => i.serverId)).toEqual(serverIds);

    const audit = await prisma.auditLog.findFirst({where: {userId, action: 'job.create'}});
    expect(audit?.result).toBe('ok');
  });

  // The confirmation is the last guard between a typo and many restarted projects.
  it('refuses when the confirmation does not repeat the project name', async () => {
    const res = await createProjectControlJobAction(
      fd({project: 'api', operation: 'restart', confirm: 'apj'}),
    );
    expect(res).toMatchObject({ok: false, error: 'validation'});
    if (!res.ok) expect(res.fieldErrors?.confirm).toBeTruthy();
  });

  it('refuses an empty server list', async () => {
    const res = await createProjectControlJobAction(
      fd({project: 'api', operation: 'restart', confirm: 'api'}, []),
    );
    expect(res).toMatchObject({ok: false, error: 'no-servers'});
  });

  it('refuses a server that no longer exists', async () => {
    const res = await createProjectControlJobAction(
      fd({project: 'api', operation: 'restart', confirm: 'api'}, [...serverIds, 'ghost']),
    );
    expect(res).toMatchObject({ok: false, error: 'missing-servers'});
  });

  it('forbids a viewer', async () => {
    guard.user.role = 'viewer';
    const res = await createProjectControlJobAction(
      fd({project: 'api', operation: 'restart', confirm: 'api'}),
    );
    expect(res).toMatchObject({ok: false, error: 'forbidden'});
  });
});

describe('cancelJobAction', () => {
  it('marks a pending job for cancellation and journals it', async () => {
    const created = await createProjectControlJobAction(
      fd({project: 'api', operation: 'stop', confirm: 'api'}),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    jobIds.push(created.jobId);

    const res = await cancelJobAction(created.jobId);
    expect(res.ok).toBe(true);
    const job = await prisma.job.findUniqueOrThrow({where: {id: created.jobId}});
    expect(job.cancelRequestedAt).not.toBeNull();
  });

  it('reports that a finished job cannot be cancelled', async () => {
    const created = await createProjectControlJobAction(
      fd({project: 'api', operation: 'stop', confirm: 'api'}),
    );
    if (!created.ok) throw new Error('setup failed');
    jobIds.push(created.jobId);
    await prisma.job.update({where: {id: created.jobId}, data: {status: 'succeeded'}});

    expect(await cancelJobAction(created.jobId)).toMatchObject({ok: false, message: 'alreadyFinished'});
  });

  it('forbids a viewer', async () => {
    guard.user.role = 'viewer';
    expect(await cancelJobAction('whatever')).toMatchObject({ok: false, message: 'forbidden'});
  });
});
