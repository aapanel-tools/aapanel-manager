import {describe, it, expect, vi, beforeEach, afterAll} from 'vitest';

vi.mock('@/lib/aapanel', async (orig) => {
  const actual = await orig<typeof import('@/lib/aapanel')>();
  return {...actual, createClientForServer: vi.fn()};
});

import {prisma} from '@/lib/db/prisma';
import {createClientForServer} from '@/lib/aapanel';
import {AaPanelError} from '@/lib/aapanel/types';
import {refreshServerStatus} from './status';
import {ServerNotFoundError} from './creds';

const ids: string[] = [];
beforeEach(() => {process.env.APP_ENCRYPTION_KEY = 'a'.repeat(64); vi.restoreAllMocks?.();});
afterAll(async () => {
  await prisma.serverStatus.deleteMany({where: {serverId: {in: ids}}});
  await prisma.server.deleteMany({where: {id: {in: ids}}});
});

describe('refreshServerStatus', () => {
  it('writes an online snapshot to the cache', async () => {
    const s = await prisma.server.create({data: {name: `st-${Date.now()}-${Math.random().toString(36).slice(2,6)}`, baseUrl: 'http://h:1', apiSkEnc: 'enc'}});
    ids.push(s.id);
    vi.mocked(createClientForServer).mockReturnValue({collectStatus: vi.fn(async () => ({online: true, cpu: 11, mem: 22, disk: 33}))} as never);
    const res = await refreshServerStatus(s.id);
    expect(res.ok).toBe(true);
    expect(res.online).toBe(true);
    const st = await prisma.serverStatus.findUniqueOrThrow({where: {serverId: s.id}});
    expect(st).toMatchObject({online: true, cpu: 11, mem: 22, disk: 33, error: null});
  });

  it('keeps the kind of a panel failure and the panel’s own words, not a sentence of ours (ADR-0012)', async () => {
    const s = await prisma.server.create({data: {name: `st2-${Date.now()}-${Math.random().toString(36).slice(2,6)}`, baseUrl: 'http://h:1', apiSkEnc: 'enc'}});
    ids.push(s.id);
    const refusal = new AaPanelError('panel_error', 'IP validation failed');
    vi.mocked(createClientForServer).mockReturnValue({collectStatus: vi.fn(async () => {throw refusal;})} as never);
    const res = await refreshServerStatus(s.id);
    expect(res).toMatchObject({ok: false, online: false});
    // Handed back as thrown, for an action to word in its reader's language.
    expect(res.error).toBe(refusal);
    const st = await prisma.serverStatus.findUniqueOrThrow({where: {serverId: s.id}});
    // The summary builds the phrase from the kind; describeError()'s English
    // sentence used to be stored here and shown as it was.
    expect(st).toMatchObject({online: false, errorKind: 'panel_error', error: 'IP validation failed'});
  });

  it('stores a failure of the app’s own as such, with none of its text (Д-35)', async () => {
    const s = await prisma.server.create({data: {name: `st3-${Date.now()}-${Math.random().toString(36).slice(2,6)}`, baseUrl: 'http://h:1', apiSkEnc: 'enc'}});
    ids.push(s.id);
    vi.mocked(createClientForServer).mockRejectedValue(new Error('Unsupported state or unable to authenticate data') as never);
    const res = await refreshServerStatus(s.id);
    expect(res.ok).toBe(false);
    const st = await prisma.serverStatus.findUniqueOrThrow({where: {serverId: s.id}});
    expect(st).toMatchObject({online: false, errorKind: 'unknown', error: null});
  });

  it('clears the stored failure once a poll succeeds', async () => {
    const s = await prisma.server.create({data: {name: `st4-${Date.now()}-${Math.random().toString(36).slice(2,6)}`, baseUrl: 'http://h:1', apiSkEnc: 'enc'}});
    ids.push(s.id);
    vi.mocked(createClientForServer).mockReturnValue({collectStatus: vi.fn(async () => {throw new AaPanelError('timeout', 'took too long');})} as never);
    await refreshServerStatus(s.id);
    vi.mocked(createClientForServer).mockReturnValue({collectStatus: vi.fn(async () => ({online: true, cpu: 1, mem: 2, disk: 3}))} as never);
    await refreshServerStatus(s.id);
    const st = await prisma.serverStatus.findUniqueOrThrow({where: {serverId: s.id}});
    expect(st).toMatchObject({online: true, errorKind: null, error: null});
  });

  it('says a server that is gone is gone, and caches nothing for it (Д-34)', async () => {
    vi.mocked(createClientForServer).mockClear();
    await expect(refreshServerStatus('st-no-such-server')).rejects.toBeInstanceOf(ServerNotFoundError);
    expect(await prisma.serverStatus.findUnique({where: {serverId: 'st-no-such-server'}})).toBeNull();
    expect(createClientForServer).not.toHaveBeenCalled();
  });
});
