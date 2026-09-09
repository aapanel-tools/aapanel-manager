import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {AaPanelClient} from './client';
import {AaPanelError, type NodeProject, type Database} from './types';
import {resetGates} from './rate-limit';

// ---------------------------------------------------------------------------
// Mock undici so tests never touch the network.
// Keep the real Agent (spread `actual`) so `new Agent(...)` works in client.ts.
// Replace only `fetch` with a vi.fn() that tests control per-call.
// ---------------------------------------------------------------------------
vi.mock('undici', async (orig) => {
  const actual = await orig<typeof import('undici')>();
  return {...actual, fetch: vi.fn()};
});

// Import the mocked fetch AFTER vi.mock is hoisted.
import {fetch as undiciFetch} from 'undici';
const fetchMock = vi.mocked(undiciFetch);

// VERIFY keeps the test off the pinning connector: undici's fetch is mocked, so
// no socket is ever opened and there is no certificate to compare.
const cfg = {baseUrl: 'https://panel.example:8888', apiSk: 'k', tlsMode: 'VERIFY' as const, timeoutMs: 1000};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});
}

// ---------------------------------------------------------------------------
// Real aaPanel fixture data (confirmed against live panel — see bug report).
// ---------------------------------------------------------------------------

/** Real GetSystemTotal response (no `load` field). */
const FIXTURE_SYSTEM_TOTAL = {
  memTotal: 3819,
  memFree: 374,
  memBuffers: 282,
  memCached: 2700,
  memRealUsed: 463,
  cpuNum: 2,
  cpuRealUsed: 0.5,
  time: '3 Day(s)',
  system: 'Ubuntu 24.04.3 LTS x86_64(Py3.12.3)',
  version: '8.0.1',
};

/** Real GetDiskInfo response — size[3] = "24%". */
const FIXTURE_DISK_INFO = [
  {
    filesystem: '/dev/mapper/ubuntu--vg-ubuntu--lv',
    type: 'ext4',
    path: '/',
    size: ['128G', '30G', '94G', '24%'],
    inodes: ['8519680', '564220', '7955460', '7%'],
  },
];

/**
 * Real GetNetWork response — `load` is an OBJECT {one,five,fifteen,...},
 * NOT an array; up/down are top-level KB/s numbers.
 */
const FIXTURE_NETWORK = {
  up: 0.03,
  down: 0.59,
  upTotal: 50025119,
  downTotal: 457790673,
  load: {one: 0.117, five: 0.078, fifteen: 0.013, max: 4, limit: 4, safe: 3.0},
  cpu: [0.5, 0.0],
  mem: {memTotal: 3819, memFree: 374, memRealUsed: 463, memCached: 2700},
  disk: [],
};

// ---------------------------------------------------------------------------
// AaPanelClient.getSystemTotal
// ---------------------------------------------------------------------------

describe('AaPanelClient.getSystemTotal', () => {
  beforeEach(() => fetchMock.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it('maps a real fixture to normalized metrics', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(FIXTURE_SYSTEM_TOTAL) as never);
    const client = new AaPanelClient(cfg);
    const out = await client.getSystemTotal();

    expect(out.online).toBe(true);
    expect(out.cpu).toBeCloseTo(0.5);
    // memPercent = 463/3819 * 100 ≈ 12.1
    expect(out.mem).toBeCloseTo((463 / 3819) * 100);

    // Verify signed body was sent
    const body = String((fetchMock.mock.calls[0][1] as RequestInit).body);
    expect(body).toContain('request_time=');
    expect(body).toContain('request_token=');
  });

  it('classifies HTTP 401 as an auth error', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({msg: 'bad key'}, 401) as never);
    const client = new AaPanelClient(cfg);
    await expect(client.getSystemTotal()).rejects.toMatchObject({kind: 'auth'} satisfies Partial<AaPanelError>);
  });

  it('classifies a thrown TypeError as a network error', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('connect ECONNREFUSED') as never);
    const client = new AaPanelClient(cfg);
    await expect(client.getSystemTotal()).rejects.toMatchObject({kind: 'network'});
  });

  it('includes the cause code in the network error message', async () => {
    const err = Object.assign(new TypeError('fetch failed'), {
      cause: {code: 'UND_ERR_INVALID_ARG'},
    });
    fetchMock.mockRejectedValueOnce(err as never);
    const client = new AaPanelClient(cfg);
    await expect(client.getSystemTotal()).rejects.toMatchObject({
      kind: 'network',
      message: expect.stringContaining('UND_ERR_INVALID_ARG'),
    });
  });

  it('includes UNABLE_TO_VERIFY_LEAF_SIGNATURE in the message when relevant', async () => {
    const err = Object.assign(new TypeError('fetch failed'), {
      cause: {code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'},
    });
    fetchMock.mockRejectedValueOnce(err as never);
    const client = new AaPanelClient(cfg);
    await expect(client.getSystemTotal()).rejects.toMatchObject({
      kind: 'network',
      message: 'fetch failed (UNABLE_TO_VERIFY_LEAF_SIGNATURE)',
    });
  });

  it('classifies an AbortError as a timeout', async () => {
    const err = Object.assign(new Error('aborted'), {name: 'AbortError'});
    fetchMock.mockRejectedValueOnce(err as never);
    const client = new AaPanelClient(cfg);
    await expect(client.getSystemTotal()).rejects.toMatchObject({kind: 'timeout'});
  });

  // AbortSignal.timeout() — the mechanism client.ts actually uses — aborts with
  // TimeoutError, not AbortError. Verified on Node 22: signal.reason.name is
  // 'TimeoutError'. Before the fix this fell through to kind: 'network'.
  it('classifies a TimeoutError as a timeout', async () => {
    const err = Object.assign(new Error('The operation was aborted due to timeout'), {
      name: 'TimeoutError',
    });
    fetchMock.mockRejectedValueOnce(err as never);
    const client = new AaPanelClient(cfg);
    await expect(client.getSystemTotal()).rejects.toMatchObject({kind: 'timeout'});
  });

  it('classifies a wrapped TimeoutError cause as a timeout', async () => {
    const err = Object.assign(new Error('fetch failed'), {
      cause: Object.assign(new Error('timed out'), {name: 'TimeoutError'}),
    });
    fetchMock.mockRejectedValueOnce(err as never);
    const client = new AaPanelClient(cfg);
    await expect(client.getSystemTotal()).rejects.toMatchObject({kind: 'timeout'});
  });
});

// ---------------------------------------------------------------------------
// AaPanelClient.getDiskInfo
// ---------------------------------------------------------------------------

