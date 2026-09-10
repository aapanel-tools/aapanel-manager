import {describe, it, expect, vi, beforeEach, afterAll} from 'vitest';

// Mock @/auth so next-auth doesn't try to import 'next/server' in vitest.
vi.mock('@/auth', () => ({auth: vi.fn(async () => null)}));

// Mock auth guards so we control the acting user/role.
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
// Mock the panel client so no network is hit. probeCertificate is mocked too:
// it opens a real TLS socket, which a unit test must never do.
const panel = vi.hoisted(() => ({
  probeCertificate: vi.fn(async () => ({
    fingerprint: 'AB'.repeat(32),
    subject: 'CN=panel.local',
    issuer: 'CN=panel.local',
    validTo: 'Dec 31 23:59:59 2027 GMT',
    selfSigned: true,
  })),
}));
vi.mock('@/lib/aapanel', async (orig) => {
  const actual = await orig<typeof import('@/lib/aapanel')>();
  return {
    ...actual,
    probeCertificate: panel.probeCertificate,
    createClientForServer: vi.fn(() => ({
      collectStatus: async () => ({online: true, cpu: 7, mem: 8, disk: 9}),
      getSystemTotal: async () => ({online: true, cpu: 7, mem: 8}),
    })),
  };
});
// Next cache no-op
vi.mock('next/cache', () => ({revalidatePath: vi.fn()}));

// The concurrency the refresh path actually runs at — the point of Д-7 is that
// it comes from the same setting the background poller uses, so the double
// records what it was handed rather than assuming a number.
const limiter = vi.hoisted(() => ({lastLimit: -1}));
vi.mock('@/lib/utils/concurrency', async (orig) => {
  const actual = await orig<typeof import('@/lib/utils/concurrency')>();
  return {
    ...actual,
    mapLimit: vi.fn(async <T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) => {
      limiter.lastLimit = limit;
      return actual.mapLimit(items, limit, fn);
    }),
  };
});
const envDouble = vi.hoisted(() => ({workerConcurrency: 16}));
vi.mock('@/env', async (orig) => {
  const actual = await orig<typeof import('@/env')>();
  return {
    ...actual,
    parseEnv: vi.fn(() => ({...actual.parseEnv(), WORKER_CONCURRENCY: envDouble.workerConcurrency})),
  };
});

import {prisma} from '@/lib/db/prisma';
import {decryptSecret} from '@/lib/crypto/secret-box';
import {
  createServerAction,
  deleteServerAction,
  inspectCertificateAction,
  refreshServerStatusAction,
  refreshVisibleStatusesAction,
  updateServerAction,
} from './servers';

const KEY = 'a'.repeat(64);
const cleanupServerIds: string[] = [];
const cleanupAuditIds: string[] = [];
let userId = '';
const uniq = () => Math.random().toString(36).slice(2, 8);

beforeEach(async () => {
  process.env.APP_ENCRYPTION_KEY = KEY;
  guard.user.role = 'admin';
  if (!userId) {
    const u = await prisma.user.create({data: {email: `actor-${uniq()}@t.c`, passwordHash: 'x', role: 'admin'}});
    userId = u.id; guard.user.id = u.id;
  }
});

afterAll(async () => {
  if (cleanupAuditIds.length) await prisma.auditLog.deleteMany({where: {id: {in: cleanupAuditIds}}});
  await prisma.server.deleteMany({where: {id: {in: cleanupServerIds}}});
  if (userId) await prisma.user.delete({where: {id: userId}}).catch(() => {});
});

function fd(obj: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(obj)) f.append(k, v);
  return f;
}

describe('createServerAction', () => {
  it('stores the api_sk encrypted (round-trips) and returns ok', async () => {
    const name = `Act-${uniq()}`;
    const state = await createServerAction({ok: false, error: ''}, fd({
      name, baseUrl: 'https://1.2.3.4:8888', apiSk: 'k'.repeat(16), tlsMode: 'PINNED',
    }));
    expect(state.ok).toBe(true);
    const row = await prisma.server.findFirstOrThrow({where: {name}});
    cleanupServerIds.push(row.id);
    expect(row.apiSkEnc).not.toContain('k'.repeat(16));
    expect(decryptSecret(row.apiSkEnc, KEY)).toBe('k'.repeat(16));
  });

  it('returns field errors on invalid input', async () => {
    const state = await createServerAction({ok: false, error: ''}, fd({name: '', baseUrl: 'nope', apiSk: 'x'}));
    expect(state.ok).toBe(false);
    if (!state.ok) expect(state.fieldErrors?.baseUrl).toBeTruthy();
  });

  it('forbids a viewer from creating', async () => {
    guard.user.role = 'viewer';
    const state = await createServerAction({ok: false, error: ''}, fd({
      name: `Nope-${uniq()}`, baseUrl: 'https://h:1', apiSk: 'k'.repeat(16),
    }));
    expect(state.ok).toBe(false);
  });
});

