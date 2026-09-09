import {describe, it, expect, beforeAll, afterAll} from 'vitest';
import type {Prisma} from '@prisma/client';
import {prisma} from '@/lib/db/prisma';
import {getFleetOverview, type FleetCounts} from './overview';

// The summary counts the whole table, which is shared with every other test file
// and with whatever a crashed run left behind. Absolute numbers would therefore
// assert about other people's rows; every count check below is a delta measured
// around this file's own fixtures.
const run = Math.random().toString(36).slice(2, 8);
const ids: Record<string, string> = {};
let before: FleetCounts;

const name = (k: string) => `ov-${k}-${run}`;

/** The status fields a fixture cares about; the id is supplied here, not by the caller. */
type StatusFixture = Omit<Prisma.ServerStatusUncheckedCreateInput, 'serverId'>;

async function server(key: string, status?: StatusFixture) {
  const s = await prisma.server.create({
    data: {name: name(key), tag: `ov-${run}`, baseUrl: 'http://h:1', apiSkEnc: 'enc'},
  });
  ids[key] = s.id;
  if (status) await prisma.serverStatus.create({data: {...status, serverId: s.id}});
  return s.id;
}

/** Older than three poll intervals (3 × 60 s by default), so it reads as stale. */
const longAgo = new Date(Date.now() - 10 * 60_000);

beforeAll(async () => {
  before = (await getFleetOverview()).counts;
  await server('healthy', {online: true, cpu: 4, mem: 20, disk: 30, lastCheckedAt: new Date()});
  await server('down', {online: false, error: 'panel unreachable', lastCheckedAt: new Date()});
  await server('fulldisk', {online: true, mem: 20, disk: 93, lastCheckedAt: new Date()});
  await server('tightmem', {online: true, mem: 95, disk: 10, lastCheckedAt: new Date()});
  await server('stale', {online: true, mem: 10, disk: 10, lastCheckedAt: longAgo});
  await server('never'); // added but never polled — no status row at all
});

afterAll(async () => {
  const all = Object.values(ids);
  await prisma.serverStatus.deleteMany({where: {serverId: {in: all}}});
  await prisma.server.deleteMany({where: {id: {in: all}}});
});

const mine = (rows: {name: string}[]) => rows.filter((r) => r.name.endsWith(run));
const find = (rows: {name: string}[], key: string) => rows.find((r) => r.name === name(key));

describe('getFleetOverview counts', () => {
  it('counts online, offline and never-polled servers separately', async () => {
    const {counts} = await getFleetOverview();
    expect(counts.total - before.total).toBe(6);
    expect(counts.online - before.online).toBe(4); // healthy, fulldisk, tightmem, stale
    expect(counts.offline - before.offline).toBe(1); // down
    // "never looked" is not the same as "looked and found down": a fleet where
    // every server is unchecked is a broken poller, not an outage.
    expect(counts.unchecked - before.unchecked).toBe(1);
  });
});

describe('getFleetOverview attention list', () => {
  it('leaves a healthy server out of it', async () => {
    const {attention} = await getFleetOverview();
    expect(find(attention, 'healthy')).toBeUndefined();
  });

  it('does not list a server that has never been polled', async () => {
    // It is counted, not listed: "we have not looked yet" says nothing about
    // the server, and putting it among real problems would dilute them.
    const {attention} = await getFleetOverview();
    expect(find(attention, 'never')).toBeUndefined();
  });

  it('reports an offline server with the panel wording it failed with', async () => {
    const {attention} = await getFleetOverview();
    const row = find(attention, 'down');
    expect(row).toMatchObject({reason: 'offline', value: null, error: 'panel unreachable'});
  });

  it('reports a full disk with its percentage', async () => {
    const {attention} = await getFleetOverview();
    expect(find(attention, 'fulldisk')).toMatchObject({reason: 'disk', value: 93});
  });

  it('reports memory over the threshold', async () => {
    const {attention} = await getFleetOverview();
    expect(find(attention, 'tightmem')).toMatchObject({reason: 'memory', value: 95});
  });

  it('reports a reading nobody has refreshed as stale, not as healthy', async () => {
    const {attention} = await getFleetOverview();
    expect(find(attention, 'stale')).toMatchObject({reason: 'stale'});
  });

  it('puts what is down above what is merely full', async () => {
    const {attention} = await getFleetOverview();
    const order = mine(attention).map((r) => r.name);
    expect(order.indexOf(name('down'))).toBeLessThan(order.indexOf(name('fulldisk')));
    expect(order.indexOf(name('stale'))).toBeLessThan(order.indexOf(name('fulldisk')));
  });

  it('reports each server once, under its worst reason', async () => {
    // The stale fixture is also within thresholds; an offline-and-stale server
    // must not appear twice and push a live problem down the list.
    const {attention} = await getFleetOverview();
    const names = mine(attention).map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('reports the thresholds it judged by, so the reader can check them', async () => {
    const {thresholds} = await getFleetOverview();
    expect(thresholds.diskWarnPercent).toBe(85);
    expect(thresholds.memWarnPercent).toBe(90);
    expect(thresholds.staleAfterMs).toBe(180_000);
  });
});