describe('AaPanelClient.getDiskInfo', () => {
  beforeEach(() => fetchMock.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it('returns the root mount usage percent from real fixture', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(FIXTURE_DISK_INFO) as never);
    const client = new AaPanelClient({baseUrl: 'https://h:8888', apiSk: 'k', tlsMode: 'VERIFY'});
    expect(await client.getDiskInfo()).toBeCloseTo(24);
  });

  it('returns null when no parsable mount is present', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]) as never);
    const client = new AaPanelClient({baseUrl: 'https://h:8888', apiSk: 'k', tlsMode: 'VERIFY'});
    expect(await client.getDiskInfo()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AaPanelClient.collectStatus
// ---------------------------------------------------------------------------

describe('AaPanelClient.collectStatus', () => {
  beforeEach(() => fetchMock.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it('combines system + disk; disk failure does not fail the snapshot', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(FIXTURE_SYSTEM_TOTAL) as never);
    fetchMock.mockRejectedValueOnce(new TypeError('disk fetch failed') as never);

    const client = new AaPanelClient({baseUrl: 'https://h:8888', apiSk: 'k', tlsMode: 'VERIFY'});
    const snap = await client.collectStatus();

    expect(snap.online).toBe(true);
    expect(snap.cpu).toBeCloseTo(0.5);
    expect(snap.mem).toBeCloseTo((463 / 3819) * 100);
    expect(snap.disk).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AaPanelClient.getMetrics — uses REAL fixture shapes
// Call order: 1=GetSystemTotal, 2=GetDiskInfo, 3=GetNetWork
// ---------------------------------------------------------------------------

describe('AaPanelClient.getMetrics', () => {
  beforeEach(() => fetchMock.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it('maps a full happy-path response to ServerMetrics using real fixtures', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(FIXTURE_SYSTEM_TOTAL) as never);
    fetchMock.mockResolvedValueOnce(jsonResponse(FIXTURE_DISK_INFO) as never);
    fetchMock.mockResolvedValueOnce(jsonResponse(FIXTURE_NETWORK) as never);

    const client = new AaPanelClient({baseUrl: 'https://h:8888', apiSk: 'k', tlsMode: 'VERIFY'});
    const metrics = await client.getMetrics();

    expect(metrics.cpuPercent).toBeCloseTo(0.5);
    expect(metrics.cores).toBe(2);
    expect(metrics.memTotalMb).toBe(3819);
    expect(metrics.memUsedMb).toBe(463);
    expect(metrics.memPercent).toBeCloseTo((463 / 3819) * 100); // ≈ 12.1
    expect(metrics.diskPercent).toBeCloseTo(24);
    // load is an object from GetNetWork — NOT an array
    expect(metrics.load).toEqual({one: 0.117, five: 0.078, fifteen: 0.013});
    // up/down are top-level KB/s numbers
    expect(metrics.netUpKbps).toBeCloseTo(0.03);
    expect(metrics.netDownKbps).toBeCloseTo(0.59);
  });

  it('resolves with null network fields when GetNetWork rejects (best-effort)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(FIXTURE_SYSTEM_TOTAL) as never);
    fetchMock.mockResolvedValueOnce(jsonResponse(FIXTURE_DISK_INFO) as never);
    fetchMock.mockRejectedValueOnce(new TypeError('network fetch failed') as never);

    const client = new AaPanelClient({baseUrl: 'https://h:8888', apiSk: 'k', tlsMode: 'VERIFY'});
    const metrics = await client.getMetrics();

    expect(metrics.cpuPercent).toBeCloseTo(0.5);
    expect(metrics.memPercent).toBeCloseTo((463 / 3819) * 100);
    expect(metrics.diskPercent).toBeCloseTo(24);
    // Network becomes null on failure
    expect(metrics.netUpKbps).toBeNull();
    expect(metrics.netDownKbps).toBeNull();
    expect(metrics.load).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Node.js project methods
// Real response shapes documented in a live v8 panel (live v8 panel).
// ---------------------------------------------------------------------------

// Fixture: two projects (one running, one stopped) matching the real panel shape.
const projectListResponse = {
  status: 0,
  message: {
    page: "<div><span class='Pcurrent'>1</span><span class='Pcount'>Total 2</span></div>",
    shift: '0',
    row: '10',
    data: [
      {
        id: 4,
        name: 'myapp',
        path: '/www/node-projects/myapp/',
        status: '1',
        ps: 'myapp 3003',
        addtime: '2026-02-03 03:22:24',
        project_type: 'Node',
        project_config: {
          project_name: 'myapp',
          project_cwd: '/www/node-projects/myapp/',
          project_script: 'prod:start',
          bind_extranet: 1,
          domains: ['myapp.example.com:80'],
          is_power_on: 0,
          run_user: 'www',
          max_memory_limit: 4096,
          nodejs_version: 'v24.13.0',
          port: 3003,
          log_path: '/www/wwwlogs/nodejs',
        },
        load_info: {
          '1162208': {
            name: 'MainThread',
            pid: 1162208,
            status: 'Sleeping',
            user: 'www',
            memory_used: 208945152,
            cpu_percent: 0.09,
            threads: 18,
            exe: 'node server.js',
          },
        },
        run: true,
        listen: [3003],
        listen_ok: true,
      },
      {
        id: 5,
        name: 'stoppedapp',
        path: '/www/node-projects/stoppedapp/',
        status: '0',
        ps: 'stoppedapp 3004',
        addtime: '2026-03-01 10:00:00',
        project_type: 'Node',
        project_config: {
          project_name: 'stoppedapp',
          project_cwd: '/www/node-projects/stoppedapp/',
          project_script: 'start',
          bind_extranet: 0,
          domains: [],
          is_power_on: 0,
          run_user: 'www',
          max_memory_limit: 2048,
          nodejs_version: 'v24.13.0',
          port: 3004,
          log_path: '/www/wwwlogs/nodejs',
        },
        load_info: {},
        run: false,
        listen: [],
        listen_ok: false,
      },
    ],
  },
};

describe('AaPanelClient.listProjects', () => {
  beforeEach(() => fetchMock.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it('returns a NodeProject[] with mapped name, status, port, path, cpu, mem', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(projectListResponse) as never);
    const client = new AaPanelClient(cfg);
    const {items: projects}: {items: NodeProject[]} = await client.listProjects();

    // Correct count
    expect(projects).toHaveLength(2);

    // Running project
    const running = projects[0];
    expect(running.name).toBe('myapp');
    expect(running.status).toBe('running');
    expect(running.port).toBe(3003);
    expect(running.path).toBe('/www/node-projects/myapp/');
    // cpu_percent from load_info (sum across processes): 0.09
    expect(running.cpu).toBeCloseTo(0.09);
    // memory_used bytes → MB: 208945152 / 1024 / 1024 ≈ 199.25
    expect(running.mem).toBeCloseTo(208945152 / 1024 / 1024);

    // Stopped project: load_info is empty → cpu/mem null
    const stopped = projects[1];
    expect(stopped.name).toBe('stoppedapp');
    expect(stopped.status).toBe('stopped');
    expect(stopped.port).toBe(3004);
    expect(stopped.cpu).toBeNull();
    expect(stopped.mem).toBeNull();

    // URL must contain the Node endpoint path
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('/v2/project/nodejs/get_project_list');

    // Body must use the data= wrapper
    const body = String((fetchMock.mock.calls[0][1] as RequestInit).body);
    expect(body).toContain('data=');
    expect(body).toContain('request_time=');
    expect(body).toContain('request_token=');
  });

  it('status "running" when run=true, "stopped" when run=false', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(projectListResponse) as never);
    const client = new AaPanelClient(cfg);
    const {items: projects} = await client.listProjects();
    expect(projects[0].status).toBe('running');
    expect(projects[1].status).toBe('stopped');
  });
});

describe('AaPanelClient.batchOperation', () => {
  beforeEach(() => fetchMock.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it('POSTs a flat body with project_names JSON array and operation_type', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: 0,
        message: {
          msg: 'Successfully 1 items.Failed on 0 projects.',
          msg_list: [{name: 'myapp', status: true, msg: 'Started successfully'}],
        },
      }) as never,
    );
    const client = new AaPanelClient(cfg);
    await client.batchOperation(['myapp'], 'start');

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('/v2/project/nodejs/batch_operation_project');

    const body = String((fetchMock.mock.calls[0][1] as RequestInit).body);
    // Must contain project_names= with the JSON array (URL-encoded)
    expect(body).toContain('project_names=');
    expect(decodeURIComponent(body)).toContain('["myapp"]');
    // Must contain operation_type=start
    expect(body).toContain('operation_type=start');
    // Must NOT use the data= wrapper (flat body)
    expect(body).not.toContain('data=');
  });

  it('encodes multiple project names correctly', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: 0,
        message: {msg: 'Successfully 2 items.Failed on 0 projects.', msg_list: []},
      }) as never,
    );
    const client = new AaPanelClient(cfg);
    await client.batchOperation(['app1', 'app2'], 'stop');

    const body = decodeURIComponent(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body).toContain('["app1","app2"]');
    expect(body).toContain('operation_type=stop');
  });
});