describe('refreshServerStatusAction', () => {
  it('upserts a ServerStatus from the panel client', async () => {
    const s = await prisma.server.create({data: {name: `Ref-${uniq()}`, baseUrl: 'http://h:1', apiSkEnc: 'enc'}});
    cleanupServerIds.push(s.id);
    const res = await refreshServerStatusAction(s.id);
    expect(res.ok).toBe(true);
    const st = await prisma.serverStatus.findUniqueOrThrow({where: {serverId: s.id}});
    expect(st.online).toBe(true);
    expect(st.cpu).toBe(7);
  });
});

describe('refreshVisibleStatusesAction', () => {
  it('runs at the concurrency the poller runs at, not one of its own (Д-7)', async () => {
    // Both paths do the identical thing — reach out to many panels at once —
    // so an operator who lowers WORKER_CONCURRENCY because their network cannot
    // take it must not find one of the two ignoring them.
    const s = await prisma.server.create({data: {name: `Cc-${uniq()}`, baseUrl: 'http://h:1', apiSkEnc: 'enc'}});
    cleanupServerIds.push(s.id);

    envDouble.workerConcurrency = 3;
    limiter.lastLimit = -1;
    await refreshVisibleStatusesAction([s.id]);
    expect(limiter.lastLimit).toBe(3);

    // Not a constant that happens to equal the default: change it and it follows.
    envDouble.workerConcurrency = 11;
    await refreshVisibleStatusesAction([s.id]);
    expect(limiter.lastLimit).toBe(11);
    envDouble.workerConcurrency = 16;
  });

  it('counts refreshed and failed separately when given one valid and one bogus id', async () => {
    const s = await prisma.server.create({data: {name: `Vis-${uniq()}`, baseUrl: 'http://h:1', apiSkEnc: 'enc'}});
    cleanupServerIds.push(s.id);
    const res = await refreshVisibleStatusesAction([s.id, 'nonexistent-id-xyz']);
    expect(res.ok).toBe(true);
    expect(res.refreshed).toBe(1);
    expect(res.failed).toBe(1);
  });
});

