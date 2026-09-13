import {inspect} from 'node:util';
import {describe, it, expect, vi, beforeEach, afterAll, afterEach} from 'vitest';

// Mock @/auth so next-auth does not try to import 'next/server' in vitest.
vi.mock('@/auth', () => ({auth: vi.fn(async () => null)}));

const guard = vi.hoisted(() => ({
  user: {id: '', email: 'a@b.c', role: 'admin' as 'admin' | 'viewer'},
  authenticated: true,
}));
vi.mock('@/lib/auth/guards', async (orig) => {
  const actual = await orig<typeof import('@/lib/auth/guards')>();
  return {
    ...actual,
    requireUser: vi.fn(async () => {
      if (!guard.authenticated) throw new actual.AuthError('unauthenticated');
      return guard.user;
    }),
    requireAdmin: vi.fn(async () => {
      if (!guard.authenticated) throw new actual.AuthError('unauthenticated');
      if (guard.user.role !== 'admin') throw new actual.AuthError('forbidden');
      return guard.user;
    }),
  };
});

const panel = vi.hoisted(() => ({
  listDirectory: vi.fn(),
  readFile: vi.fn(),
}));
vi.mock('@/lib/aapanel', async (orig) => {
  const actual = await orig<typeof import('@/lib/aapanel')>();
  return {...actual, createClientForServer: vi.fn(async () => panel)};
});

// The real journal, with a seam to make it fail on demand.
vi.mock('@/lib/audit', async (orig) => {
  const actual = await orig<typeof import('@/lib/audit')>();
  return {...actual, beginAudit: vi.fn(actual.beginAudit)};
});

import {prisma} from '@/lib/db/prisma';
import {AaPanelError} from '@/lib/aapanel';
import {AuditUnavailableError, beginAudit} from '@/lib/audit';
import {log} from '@/log';
import {listDirectoryAction, readFileAction} from './files';

/** Looks like a credential on purpose, so a leak into a log line is easy to spot. */
const SECRET_LINE = "define('DB_PASSWORD', 'stub-not-a-real-secret');";

const cleanupServerIds: string[] = [];
let userId = '';
let serverId = '';
const uniq = () => Math.random().toString(36).slice(2, 8);