describe('AaPanelClient.getProjectInfo', () => {
  beforeEach(() => fetchMock.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it('returns a NodeProject for a single project', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: 0,
        message: {
          id: 3,
          name: 'myapp',
          path: '/www/node-projects/myapp/',
          project_type: 'Node',
          project_config: {
            project_name: 'myapp',
            project_cwd: '/www/node-projects/myapp/',
            project_script: 'start',
            port: 3002,
            run_user: 'www',
            nodejs_version: 'v24.13.0',
            is_power_on: 1,
            domains: ['myapp.example.com:80'],
            max_memory_limit: 4096,
          },
          load_info: {},
          run: false,
          listen: [],
          listen_ok: true,
        },
      }) as never,
    );
    const client = new AaPanelClient(cfg);
    const project: NodeProject = await client.getProjectInfo('myapp');
    expect(project.name).toBe('myapp');
    expect(project.status).toBe('stopped');
    expect(project.port).toBe(3002);
    expect(project.path).toBe('/www/node-projects/myapp/');
    expect(project.cpu).toBeNull();
    expect(project.mem).toBeNull();
  });
});

describe('AaPanelClient.getProjectLogs', () => {
  beforeEach(() => fetchMock.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it('returns the log text from message.result', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: 0,
        message: {result: 'PM2 log output here\nline2'},
      }) as never,
    );
    const client = new AaPanelClient(cfg);
    const log = await client.getProjectLogs('myapp');
    expect(typeof log).toBe('string');
    expect(log).toContain('PM2 log output here');

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('/v2/project/nodejs/get_project_log');

    const body = String((fetchMock.mock.calls[0][1] as RequestInit).body);
    expect(body).toContain('data=');
  });
});

// ---------------------------------------------------------------------------
// AaPanelClient.listDatabases
// ---------------------------------------------------------------------------

describe('AaPanelClient.listDatabases', () => {
  beforeEach(() => fetchMock.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it('merges MySQL (empty) and PG rows; strips password; maps fields correctly', async () => {
    // MySQL response: empty list
    fetchMock.mockResolvedValueOnce(
      jsonResponse({status: 0, message: {data: []}}) as never,
    );
    // PG response: one row with a password that must be stripped
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: 0,
        message: {
          data: [
            {
              id: 2,
              name: 'test22',
              username: 'test22',
              password: 'SECRET',
              accept: '127.0.0.1',
              ps: 'test22',
              addtime: '2026-01-27 12:48:22',
              type: 'pgsql',
              listen_ip: '127.0.0.1/32',
              backup_count: 0,
            },
          ],
        },
      }) as never,
    );

    const client = new AaPanelClient(cfg);
    const {items, failures} = await client.listDatabases();

    expect(failures).toEqual([]);
    expect(items).toHaveLength(1);
    const row: Database = items[0];
    expect(row).toEqual<Database>({
      engine: 'pgsql',
      id: 2,
      name: 'test22',
      username: 'test22',
      access: '127.0.0.1/32',
      note: 'test22',
      backupCount: 0,
      addtime: '2026-01-27 12:48:22',
    });
    // password must be stripped
    expect((row as unknown as Record<string, unknown>).password).toBeUndefined();
  });

  it('MySQL body contains table=databases; PG body contains data=', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({status: 0, message: {data: []}}) as never);
    fetchMock.mockResolvedValueOnce(jsonResponse({status: 0, message: {data: []}}) as never);

    const client = new AaPanelClient(cfg);
    await client.listDatabases();

    const mysqlBody = String((fetchMock.mock.calls[0][1] as RequestInit).body);
    expect(mysqlBody).toContain('table=databases');

    const pgBody = String((fetchMock.mock.calls[1][1] as RequestInit).body);
    expect(pgBody).toContain('data=');
  });

  it('MySQL engine failure is isolated — PG rows are still returned', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('mysql down') as never);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: 0,
        message: {
          data: [
            {
              id: 3,
              name: 'pgdb',
              username: 'pguser',
              password: 'SECRET2',
              accept: '127.0.0.1',
              ps: 'note',
              addtime: '2026-02-01 00:00:00',
              type: 'pgsql',
              listen_ip: '%',
              backup_count: 1,
            },
          ],
        },
      }) as never,
    );

    const client = new AaPanelClient(cfg);
    const {items, failures} = await client.listDatabases();

    // The working engine still answers…
    expect(items).toHaveLength(1);
    expect(items[0].engine).toBe('pgsql');
    expect(items[0].name).toBe('pgdb');
    // …and the broken one is REPORTED, not swallowed (ADR-0003): a one-row list
    // with no warning is indistinguishable from a server that has one database.
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({source: 'mysql'});
    expect(failures[0].message).toContain('mysql down');
  });
});

// ---------------------------------------------------------------------------
// AaPanelClient.createDatabase
// ---------------------------------------------------------------------------