describe('deleteServerAction', () => {
  it('deletes a server (cascades status) and records the deletion in the audit log', async () => {
    const s = await prisma.server.create({data: {name: `Del-${uniq()}`, baseUrl: 'http://h:1', apiSkEnc: 'enc'}});
    const res = await deleteServerAction(fd({id: s.id, confirm: s.name}));
    expect(res.ok).toBe(true);
    expect(await prisma.server.findUnique({where: {id: s.id}})).toBeNull();
    // The deletion MUST be audited even though the server FK is gone (id lives in target).
    const audit = await prisma.auditLog.findFirst({where: {action: 'server.delete', target: {contains: s.id}}});
    expect(audit).not.toBeNull();
    if (audit) cleanupAuditIds.push(audit.id);
  });

  it('refuses without the typed name, and the server survives', async () => {
    // The guard is here, not only in the dialog. This row holds the panel's
    // api_sk and its pinned fingerprint; a mis-click costs re-entering a key
    // that is equal to root on that machine.
    const s = await prisma.server.create({data: {name: `Keep-${uniq()}`, baseUrl: 'http://h:1', apiSkEnc: 'enc'}});
    cleanupServerIds.push(s.id);

    const missing = await deleteServerAction(fd({id: s.id}));
    expect(missing.ok).toBe(false);
    const wrong = await deleteServerAction(fd({id: s.id, confirm: 'not the name'}));
    expect(wrong.ok).toBe(false);

    expect(await prisma.server.findUnique({where: {id: s.id}})).not.toBeNull();
  });

  it('keeps the server when the journal cannot be written (Д-19)', async () => {
    // The invariant: an irreversible change and its journal line stand or fall
    // together. Forced the honest way — the acting user does not exist, so the
    // AuditLog FK rejects the insert, which is exactly the failure seen in the
    // wild. Before the transaction, the server vanished and nothing recorded it.
    const s = await prisma.server.create({data: {name: `Tx-${uniq()}`, baseUrl: 'http://h:1', apiSkEnc: 'enc'}});
    cleanupServerIds.push(s.id);
    const realUser = guard.user.id;
    guard.user.id = 'no-such-user-id';
    try {
      const res = await deleteServerAction(fd({id: s.id, confirm: s.name}));
      expect(res.ok).toBe(false);
      // And the operator is told why nothing happened, rather than being
      // handed a database constraint message about a table they never asked
      // about.
      if (!res.ok) expect(res.message).toMatch(/journal/i);
    } finally {
      guard.user.id = realUser;
    }

    expect(await prisma.server.findUnique({where: {id: s.id}})).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Certificate pinning (ADR-0002)
// ---------------------------------------------------------------------------

describe('inspectCertificateAction', () => {
  it('returns the certificate the panel presents, grouped for reading off', async () => {
    const res = await inspectCertificateAction(fd({baseUrl: 'https://1.2.3.4:8888'}));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.certificate.fingerprint).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
      expect(res.certificate.selfSigned).toBe(true);
      expect(res.certificate.subject).toBe('CN=panel.local');
    }
  });

  it('forbids a viewer', async () => {
    guard.user.role = 'viewer';
    const res = await inspectCertificateAction(fd({baseUrl: 'https://1.2.3.4:8888'}));
    expect(res).toMatchObject({ok: false, message: 'forbidden'});
  });

  it('rejects a non-http(s) address without opening a connection', async () => {
    panel.probeCertificate.mockClear();
    const res = await inspectCertificateAction(fd({baseUrl: 'ftp://h'}));
    expect(res).toMatchObject({ok: false, message: 'validation'});
    expect(panel.probeCertificate).not.toHaveBeenCalled();
  });

  it('reports an unreachable panel instead of throwing', async () => {
    panel.probeCertificate.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
    const res = await inspectCertificateAction(fd({baseUrl: 'https://1.2.3.4:8888'}));
    expect(res.ok).toBe(false);
  });
});

describe('updateServerAction — certificate pin', () => {
  async function collectAudits(serverId: string): Promise<void> {
    const rows = await prisma.auditLog.findMany({where: {serverId}, select: {id: true}});
    cleanupAuditIds.push(...rows.map((r) => r.id));
  }

  it('re-pins on an explicit fingerprint and journals it separately from the field edit', async () => {
    const name = `Pin-${uniq()}`;
    const s = await prisma.server.create({
      data: {name, baseUrl: 'https://h:1', apiSkEnc: 'enc', tlsMode: 'PINNED', tlsPinSha256: 'AA'.repeat(32)},
    });
    cleanupServerIds.push(s.id);

    const state = await updateServerAction({ok: false, error: ''}, fd({
      id: s.id, name, baseUrl: 'https://h:1', tlsMode: 'PINNED', tlsPinSha256: 'bb:'.repeat(31) + 'bb',
    }));
    expect(state.ok).toBe(true);

    const row = await prisma.server.findUniqueOrThrow({where: {id: s.id}});
    expect(row.tlsPinSha256).toBe('BB'.repeat(32));
    const repin = await prisma.auditLog.findFirst({where: {serverId: s.id, action: 'server.tls.repin'}});
    expect(repin).not.toBeNull();
    await collectAudits(s.id);
  });

  // The stored pin identified the previous panel; carrying it over would either
  // block a legitimate server or vouch for a different one.
  it('clears the pin when the address changes, so the new panel is pinned afresh', async () => {
    const name = `Moved-${uniq()}`;
    const s = await prisma.server.create({
      data: {name, baseUrl: 'https://old:1', apiSkEnc: 'enc', tlsMode: 'PINNED', tlsPinSha256: 'CC'.repeat(32)},
    });
    cleanupServerIds.push(s.id);

    const state = await updateServerAction({ok: false, error: ''}, fd({
      id: s.id, name, baseUrl: 'https://new:1', tlsMode: 'PINNED',
    }));
    expect(state.ok).toBe(true);
    const row = await prisma.server.findUniqueOrThrow({where: {id: s.id}});
    expect(row.tlsPinSha256).toBeNull();
    await collectAudits(s.id);
  });

  it('rejects a fingerprint that is not a full SHA-256', async () => {
    const name = `Short-${uniq()}`;
    const s = await prisma.server.create({
      data: {name, baseUrl: 'https://h:1', apiSkEnc: 'enc', tlsMode: 'PINNED'},
    });
    cleanupServerIds.push(s.id);

    const state = await updateServerAction({ok: false, error: ''}, fd({
      id: s.id, name, baseUrl: 'https://h:1', tlsMode: 'PINNED', tlsPinSha256: 'AABBCC',
    }));
    expect(state.ok).toBe(false);
    if (!state.ok) expect(state.fieldErrors?.tlsPinSha256).toBeTruthy();
    await collectAudits(s.id);
  });
});
