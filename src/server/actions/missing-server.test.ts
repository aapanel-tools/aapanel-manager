import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {readdirSync, readFileSync} from 'node:fs';
import {dirname, join, relative, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

/**
 * A server that is no longer registered is answered as missing — by every action
 * that looks a server up (Д-34).
 *
 * Found on 2026-09-14 in the log of an e2e run: a server page for an id that was
 * gone logged a database error, told the operator Prisma's message with internal
 * paths in it, and would have done so on every poll of a list left open in
 * another tab. Irreversible actions were worse: their journal line references the
 * server, so for a missing one they claimed the journal was down.
 *
 * Each action is called by an administrator for a server that does not exist,
 * with arguments that pass its own checks. It must answer `notFound`; must have
 * looked the server up (so the arguments really got that far); must not have
 * built a panel client or written, or tried to write, a journal line; and must
 * not have logged a warning or an error. The actions that look a server up are
 * found in the source, so a new one without a case here fails the test.
 */

vi.mock('@/auth', () => ({auth: vi.fn(async () => null)}));

vi.mock('@/lib/auth/guards', async (orig) => {
  const actual = await orig<typeof import('@/lib/auth/guards')>();
  const admin = {id: 'd34-admin', email: 'd34@t.c', role: 'admin' as const};
  return {...actual, requireUser: vi.fn(async () => admin), requireAdmin: vi.fn(async () => admin)};
});

vi.mock('next/cache', () => ({revalidatePath: vi.fn()}));

vi.mock('@/lib/aapanel', async (orig) => {
  const actual = await orig<typeof import('@/lib/aapanel')>();
  return {
    ...actual,
    createClientForServer: vi.fn(async () => {
      throw new Error('a panel client was built for a server that does not exist');
    }),
  };
});

vi.mock('@/lib/audit', async (orig) => {
  const actual = await orig<typeof import('@/lib/audit')>();
  return {...actual, recordAudit: vi.fn(actual.recordAudit), beginAudit: vi.fn(actual.beginAudit)};
});

vi.mock('@/lib/servers/creds', async (orig) => {
  const actual = await orig<typeof import('@/lib/servers/creds')>();
  return {...actual, loadServerCreds: vi.fn(actual.loadServerCreds)};
});

import {createClientForServer} from '@/lib/aapanel';
import {beginAudit, recordAudit} from '@/lib/audit';
import {loadServerCreds} from '@/lib/servers/creds';
import {cronConfirmPhrase} from '@/lib/validation/cron';
import {log} from '@/log';
import * as cron from './cron';
import * as databases from './databases';
import * as files from './files';
import * as firewall from './firewall';
import * as ftp from './ftp';
import * as projects from './projects';
import * as servers from './servers';
import * as sites from './sites';

const MISSING = 'd34-missing-server';

const form = (fields: Record<string, string>): FormData => {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
};

/** Every action that looks a server up, with arguments that get past its own checks. */
const CASES: Record<string, () => Promise<unknown>> = {
  'server/actions/cron.ts#listCronTasksAction': () => cron.listCronTasksAction(MISSING),
  'server/actions/cron.ts#getCronLogsAction': () => cron.getCronLogsAction(MISSING, 1),
  'server/actions/cron.ts#runCronTaskAction': () => cron.runCronTaskAction(MISSING, form({id: '1', name: 'backup'})),
  'server/actions/cron.ts#setCronTaskEnabledAction': () =>
    cron.setCronTaskEnabledAction(MISSING, form({id: '1', name: 'backup', enabled: 'true'})),
  'server/actions/cron.ts#deleteCronTaskAction': () =>
    cron.deleteCronTaskAction(MISSING, form({id: '1', name: 'backup', confirm: cronConfirmPhrase({id: 1, name: 'backup'})})),

  'server/actions/databases.ts#listDatabasesAction': () => databases.listDatabasesAction(MISSING),
  'server/actions/databases.ts#createDatabaseAction': () =>
    databases.createDatabaseAction(MISSING, form({engine: 'mysql', name: 'db1', user: 'u1', password: 'secret'})),
  'server/actions/databases.ts#deleteDatabaseAction': () =>
    databases.deleteDatabaseAction(MISSING, form({engine: 'mysql', id: '1', name: 'db1', confirm: 'db1'})),

  'server/actions/files.ts#listDirectoryAction': () => files.listDirectoryAction(MISSING, '/www'),
  'server/actions/files.ts#readFileAction': () => files.readFileAction(MISSING, '/www/a.txt'),

  'server/actions/firewall.ts#getFirewallOverviewAction': () => firewall.getFirewallOverviewAction(MISSING),
  'server/actions/firewall.ts#listFirewallRulesAction': () => firewall.listFirewallRulesAction(MISSING),

  'server/actions/ftp.ts#listFtpUsersAction': () => ftp.listFtpUsersAction(MISSING),
  'server/actions/ftp.ts#createFtpUserAction': () =>
    ftp.createFtpUserAction(MISSING, form({username: 'u1', password: '12345678', path: '/www/u1'})),
  'server/actions/ftp.ts#setFtpUserPasswordAction': () =>
    ftp.setFtpUserPasswordAction(MISSING, form({id: '1', username: 'u1', password: '12345678'})),
  'server/actions/ftp.ts#setFtpUserEnabledAction': () =>
    ftp.setFtpUserEnabledAction(MISSING, form({id: '1', username: 'u1', enabled: 'true'})),
  'server/actions/ftp.ts#deleteFtpUserAction': () =>
    ftp.deleteFtpUserAction(MISSING, form({id: '1', username: 'u1', confirm: 'u1'})),

  'server/actions/projects.ts#getServerMetricsAction': () => projects.getServerMetricsAction(MISSING),
  'server/actions/projects.ts#listNodeProjectsAction': () => projects.listNodeProjectsAction(MISSING),
  'server/actions/projects.ts#projectControlAction': () => projects.projectControlAction(MISSING, 'app', 'restart'),
  'server/actions/projects.ts#getProjectLogsAction': () => projects.getProjectLogsAction(MISSING, 'app'),
  'server/actions/projects.ts#getProjectEditDataAction': () => projects.getProjectEditDataAction(MISSING, 'app'),
  'server/actions/projects.ts#getProjectCreateEnvAction': () => projects.getProjectCreateEnvAction(MISSING),
  'server/actions/projects.ts#getRunListAction': () => projects.getRunListAction(MISSING, '/www/app'),
  'server/actions/projects.ts#createProjectAction': () =>
    projects.createProjectAction(
      MISSING,
      form({
        cwd: '/www/app',
        name: 'app',
        script: 'start',
        port: '3000',
        runUser: 'www',
        nodejsVersion: 'v24.13.0',
        note: '',
        domains: '',
        bindExtranet: 'false',
        powerOn: 'true',
        maxMemoryLimit: '4096',
        env: '',
      }),
    ),
  'server/actions/projects.ts#modifyProjectAction': () =>
    projects.modifyProjectAction(
      MISSING,
      form({cwd: '/www/app', name: 'app', script: 'start', port: '3000', runUser: 'www', nodejsVersion: 'v24.13.0', powerOn: 'false'}),
    ),
  'server/actions/projects.ts#deleteProjectAction': () =>
    projects.deleteProjectAction(MISSING, form({name: 'app', confirm: 'app'})),
  'server/actions/projects.ts#listDirAction': () => projects.listDirAction(MISSING, '/'),

  'server/actions/servers.ts#updateServerAction': () =>
    servers.updateServerAction(
      {ok: false, error: ''},
      form({id: MISSING, name: 'gone', baseUrl: 'http://h:1', apiSk: '', tlsMode: 'VERIFY'}),
    ),
  'server/actions/servers.ts#testConnectionAction': () =>
    servers.testConnectionAction(form({id: MISSING, baseUrl: 'http://h:1', apiSk: '', tlsMode: 'VERIFY'})),
  'server/actions/servers.ts#refreshServerStatusAction': () => servers.refreshServerStatusAction(MISSING),

  'server/actions/sites.ts#listSitesAction': () => sites.listSitesAction(MISSING),
  'server/actions/sites.ts#getSiteDetailAction': () =>
    sites.getSiteDetailAction(MISSING, {id: 1, name: 'a.com', path: '/www/wwwroot/a.com'}),
  'server/actions/sites.ts#getSiteLogsAction': () => sites.getSiteLogsAction(MISSING, 'a.com'),
};

/** Cases that reach the lookup through a helper rather than calling it themselves. */
const INDIRECT: Record<string, string> = {
  'server/actions/servers.ts#refreshServerStatusAction': 'looks the server up in refreshServerStatus (src/lib/servers/status.ts)',
};

const ACTIONS = dirname(fileURLToPath(import.meta.url));
const SRC = join(ACTIONS, '..', '..');

/** `module#action` for every exported action whose body calls loadServerCreds. */
function actionsThatLookUpAServer(): string[] {
  const found: string[] = [];
  for (const name of readdirSync(ACTIONS).sort()) {
    if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
    // [before the first export, name, body, name, body, …]
    const parts = readFileSync(join(ACTIONS, name), 'utf8').split(/^export async function (\w+)/m);
    for (let i = 1; i < parts.length; i += 2) {
      if (parts[i + 1]!.includes('loadServerCreds(')) found.push(`server/actions/${name}#${parts[i]}`);
    }
  }
  return found;
}

function refusalCode(result: unknown): unknown {
  const {message, error} = (result ?? {}) as {message?: unknown; error?: unknown};
  return message ?? error;
}

describe('a server that is gone is answered as missing, by every action that looks one up (Д-34)', () => {
  const levels = ['warn', 'error', 'fatal'] as const;
  let spies: Array<ReturnType<typeof vi.spyOn>> = [];

  beforeEach(() => {
    vi.clearAllMocks();
    // Silenced, and counted: none of these may be written for a missing server.
    spies = levels.map((level) => vi.spyOn(log, level).mockImplementation(() => undefined));
    vi.spyOn(log, 'debug').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has a case for every action that looks a server up, found in the source', () => {
    const found = actionsThatLookUpAServer();
    // Guards the guard: a failed discovery must not pass over nothing. On
    // 2026-09-14 there were 33.
    expect(found.length).toBeGreaterThanOrEqual(33);
    const direct = Object.keys(CASES).filter((id) => !(id in INDIRECT));
    expect(direct.sort()).toEqual([...found].sort());
  });

  it(
    'answers notFound, builds no panel client, journals nothing and logs no error',
    async () => {
      const offenders: string[] = [];

      for (const [id, run] of Object.entries(CASES)) {
        vi.clearAllMocks();
        let result: unknown;
        try {
          result = await run();
        } catch (e) {
          offenders.push(`${id}: threw (${e instanceof Error ? e.message : String(e)})`);
          continue;
        }

        const problems: string[] = [];
        if ((result as {ok?: unknown} | null)?.ok !== false || refusalCode(result) !== 'notFound') {
          problems.push(`answered ${JSON.stringify(result)}`);
        }
        if (!vi.mocked(loadServerCreds).mock.calls.some(([serverId]) => serverId === MISSING)) {
          problems.push('never looked the server up — its arguments did not pass its own checks');
        }
        if (vi.mocked(createClientForServer).mock.calls.length > 0) problems.push('built a panel client');
        if (vi.mocked(recordAudit).mock.calls.length > 0) problems.push('wrote a journal line');
        if (vi.mocked(beginAudit).mock.calls.length > 0) problems.push('began a journal line');
        levels.forEach((level, i) => {
          if (spies[i]!.mock.calls.length > 0) problems.push(`logged at ${level}`);
        });

        if (problems.length > 0) offenders.push(`${id}: ${problems.join('; ')}`);
      }

      expect(offenders).toEqual([]);
    },
    60_000,
  );

  it('keeps one way of looking a server up', () => {
    const files = readdirSync(SRC, {recursive: true, encoding: 'utf8'})
      .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
      .map((name) => join(SRC, name));
    const posix = (file: string) => relative(SRC, file).split(sep).join('/');

    const throwing = files.filter((file) => /\bserver\.findUniqueOrThrow\b/.test(readFileSync(file, 'utf8'))).map(posix);
    const copies = files
      .filter((file) => /function loadServerCreds\b/.test(readFileSync(file, 'utf8')))
      .map(posix)
      .filter((file) => file !== 'lib/servers/creds.ts');

    expect(throwing).toEqual([]);
    expect(copies).toEqual([]);
  });
});