describe('AaPanelClient.createDatabase', () => {
  beforeEach(() => fetchMock.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it('pgsql: resolves; uses correct path; body contains data=', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({status: 0, message: {result: 'Add_success'}}) as never,
    );

    const client = new AaPanelClient(cfg);
    await expect(
      client.createDatabase({engine: 'pgsql', name: 'd', user: 'u', password: 'p'}),
    ).resolves.toBeUndefined();

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('v2/database/pgsql/AddDatabase');

    const body = String((fetchMock.mock.calls[0][1] as RequestInit).body);
    expect(body).toContain('data=');
  });

  it('mysql: resolves; uses correct path; body contains dtype=MySQL and codeing=utf8mb4', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({status: 0, message: {result: 'Setup successful!'}}) as never,
    );

    const client = new AaPanelClient(cfg);
    await expect(
      client.createDatabase({engine: 'mysql', name: 'mydb', user: 'myuser', password: 'pw'}),
    ).resolves.toBeUndefined();

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('v2/database?action=AddDatabase');

    const body = decodeURIComponent(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body).toContain('dtype=MySQL');
    expect(body).toContain('codeing=utf8mb4');
  });

  it('rejects with AaPanelError when panel returns non-zero status', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({status: -1, message: 'name exists'}) as never,
    );

    const client = new AaPanelClient(cfg);
    await expect(
      client.createDatabase({engine: 'mysql', name: 'dup', user: 'u', password: 'p'}),
    ).rejects.toMatchObject({
      kind: 'panel_error',
      message: expect.stringContaining('name exists'),
    } satisfies Partial<AaPanelError>);
  });
});

// ---------------------------------------------------------------------------
// AaPanelClient.deleteDatabase
// ---------------------------------------------------------------------------

describe('AaPanelClient.deleteDatabase', () => {
  beforeEach(() => fetchMock.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it('pgsql: uses correct path; body contains data=', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({status: 0, message: {result: 'Deleted...'}}) as never,
    );

    const client = new AaPanelClient(cfg);
    await client.deleteDatabase('pgsql', {id: 2, name: 'test22'});

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('v2/database/pgsql/DeleteDatabase');

    const body = String((fetchMock.mock.calls[0][1] as RequestInit).body);
    expect(body).toContain('data=');
  });

  it('mysql: uses correct path; body contains name= and id=', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({status: 0, message: {result: 'Deleted...'}}) as never,
    );

    const client = new AaPanelClient(cfg);
    await client.deleteDatabase('mysql', {id: 5, name: 'mydb'});

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('v2/database?action=DeleteDatabase');

    const body = String((fetchMock.mock.calls[0][1] as RequestInit).body);
    expect(body).toContain('name=');
    expect(body).toContain('id=');
  });
});

// ---------------------------------------------------------------------------
// Node.js project CRUD methods
// Real response shapes documented in a live v8 panel (live v8 panel).
// ---------------------------------------------------------------------------

describe('AaPanelClient.getRunList', () => {
  beforeEach(() => fetchMock.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it('maps the scripts map to a RunScript[]; uses data= body and correct path', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: 0,
        message: {start: 'node server.js', dev: 'next dev -p 3002', build: 'next build'},
      }) as never,
    );
    const client = new AaPanelClient(cfg);
    const scripts = await client.getRunList('/www/node-projects/myapp/');

    expect(scripts).toEqual([
      {key: 'start', command: 'node server.js'},
      {key: 'dev', command: 'next dev -p 3002'},
      {key: 'build', command: 'next build'},
    ]);

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('/v2/project/nodejs/get_run_list');
    const body = decodeURIComponent(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body).toContain('project_cwd');
  });

  it('throws AaPanelError with the panel error_msg when the directory is missing', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: -1,
        message: {status_code: -1, error_msg: 'Project directory does not exist!', data: 'x'},
      }) as never,
    );
    const client = new AaPanelClient(cfg);
    await expect(client.getRunList('/nope')).rejects.toMatchObject({
      kind: 'panel_error',
      message: expect.stringContaining('Project directory does not exist'),
    } satisfies Partial<AaPanelError>);
  });
});

describe('AaPanelClient.getNodeVersions', () => {
  beforeEach(() => fetchMock.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it('returns the version array', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({status: 0, message: ['v22.22.0', 'v24.13.0']}) as never,
    );
    const client = new AaPanelClient(cfg);
    expect(await client.getNodeVersions()).toEqual(['v22.22.0', 'v24.13.0']);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('/v2/project/nodejs/get_nodejs_version');
  });

  it('throws when the message is not an array', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({status: -1, message: 'err'}) as never);
    const client = new AaPanelClient(cfg);
    await expect(client.getNodeVersions()).rejects.toMatchObject({kind: 'panel_error'});
  });
});

describe('AaPanelClient.getCreateEnv', () => {
  beforeEach(() => fetchMock.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it('maps pre_env to normalized ProjectPreEnv; uses the mod path', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: 0,
        message: {
          nodejs_versions: ['v24.13.0'],
          package_managers: ['pnpm', 'yarn', 'npm'],
          user_list: ['www', 'root'],
          maximum_memory: 3819,
        },
      }) as never,
    );
    const client = new AaPanelClient(cfg);
    const env = await client.getCreateEnv();
    expect(env).toEqual({
      nodejsVersions: ['v24.13.0'],
      packageManagers: ['pnpm', 'yarn', 'npm'],
      userList: ['www', 'root'],
      maximumMemory: 3819,
    });
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('/v2/mod/nodejs/com/pre_env');
  });
});

describe('AaPanelClient.getProjectConfig', () => {
  beforeEach(() => fetchMock.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it('extracts edit-form fields from project_config', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: 0,
        message: {
          id: 3,
          name: 'myapp',
          path: '/www/node-projects/myapp/',
          ps: 'myapp 3002',
          project_config: {
            project_name: 'myapp',
            project_cwd: '/www/node-projects/myapp/',
            project_script: 'start',
            port: 3002,
            run_user: 'www',
            nodejs_version: 'v24.13.0',
            is_power_on: 1,
            domains: ['myapp.example.com:80'],
            max_memory_limit: 4096,
          },
          load_info: {},
          run: false,
        },
      }) as never,
    );
    const client = new AaPanelClient(cfg);
    const config = await client.getProjectConfig('myapp');
    expect(config).toEqual({
      name: 'myapp',
      cwd: '/www/node-projects/myapp/',
      script: 'start',
      port: 3002,
      runUser: 'www',
      nodejsVersion: 'v24.13.0',
      note: 'myapp 3002',
      powerOn: true,
      maxMemoryLimit: 4096,
      domains: ['myapp.example.com:80'],
    });
  });
});