beforeEach(async () => {
  guard.authenticated = true;
  guard.user.role = 'admin';
  panel.listDirectory.mockReset().mockImplementation(async (path: string) => ({
    path,
    items: [
      {name: 'wp-content', kind: 'dir', size: 4096, modifiedAt: 1775798099, mode: '755', owner: 'www', linkTarget: ''},
      {name: 'wp-config.php', kind: 'file', size: 3100, modifiedAt: 1775798099, mode: '600', owner: 'www', linkTarget: ''},
    ],
    failures: [],
    truncations: [],
  }));
  panel.readFile.mockReset().mockImplementation(async (path: string) => ({
    kind: 'text',
    path,
    size: SECRET_LINE.length,
    encoding: 'utf-8',
    text: SECRET_LINE,
  }));
  if (!userId) {
    const u = await prisma.user.create({
      data: {email: `files-actor-${uniq()}@t.c`, passwordHash: 'x', role: 'admin'},
    });
    userId = u.id;
    guard.user.id = u.id;
  }
  if (!serverId) {
    const s = await prisma.server.create({
      data: {name: `files-srv-${uniq()}`, baseUrl: 'http://h:1', apiSkEnc: 'enc'},
    });
    serverId = s.id;
    cleanupServerIds.push(serverId);
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({where: {serverId: {in: cleanupServerIds}}});
  await prisma.server.deleteMany({where: {id: {in: cleanupServerIds}}});
  if (userId) await prisma.user.delete({where: {id: userId}}).catch(() => {});
});

const journalFor = (target: string) =>
  prisma.auditLog.findMany({where: {serverId, action: 'file.read', target}});

describe('listDirectoryAction', () => {
  it('lists a directory for an administrator, under the address it was asked for', async () => {
    const res = await listDirectoryAction(serverId, '/www//wwwroot/example/');

    expect(res).toMatchObject({ok: true, path: '/www/wwwroot/example', truncations: []});
    expect(res.ok && res.entries.map((e) => e.name)).toEqual(['wp-content', 'wp-config.php']);
    expect(panel.listDirectory).toHaveBeenCalledWith('/www/wwwroot/example');
  });

  it('refuses a viewer: the section is not theirs (ADR-0008)', async () => {
    guard.user.role = 'viewer';
    expect(await listDirectoryAction(serverId, '/www')).toEqual({ok: false, message: 'forbidden'});
    expect(panel.listDirectory).not.toHaveBeenCalled();
  });

  it('refuses without a session', async () => {
    guard.authenticated = false;
    expect(await listDirectoryAction(serverId, '/www')).toEqual({ok: false, message: 'unauthenticated'});
  });

  it('refuses a path it would not send, without asking the panel', async () => {
    for (const bad of ['/www/../etc', 'www', '', '/www\n/forged', 42, undefined]) {
      expect(await listDirectoryAction(serverId, bad)).toEqual({ok: false, message: 'validation'});
    }
    expect(panel.listDirectory).not.toHaveBeenCalled();
  });

  it("reports the panel's refusal instead of an empty directory", async () => {
    panel.listDirectory.mockRejectedValueOnce(
      new AaPanelError('panel_error', 'Указанный каталог не существует!'),
    );
    const res = await listDirectoryAction(serverId, '/nope');
    expect(res.ok).toBe(false);
    expect(!res.ok && res.message).toContain('Указанный каталог не существует!');
  });

  it('journals nothing: browsing folders is not the act worth a line', async () => {
    await listDirectoryAction(serverId, '/www/wwwroot');
    const rows = await prisma.auditLog.count({where: {serverId, target: '/www/wwwroot'}});
    expect(rows).toBe(0);
  });
});

describe('readFileAction', () => {
  it('returns the contents and journals who opened which file', async () => {
    const target = `/www/wwwroot/${uniq()}/wp-config.php`;
    const res = await readFileAction(serverId, target);

    expect(res).toEqual({
      ok: true,
      file: {kind: 'text', path: target, size: SECRET_LINE.length, encoding: 'utf-8', text: SECRET_LINE},
    });
    const rows = await journalFor(target);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({result: 'ok', userId});
  });

  it('journals the intent before the panel is asked, then the outcome (Д-19)', async () => {
    // Read from inside the panel call, the only moment that can tell the two
    // orderings apart. A secret shown and never recorded is the hole this closes.
    const target = `/www/wwwroot/${uniq()}/.env`;
    let resultDuringCall = 'no journal line at all';
    panel.readFile.mockImplementationOnce(async (path: string) => {
      const row = await prisma.auditLog.findFirst({where: {serverId, action: 'file.read', target: path}});
      resultDuringCall = row ? row.result : 'no journal line at all';
      return {kind: 'text', path, size: 1, encoding: 'utf-8', text: 'x'};
    });

    await readFileAction(serverId, target);

    expect(resultDuringCall).toBe('started');
    expect((await journalFor(target))[0]?.result).toBe('ok');
  });

  it('does not read at all when the journal cannot be written', async () => {
    const target = `/www/wwwroot/${uniq()}/wp-config.php`;
    vi.mocked(beginAudit).mockRejectedValueOnce(new AuditUnavailableError('file.read'));

    const res = await readFileAction(serverId, target);

    expect(res.ok).toBe(false);
    expect(panel.readFile).not.toHaveBeenCalled();
  });

  it('records a read the panel refused as an error', async () => {
    const target = `/www/wwwroot/${uniq()}/missing.php`;
    panel.readFile.mockRejectedValueOnce(new AaPanelError('panel_error', 'Файл не существует'));

    const res = await readFileAction(serverId, target);

    expect(res.ok).toBe(false);
    expect((await journalFor(target))[0]?.result).toBe('error');
  });

  it('records a binary or over-sized file as a finished read', async () => {
    const target = `/www/wwwlogs/${uniq()}.log`;
    panel.readFile.mockResolvedValueOnce({kind: 'tooLarge', path: target, limit: 1024 * 1024});

    const res = await readFileAction(serverId, target);

    expect(res).toEqual({ok: true, file: {kind: 'tooLarge', path: target, limit: 1024 * 1024}});
    expect((await journalFor(target))[0]?.result).toBe('ok');
  });

  it('refuses a viewer and writes nothing', async () => {
    guard.user.role = 'viewer';
    const target = `/www/wwwroot/${uniq()}/wp-config.php`;

    expect(await readFileAction(serverId, target)).toEqual({ok: false, message: 'forbidden'});
    expect(panel.readFile).not.toHaveBeenCalled();
    expect(await journalFor(target)).toHaveLength(0);
  });

  it('refuses a path it would not send, and journals no such attempt', async () => {
    for (const bad of ['/etc/../etc/shadow', '/', 'relative.txt', '', null]) {
      expect(await readFileAction(serverId, bad)).toEqual({ok: false, message: 'validation'});
    }
    expect(panel.readFile).not.toHaveBeenCalled();
    expect(await prisma.auditLog.count({where: {serverId, action: 'file.read', result: 'started'}})).toBe(0);
  });

  it('never puts the contents into the application log, on success or failure', async () => {
    const levels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;
    const spies = levels.map((level) => vi.spyOn(log, level));

    await readFileAction(serverId, `/www/wwwroot/${uniq()}/wp-config.php`);
    // A failure whose error happens to carry the text — the action must not
    // log anything it did not choose to log.
    panel.readFile.mockRejectedValueOnce(new AaPanelError('panel_error', 'refused'));
    await readFileAction(serverId, `/www/wwwroot/${uniq()}/wp-config.php`);

    const written = spies.flatMap((spy) => spy.mock.calls).map((call) => inspect(call, {depth: 8})).join('\n');
    expect(written).not.toContain('stub-not-a-real-secret');
  });
});
