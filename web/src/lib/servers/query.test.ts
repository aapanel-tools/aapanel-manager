import {describe, it, expect, beforeAll, afterAll} from 'vitest';
import {prisma} from '@/lib/db/prisma';
import {listServers} from './query';
import {serverListParamsSchema} from '@/lib/validation/server';

const ids: string[] = [];

// Fixture names and tags are unique per run. listServers queries the whole table,
// which is shared with every other test file and with anything a crashed earlier
// run left behind — fixed names would make the assertions depend on that.
const run = Math.random().toString(36).slice(2, 8);
const ALPHA = `q-alpha-${run}`;
const HOME = `eu-${run}`;

beforeAll(async () => {
  for (const [name, tag] of [[ALPHA, HOME], [`q-bravo-${run}`, `us-${run}`], [`q-charlie-${run}`, HOME]] as const) {
    const s = await prisma.server.create({data: {name, tag, baseUrl: 'http://h:1', apiSkEnc: 'enc'}});
    ids.push(s.id);
  }
  await prisma.serverStatus.create({data: {serverId: ids[0], online: true, cpu: 5, mem: 10}});
});

afterAll(async () => {
  await prisma.serverStatus.deleteMany({where: {serverId: {in: ids}}});
  await prisma.server.deleteMany({where: {id: {in: ids}}});
});

describe('listServers', () => {
  it('filters by search term and never leaks apiSkEnc', async () => {
    const {rows, total} = await listServers(serverListParamsSchema.parse({q: ALPHA}));
    expect(total).toBe(1);
    expect(rows[0].name).toBe(ALPHA);
    expect((rows[0] as unknown as Record<string, unknown>).apiSkEnc).toBeUndefined();
  });

  it('filters by tag and paginates', async () => {
    const {rows, total} = await listServers(serverListParamsSchema.parse({tag: HOME, pageSize: '5', page: '1'}));
    expect(total).toBe(2);
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it('filters by status=unknown (servers without a status row)', async () => {
    const {rows} = await listServers(serverListParamsSchema.parse({status: 'unknown', tag: HOME}));
    expect(rows.every((r) => r.online === null)).toBe(true);
  });

  it('filters by status=online', async () => {
    const {rows} = await listServers(serverListParamsSchema.parse({status: 'online', q: ALPHA}));
    expect(rows).toHaveLength(1);
    expect(rows[0].online).toBe(true);
  });
});