describe('AaPanelClient.modifyProject', () => {
  beforeEach(() => fetchMock.mockReset());
  afterEach(() => vi.restoreAllMocks());

  const input = {
    cwd: '/www/node-projects/myapp/',
    name: 'myapp',
    script: 'prod:start',
    port: 3003,
    runUser: 'www',
    nodejsVersion: 'v24.13.0',
    note: 'myapp 3003',
    powerOn: false,
  };

  it('resolves on success; uses data= body and the modify path', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: 0,
        message: {status_code: 1, error_msg: '', data: 'Modify the project successfully'},
      }) as never,
    );
    const client = new AaPanelClient(cfg);
    await expect(client.modifyProject(input)).resolves.toBeUndefined();

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('/v2/project/nodejs/modify_project');
    const body = decodeURIComponent(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body).toContain('project_script');
    expect(body).toContain('prod:start');
  });

  it('throws when inner status_code is negative', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: 0,
        message: {status_code: -1, error_msg: 'Port already in use', data: ''},
      }) as never,
    );
    const client = new AaPanelClient(cfg);
    await expect(client.modifyProject(input)).rejects.toMatchObject({
      kind: 'panel_error',
      message: expect.stringContaining('Port already in use'),
    } satisfies Partial<AaPanelError>);
  });

  it('throws when top-level status is non-zero', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({status: -1, message: 'bad'}) as never);
    const client = new AaPanelClient(cfg);
    await expect(client.modifyProject(input)).rejects.toMatchObject({kind: 'panel_error'});
  });
});

describe('AaPanelClient.createProject', () => {
  beforeEach(() => fetchMock.mockReset());
  afterEach(() => vi.restoreAllMocks());

  const input = {
    cwd: '/www/node-projects/myapp',
    name: 'myapp',
    script: 'release',
    port: 3001,
    runUser: 'www',
    nodejsVersion: 'v24.13.0',
    note: 'myapp',
    domains: ['myapp.example.com:80'],
    bindExtranet: true,
    powerOn: true,
    maxMemoryLimit: 4096,
    env: '',
  };

  it('resolves on success; uses data= body and the create path', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: 0,
        message: {status_code: 1, error_msg: '', data: 'Created'},
      }) as never,
    );
    const client = new AaPanelClient(cfg);
    await expect(client.createProject(input)).resolves.toBeUndefined();

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('/v2/project/nodejs/create_project');
    const body = decodeURIComponent(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body).toContain('bind_extranet');
    expect(body).toContain('max_memory_limit');
  });

  it('throws AaPanelError when the inner status_code is negative', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: 0,
        message: {status_code: -1, error_msg: 'Name already exists', data: ''},
      }) as never,
    );
    const client = new AaPanelClient(cfg);
    await expect(client.createProject(input)).rejects.toMatchObject({
      kind: 'panel_error',
      message: expect.stringContaining('Name already exists'),
    } satisfies Partial<AaPanelError>);
  });
});

describe('AaPanelClient.deleteProject', () => {
  beforeEach(() => fetchMock.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it('sends operation_type=delete and resolves when status is true', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: 0,
        message: {
          msg: 'Successfully 1 items.Failed on 0 projects.',
          msg_list: [{name: 'myapp', status: true, msg: 'Operation successful.'}],
        },
      }) as never,
    );
    const client = new AaPanelClient(cfg);
    await expect(client.deleteProject('myapp')).resolves.toBeUndefined();

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('/v2/project/nodejs/batch_operation_project');
    const body = decodeURIComponent(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body).toContain('operation_type=delete');
    expect(body).toContain('["myapp"]');
  });

  it('throws when the per-project status is false', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: 0,
        message: {msg: 'Failed', msg_list: [{name: 'myapp', status: false, msg: 'cannot delete'}]},
      }) as never,
    );
    const client = new AaPanelClient(cfg);
    await expect(client.deleteProject('myapp')).rejects.toMatchObject({
      kind: 'panel_error',
      message: expect.stringContaining('cannot delete'),
    } satisfies Partial<AaPanelError>);
  });
});

describe('AaPanelClient.listDir', () => {
  beforeEach(() => fetchMock.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it('returns sorted folder names from GetDirNew; uses a flat path body', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: 0,
        message: {
          path: '/www/node-projects',
          dir: [{nm: 'myapp'}, {nm: 'another'}],
          files: [{nm: 'readme.txt'}],
        },
      }) as never,
    );
    const client = new AaPanelClient(cfg);
    const res = await client.listDir('/www/node-projects');

    expect(res.path).toBe('/www/node-projects');
    expect(res.dirs).toEqual(['another', 'myapp']); // sorted; files ignored

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('v2/files?action=GetDirNew');
    const body = decodeURIComponent(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body).toContain('path=/www/node-projects');
    expect(body).not.toContain('data=');
  });

  it('throws AaPanelError when the panel returns a non-zero status', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({status: -1, message: 'Directory does not exist'}) as never,
    );
    const client = new AaPanelClient(cfg);
    await expect(client.listDir('/nope')).rejects.toMatchObject({
      kind: 'panel_error',
    } satisfies Partial<AaPanelError>);
  });
});

// ---------------------------------------------------------------------------
// Response validation (PROJECT_RULES.md §16: a panel's answer is untrusted data)
// ---------------------------------------------------------------------------

describe('AaPanelClient response validation', () => {
  beforeEach(() => fetchMock.mockReset());
  afterEach(() => vi.restoreAllMocks());

  // Before schema validation this crashed with "Cannot read properties of
  // undefined (reading 'map')" — a stack trace instead of a usable error.
  it('reports a differently shaped project list as a panel error, not a crash', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({status: 0, message: {}}) as never);
    const client = new AaPanelClient(cfg);
    await expect(client.listProjects()).rejects.toMatchObject({kind: 'panel_error'});
  });

  it('names the endpoint and the offending field in the error message', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({status: 0, message: {data: 'not-an-array'}}) as never);
    const client = new AaPanelClient(cfg);
    await expect(client.listProjects()).rejects.toThrow(/get_project_list.*message\.data/);
  });

  it('still rejects a non-JSON answer', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('<html>panel is starting</html>', {status: 200}) as never,
    );
    const client = new AaPanelClient(cfg);
    await expect(client.listProjects()).rejects.toMatchObject({kind: 'panel_error'});
  });

  it('accepts a project list from an older panel that omits path and run', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({status: 0, message: {data: [{name: 'app'}]}}) as never,
    );
    const client = new AaPanelClient(cfg);
    const [project] = (await client.listProjects()).items;
    expect(project).toMatchObject({name: 'app', status: 'unknown', path: null, port: null});
  });

  it('turns a malformed project log payload into a panel error', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({status: 0, message: {}}) as never);
    const client = new AaPanelClient(cfg);
    await expect(client.getProjectLogs('app')).rejects.toMatchObject({kind: 'panel_error'});
  });
});

// ---------------------------------------------------------------------------
// Response size cap (a broken panel must not exhaust the fleet process)
// ---------------------------------------------------------------------------

