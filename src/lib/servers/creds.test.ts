import {describe, it, expect, afterAll} from 'vitest';
import {prisma} from '@/lib/db/prisma';
import {loadServerCreds, ServerNotFoundError} from './creds';

const ids: string[] = [];

afterAll(async () => {
  await prisma.server.deleteMany({where: {id: {in: ids}}});
});

describe('loadServerCreds', () => {
  it('reads what a panel client needs, and nothing more', async () => {
    const s = await prisma.server.create({
      data: {name: `creds-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, baseUrl: 'http://h:1', apiSkEnc: 'enc'},
    });
    ids.push(s.id);

    const creds = await loadServerCreds(s.id);

    expect(Object.keys(creds).sort()).toEqual(['apiSkEnc', 'baseUrl', 'id', 'tlsMode', 'tlsPinSha256']);
    expect(creds).toMatchObject({id: s.id, baseUrl: 'http://h:1', apiSkEnc: 'enc', tlsPinSha256: null});
  });

  it("says a missing server is missing, without the database's own words (Д-34)", async () => {
    const err: unknown = await loadServerCreds('creds-no-such-server').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ServerNotFoundError);
    expect((err as ServerNotFoundError).serverId).toBe('creds-no-such-server');
    // The message may reach an operator (a job step's result): no query text,
    // no internal paths.
    expect((err as Error).message).not.toMatch(/prisma|invocation|findUnique|P2025|\.next/i);
  });

  it('does not trust the id to be a string: an action is a public endpoint', async () => {
    for (const id of ['', undefined, null, 42, {}]) {
      await expect(loadServerCreds(id)).rejects.toBeInstanceOf(ServerNotFoundError);
    }
  });
});
