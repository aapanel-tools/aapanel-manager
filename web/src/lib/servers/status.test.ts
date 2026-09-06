import {describe, it, expect, vi, beforeEach, afterAll} from 'vitest';

vi.mock('@/lib/aapanel', async (orig) => {
  const actual = await orig<typeof import('@/lib/aapanel')>();
  return {...actual, createClientForServer: vi.fn()};
});

import {prisma} from '@/lib/db/prisma';
import {createClientForServer} from '@/lib/aapanel';
import {refreshServerStatus} from './status';

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

  it('writes offline + error when the client throws', async () => {
    const s = await prisma.server.create({data: {name: `st2-${Date.now()}-${Math.random().toString(36).slice(2,6)}`, baseUrl: 'http://h:1', apiSkEnc: 'enc'}});
    ids.push(s.id);
    vi.mocked(createClientForServer).mockReturnValue({collectStatus: vi.fn(async () => {throw new Error('down');})} as never);
    const res = await refreshServerStatus(s.id);
    expect(res.ok).toBe(false);
    expect(res.online).toBe(false);
    const st = await prisma.serverStatus.findUniqueOrThrow({where: {serverId: s.id}});
    expect(st.online).toBe(false);
    expect(st.error).toContain('down');
  });
});