describe('AaPanelClient response size cap', () => {
  beforeEach(() => fetchMock.mockReset());
  afterEach(() => vi.restoreAllMocks());

  const tiny = {...cfg, maxResponseBytes: 64};

  it('refuses an answer that streams past the cap', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({status: 0, message: {data: Array.from({length: 50}, (_, i) => ({name: `p${i}`}))}}) as never,
    );
    const client = new AaPanelClient(tiny);
    await expect(client.listProjects()).rejects.toMatchObject({
      kind: 'panel_error',
      message: expect.stringContaining('exceeded'),
    });
  });

  it('refuses without reading when the panel declares an oversized Content-Length', async () => {
    const body = JSON.stringify({status: 0, message: {data: []}});
    fetchMock.mockResolvedValueOnce(
      new Response(body, {
        status: 200,
        headers: {'content-type': 'application/json', 'content-length': '999999'},
      }) as never,
    );
    const client = new AaPanelClient(tiny);
    await expect(client.listProjects()).rejects.toThrow(/declares 999999 bytes/);
  });

  it('lets an answer under the cap through unchanged', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({status: 0, message: {data: []}}) as never);
    const client = new AaPanelClient(tiny);
    expect((await client.listProjects()).items).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Partial results (ADR-0003): a source that fails must leave a visible gap
// ---------------------------------------------------------------------------

describe('AaPanelClient.listDatabases partial results', () => {
  beforeEach(() => fetchMock.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it('reports both engines when neither answers, and returns no rows', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('mysql down') as never);
    fetchMock.mockRejectedValueOnce(new TypeError('pgsql down') as never);

    const client = new AaPanelClient(cfg);
    const {items, failures} = await client.listDatabases();

    expect(items).toEqual([]);
    expect(failures.map((f) => f.source).sort()).toEqual(['mysql', 'pgsql']);
  });

  it('reports an engine that answers with a panel-level error', async () => {
    // status !== 0 is the panel saying no; unwrapEnvelope turns it into AaPanelError.
    fetchMock.mockResolvedValueOnce(jsonResponse({status: -1, message: 'permission denied'}) as never);
    fetchMock.mockResolvedValueOnce(jsonResponse({status: 0, message: {data: []}}) as never);

    const client = new AaPanelClient(cfg);
    const {items, failures} = await client.listDatabases();

    expect(items).toEqual([]);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({source: 'mysql', kind: 'panel_error'});
    expect(failures[0].message).toContain('permission denied');
  });

  it('claims completeness only when every engine answered', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({status: 0, message: {data: []}}) as never);
    fetchMock.mockResolvedValueOnce(jsonResponse({status: 0, message: {data: []}}) as never);

    const client = new AaPanelClient(cfg);
    const {items, failures} = await client.listDatabases();

    expect(items).toEqual([]);
    expect(failures).toEqual([]);
  });
});

describe('AaPanelClient panel refusals', () => {
  beforeEach(() => fetchMock.mockReset());
  afterEach(() => vi.restoreAllMocks());

  // A refusal shares the envelope with success. Reporting a schema complaint here
  // would bury the only useful sentence: what the panel said.
  it('reports the panel wording, not a shape complaint, for a string payload', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({status: -1, message: 'permission denied'}) as never);
    const client = new AaPanelClient(cfg);
    await expect(client.listProjects()).rejects.toMatchObject({
      kind: 'panel_error',
      message: 'permission denied',
    });
  });

  it('digs the wording out of an object payload', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({status: -1, message: {error_msg: 'project not found'}}) as never,
    );
    const client = new AaPanelClient(cfg);
    await expect(client.listProjects()).rejects.toMatchObject({message: 'project not found'});
  });

  it('falls back to the status when the payload says nothing usable', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({status: -7, message: {}}) as never);
    const client = new AaPanelClient(cfg);
    await expect(client.listProjects()).rejects.toThrow(/status -7/);
  });

  // status 0 with a broken payload is not a refusal — it is a shape problem, and
  // the endpoint and field must still be named.
  it('still reports a shape mismatch when the panel claims success', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({status: 0, message: {data: 'nope'}}) as never);
    const client = new AaPanelClient(cfg);
    await expect(client.listProjects()).rejects.toThrow(/get_project_list.*message\.data/);
  });
});

// ---------------------------------------------------------------------------
// Load limit per panel (ADR-0004)
// ---------------------------------------------------------------------------

describe('AaPanelClient panel load limit', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    resetGates();
  });
  afterEach(() => {
    resetGates();
    vi.restoreAllMocks();
  });

  const after = (ms: number, value: Response): Promise<Response> =>
    new Promise((resolve) => setTimeout(() => resolve(value), ms));

  // The gate is keyed by panel origin, so it is shared by every client instance
  // pointing at that panel — which is the whole point: load lands on the machine.
  it('makes a second caller wait, and reports the queue rather than a silent panel', async () => {
    const holder = new AaPanelClient({...cfg, maxConcurrentRequests: 1, timeoutMs: 400});
    const latecomer = new AaPanelClient({...cfg, maxConcurrentRequests: 1, timeoutMs: 50});

    fetchMock.mockReturnValueOnce(
      after(250, jsonResponse({status: 0, message: {data: []}})) as never,
    );
    fetchMock.mockResolvedValueOnce(jsonResponse({status: 0, message: {data: []}}) as never);

    const first = holder.listProjects();
    const second = latecomer.listProjects();

    await expect(second).rejects.toMatchObject({kind: 'timeout'});
    await expect(second).rejects.toThrow(/No free request slot/);
    // The holder is unaffected and still gets its answer.
    await expect(first).resolves.toEqual({items: [], failures: [], truncations: []});
    // Exactly one request reached the panel: the queued one never got a slot.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('frees the slot after the body is read, so the next caller proceeds', async () => {
    const client = new AaPanelClient({...cfg, maxConcurrentRequests: 1, timeoutMs: 400});
    // A fresh Response per call: a body stream can only be read once.
    fetchMock.mockImplementation(
      () => Promise.resolve(jsonResponse({status: 0, message: {data: []}})) as never,
    );

    await expect(client.listProjects()).resolves.toEqual({items: [], failures: [], truncations: []});
    await expect(client.listProjects()).resolves.toEqual({items: [], failures: [], truncations: []});
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// AaPanelClient.listSites
// ---------------------------------------------------------------------------

/** A row exactly as a live panel returns it (see the sites docs), minus the base64 `ico`. */
const FIXTURE_SITE_ROW = {
  id: 3,
  name: 'site.example.com',
  path: '/www/wwwroot/site.example.com',
  status: '1',
  ps: 'site_example_com',
  addtime: '2026-06-07 15:45:13',
  php_version: '8.3',
  project_type: 'PHP',
  ssl: -1,
  site_ssl: -1,
  domain: 1,
  quota: {used: 0, size: 0},
  backup_count: 0,
  rname: 'site.example.com',
};

describe('AaPanelClient.listSites', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    resetGates();
  });
  afterEach(() => vi.restoreAllMocks());

  it('maps a real panel row into the shape the app talks in', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({status: 0, message: {data: [FIXTURE_SITE_ROW]}}) as never,
    );
    const {items, failures} = await new AaPanelClient(cfg).listSites();

    expect(failures).toEqual([]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: 3,
      name: 'site.example.com',
      path: '/www/wwwroot/site.example.com',
      // The panel stores the flag as the string "1" — a boolean here means the
      // view never has to know that.
      running: true,
      phpVersion: '8.3',
      type: 'PHP',
      sslEnabled: false, // -1 means no certificate
      domainCount: 1,
    });
  });

  it('asks the sites table, not some other one', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({status: 0, message: {data: []}}) as never);
    await new AaPanelClient(cfg).listSites();

    expect(String(fetchMock.mock.calls[0][0])).toContain('/v2/data?action=getData');
    expect(String((fetchMock.mock.calls[0][1] as RequestInit).body)).toContain('table=sites');
  });

  it('reads SSL as "not -1" rather than as truthiness', async () => {
    // Both traps in one case: -1 is truthy and would read as "has a certificate",
    // while 0 is a legitimate certificate id that truthiness would discard.
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: 0,
        message: {
          data: [
            {...FIXTURE_SITE_ROW, id: 1, ssl: -1, site_ssl: -1},
            {...FIXTURE_SITE_ROW, id: 2, ssl: 0, site_ssl: -1},
            {...FIXTURE_SITE_ROW, id: 3, ssl: 7, site_ssl: -1},
            {...FIXTURE_SITE_ROW, id: 4, ssl: '-1', site_ssl: '-1'},
          ],
        },
      }) as never,
    );
    const {items} = await new AaPanelClient(cfg).listSites();
    expect(items.map((s) => s.sslEnabled)).toEqual([false, true, true, false]);
  });

  it('keeps a site type it has never seen instead of rejecting the list', async () => {
    // A newer panel adding a type must not blank the page: the type is displayed,
    // not branched on.
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: 0,
        message: {data: [{...FIXTURE_SITE_ROW, project_type: 'SOMETHING_NEW'}]},
      }) as never,
    );
    const {items, failures} = await new AaPanelClient(cfg).listSites();
    expect(failures).toEqual([]);
    expect(items[0].type).toBe('SOMETHING_NEW');
  });

  it('reports a refusal as a failure instead of an empty list', async () => {
    // The whole point of PartialResult: "no sites" and "the panel said no" must
    // not look identical to the operator (ADR-0003).
    fetchMock.mockResolvedValueOnce(
      jsonResponse({status: -1, message: 'The API key is not authorised'}) as never,
    );
    const {items, failures} = await new AaPanelClient(cfg).listSites();
    expect(items).toEqual([]);
    expect(failures).toHaveLength(1);
    expect(failures[0].source).toBe('sites');
    expect(failures[0].message).toContain('not authorised');
  });

  it('survives a row missing the optional columns an older panel omits', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: 0,
        message: {data: [{id: 9, name: 'bare.example.com'}]},
      }) as never,
    );
    const {items, failures} = await new AaPanelClient(cfg).listSites();
    expect(failures).toEqual([]);
    expect(items[0]).toMatchObject({
      id: 9,
      name: 'bare.example.com',
      running: false,
      phpVersion: '',
      sslEnabled: false,
      domainCount: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// A list never claims to be whole when it is not (Д-16)
// ---------------------------------------------------------------------------

describe('list truncation reaches the caller', () => {
  const cfg = {baseUrl: 'https://panel.example.com:8888', apiSk: 'k', tlsMode: 'VERIFY' as const};

  beforeEach(() => {
    fetchMock.mockReset();
    resetGates();
  });
  afterEach(() => vi.restoreAllMocks());

  const rows = (n: number, make: (i: number) => unknown) =>
    Array.from({length: n}, (_, i) => make(i));

  it('reports how much of the site list is missing', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: 0,
        message: {
          data: rows(5, (i) => ({...FIXTURE_SITE_ROW, id: i, name: `s${i}.example.com`})),
          page: "<div><span class='Pcount'>Total 1200</span></div>",
        },
      }) as never,
    );
    // limit=5 stands in for the production 1000: what matters is that the app
    // asked for a number of rows and the panel had more.
    const {items, truncations} = await new AaPanelClient(cfg).listSites({limit: 5});

    expect(items).toHaveLength(5);
    expect(truncations).toEqual([{source: 'sites', shown: 5, total: 1200}]);
  });

  it('asserts completeness when the list is whole', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: 0,
        message: {data: [FIXTURE_SITE_ROW], page: '<div>Total 1</div>'},
      }) as never,
    );
    const {failures, truncations} = await new AaPanelClient(cfg).listSites();

    // Both empty is a statement — "this is all of them" — not an absence.
    expect(failures).toEqual([]);
    expect(truncations).toEqual([]);
  });

  it('names the engine whose database list was cut short', async () => {
    // MySQL has more than was read; PostgreSQL is complete. Merged into one
    // list, the notice must still say where to go looking.
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          status: 0,
          message: {
            data: rows(3, (i) => ({
              id: i,
              name: `db${i}`,
              username: 'u',
              accept: '127.0.0.1',
              ps: '',
              addtime: '2026-01-01 00:00:00',
            })),
            page: '<div>Total 40</div>',
          },
        }) as never,
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: 0,
          message: {
            data: [
              {
                id: 9,
                name: 'pg',
                username: 'u',
                listen_ip: '127.0.0.1',
                ps: '',
                addtime: '2026-01-01 00:00:00',
              },
            ],
            page: '<div>Total 1</div>',
          },
        }) as never,
      );
    const {truncations} = await new AaPanelClient(cfg).listDatabases({limit: 3});

    expect(truncations).toEqual([{source: 'mysql', shown: 3, total: 40}]);
  });

  it('warns without a number when the panel sends no readable count', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({status: 0, message: {data: rows(2, () => ({name: 'app'}))}}) as never,
    );
    const {truncations} = await new AaPanelClient(cfg).listProjects({limit: 2});

    // "There may be more" beats a made-up total: the row count needs no markup.
    expect(truncations).toEqual([{source: 'projects', shown: 2, total: null}]);
  });

  it('does not cry wolf on a list that exactly fills the request', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: 0,
        message: {data: rows(2, () => ({name: 'app'})), page: '<div>Total 2</div>'},
      }) as never,
    );
    const {truncations} = await new AaPanelClient(cfg).listProjects({limit: 2});

    expect(truncations).toEqual([]);
  });

  it('says nothing about truncation when a source refused outright', async () => {
    // A refusal is already reported as a failure. Adding "and it may have had
    // more rows" to a source that returned none would be noise.
    fetchMock.mockResolvedValueOnce(
      jsonResponse({status: -1, message: 'denied'}, 200) as never,
    );
    const {failures, truncations} = await new AaPanelClient(cfg).listSites();

    expect(failures).toHaveLength(1);
    expect(truncations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Site card (Ф-1, slice 2)
// ---------------------------------------------------------------------------

describe('AaPanelClient.getSiteDetail', () => {
  const cfg = {baseUrl: 'https://panel.example.com:8888', apiSk: 'k', tlsMode: 'VERIFY' as const};
  const site = {id: 1, name: 'site.example.com', path: '/www/wwwroot/site.example.com'};

  beforeEach(() => {
    fetchMock.mockReset();
    resetGates();
  });
  afterEach(() => vi.restoreAllMocks());

  /** The four calls go out in parallel, so the mocks are keyed by URL, not order. */
  function answerByEndpoint(answers: Record<string, unknown>) {
    fetchMock.mockImplementation((url: unknown) => {
      const href = String(url);
      const key = Object.keys(answers).find((k) => href.includes(k));
      if (!key) return Promise.resolve(jsonResponse({status: -1, message: 'unexpected'})) as never;
      return Promise.resolve(jsonResponse(answers[key])) as never;
    });
  }

  const OK_DOMAINS = {
    status: 0,
    message: [
      {id: 2, pid: 1, name: 'site.example.com', port: 80, addtime: '2026-05-22 07:26:50'},
      {id: 1, pid: 1, name: 'www.site.example.com', port: 80, addtime: '2026-05-22 07:26:50'},
    ],
  };
  const OK_DIR = {
    status: 0,
    message: {
      logs: {result: true},
      userini: true,
      runPath: {runPath: '/public', dirs: ['/', '/public']},
      pass: {result: false},
    },
  };
  const OK_SSL = {
    status: 0,
    message: {
      status: false,
      oid: -1,
      domain: [{name: 'site.example.com'}],
      httpTohttps: false,
      cert_data: null,
      email: 'admin@example.com',
      auth_type: 'http',
      tls_versions: {TLSv1: false, 'TLSv1.2': true},
      auto_renew: -1,
    },
  };
  const OK_PHP = {status: 0, message: {phpversion: '83', php_other: ''}};

  it('reads the domain list from an envelope that is the array itself', async () => {
    // The site list wraps rows in `data`; this endpoint does not, though both
    // are getData. Getting this wrong loses every domain of every site.
    answerByEndpoint({
      'action=getData': OK_DOMAINS,
      GetDirUserINI: OK_DIR,
      GetSSL: OK_SSL,
      GetSitePHPVersion: OK_PHP,
    });
    const detail = await new AaPanelClient(cfg).getSiteDetail(site);

    expect(detail.failures).toEqual([]);
    expect(detail.domains?.map((d) => d.name)).toEqual(['site.example.com', 'www.site.example.com']);
    expect(detail.domains?.[0].port).toBe(80);
  });

  it('spells the PHP version the way the rest of the app does', async () => {
    // The panel sends "83" here and "8.3" in the list. Showing both would make
    // the card look like it disagrees with the table it was opened from.
    answerByEndpoint({
      'action=getData': OK_DOMAINS,
      GetDirUserINI: OK_DIR,
      GetSSL: OK_SSL,
      GetSitePHPVersion: OK_PHP,
    });
    const detail = await new AaPanelClient(cfg).getSiteDetail(site);

    expect(detail.phpVersion).toBe('8.3');
  });

  it('leaves an unfamiliar PHP version alone instead of mangling it', async () => {
    answerByEndpoint({
      'action=getData': OK_DOMAINS,
      GetDirUserINI: OK_DIR,
      GetSSL: OK_SSL,
      GetSitePHPVersion: {status: 0, message: {phpversion: '8.4.1', php_other: ''}},
    });
    const detail = await new AaPanelClient(cfg).getSiteDetail(site);

    expect(detail.phpVersion).toBe('8.4.1');
  });

  it('reports the served subdirectory, not just the document root', async () => {
    answerByEndpoint({
      'action=getData': OK_DOMAINS,
      GetDirUserINI: OK_DIR,
      GetSSL: OK_SSL,
      GetSitePHPVersion: OK_PHP,
    });
    const detail = await new AaPanelClient(cfg).getSiteDetail(site);

    expect(detail.directory).toMatchObject({
      runPath: '/public',
      userIniProtected: true,
      accessLogEnabled: true,
      passwordProtected: false,
    });
  });

  it('reads auto-renewal off the panel\u2019s -1, not off truthiness', async () => {
    answerByEndpoint({
      'action=getData': OK_DOMAINS,
      GetDirUserINI: OK_DIR,
      GetSSL: OK_SSL,
      GetSitePHPVersion: OK_PHP,
    });
    const detail = await new AaPanelClient(cfg).getSiteDetail(site);

    // -1 is truthy; an "on" badge here would promise renewals that never happen.
    expect(detail.ssl?.autoRenew).toBe(false);
    expect(detail.ssl?.enabled).toBe(false);
    expect(detail.ssl?.tlsVersions).toEqual({TLSv1: false, 'TLSv1.2': true});
  });

  it('keeps the rest of the card when one source refuses', async () => {
    // The whole point of assembling the card from independent parts: an SSL
    // refusal must not blank the domain list, or the operator reads "no
    // domains" and believes it (ADR-0003).
    answerByEndpoint({
      'action=getData': OK_DOMAINS,
      GetDirUserINI: OK_DIR,
      GetSSL: {status: -1, message: 'denied'},
      GetSitePHPVersion: OK_PHP,
    });
    const detail = await new AaPanelClient(cfg).getSiteDetail(site);

    expect(detail.ssl).toBeNull();
    expect(detail.failures.map((f) => f.source)).toEqual(['ssl']);
    expect(detail.domains).toHaveLength(2);
    expect(detail.phpVersion).toBe('8.3');
  });

  it('survives a panel that omits the optional directory fields', async () => {
    answerByEndpoint({
      'action=getData': OK_DOMAINS,
      GetDirUserINI: {status: 0, message: {}},
      GetSSL: OK_SSL,
      GetSitePHPVersion: OK_PHP,
    });
    const detail = await new AaPanelClient(cfg).getSiteDetail(site);

    expect(detail.failures).toEqual([]);
    expect(detail.directory).toMatchObject({runPath: '/', availableDirs: []});
  });
});

describe('AaPanelClient.getSiteLogs', () => {
  const cfg = {baseUrl: 'https://panel.example.com:8888', apiSk: 'k', tlsMode: 'VERIFY' as const};

  beforeEach(() => {
    fetchMock.mockReset();
    resetGates();
  });
  afterEach(() => vi.restoreAllMocks());

  it('returns an empty log as an empty string, not as a failure', async () => {
    // A site with no traffic yet. Turning this into an error would send an
    // operator hunting for a problem that does not exist.
    fetchMock.mockResolvedValueOnce(jsonResponse({status: 0, message: {result: ''}}) as never);
    await expect(new AaPanelClient(cfg).getSiteLogs('site.example.com')).resolves.toBe('');
  });

  it('asks for the requested number of lines', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({status: 0, message: {result: 'x'}}) as never);
    await new AaPanelClient(cfg).getSiteLogs('site.example.com', 50);

    const body = String((fetchMock.mock.calls[0][1] as {body: string}).body);
    expect(body).toContain('lines=50');
    expect(body).toContain('siteName=site.example.com');
  });
});
