/**
 * A stand-in aaPanel for the end-to-end suite; playwright.config.ts starts it.
 *
 * The suite must never point the app at somebody's production machine, so the
 * panel it talks to is this one: loopback only, any key accepted, signatures
 * not checked. It answers what the server pages read — the summary's readings,
 * Node.js projects, databases, sites — and copies the panel's real behaviour
 * where a test relies on it: `search` filters with a LIKE over name and note,
 * and `page` reports the count of matching rows (both checked against a live
 * v8 panel on 2026-09-10).
 *
 * Anything else is refused the way a panel refuses, `{status: -1, message}`, so
 * a page that starts asking for more fails visibly instead of hanging.
 */
import {createServer} from 'node:http';

const PORT = Number(process.argv[2]);
if (!Number.isInteger(PORT) || PORT <= 0) {
  console.error('usage: node e2e/support/fake-panel.mjs <port>');
  process.exit(2);
}

const SITE_COUNT = 1200; // more than DEFAULT_PAGE_LIMIT, so truncation is visible

const sites = Array.from({length: SITE_COUNT}, (_, i) => ({
  id: i + 1,
  name: `site${String(i + 1).padStart(4, '0')}.example.com`,
  rname: `site${String(i + 1).padStart(4, '0')}.example.com`,
  path: `/www/wwwroot/site${i + 1}`,
  status: i % 7 === 0 ? '0' : '1',
  ps: i % 5 === 0 ? 'магазин' : '',
  addtime: '2026-01-01 00:00:00',
  php_version: i % 3 === 0 ? '8.3' : '7.4',
  project_type: i % 11 === 0 ? 'WP' : 'PHP',
  ssl: i % 4 === 0 ? 12 : -1,
  domain: (i % 3) + 1,
  backup_count: 0,
}));

const mysqlDbs = Array.from({length: 12}, (_, i) => ({
  id: i + 1,
  name: `wp_shop_${i + 1}`,
  username: `wp_shop_${i + 1}`,
  accept: '127.0.0.1',
  ps: i % 4 === 0 ? 'основной' : '',
  addtime: '2026-01-01 00:00:00',
  backup_count: 0,
}));

const pgDbs = Array.from({length: 4}, (_, i) => ({
  id: i + 1,
  name: `pg_analytics_${i + 1}`,
  username: `pg_user_${i + 1}`,
  listen_ip: '127.0.0.1/32',
  ps: '',
  addtime: '2026-01-01 00:00:00',
  backup_count: 0,
}));

const projects = Array.from({length: 6}, (_, i) => ({
  name: `api-service-${i + 1}`,
  path: `/www/node/api-${i + 1}`,
  run: i % 2 === 0,
  project_config: {port: 3100 + i},
  load_info: i % 2 === 0 ? {'1234': {cpu_percent: 1.5, memory_used: 52428800}} : {},
}));

/** The panel's own filter: (name LIKE %term% OR ps LIKE %term%), case-insensitive. */
function like(rows, term) {
  if (!term) return rows;
  const needle = term.toLowerCase();
  return rows.filter(
    (r) =>
      String(r.name ?? '').toLowerCase().includes(needle) ||
      String(r.ps ?? '').toLowerCase().includes(needle),
  );
}

const pageMarkup = (total) =>
  `<div><span class='Pcurrent'>1</span><span class='Pcount'>Total ${total}</span></div>`;

/** A paged answer shaped like the panel's: filtered rows, filtered count. */
function paged(rows, term, limit) {
  const matched = like(rows, term);
  return {data: matched.slice(0, limit), page: pageMarkup(matched.length)};
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => resolve(new URLSearchParams(raw)));
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  const json = (body) => {
    res.writeHead(200, {'content-type': 'application/json'});
    res.end(JSON.stringify(body));
  };

  let form;
  try {
    form = req.method === 'POST' ? await readBody(req) : new URLSearchParams();
  } catch {
    res.writeHead(400).end();
    return;
  }

  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
  const path = url.pathname;
  const action = url.searchParams.get('action');

  // Playwright's webServer waits for this before the suite starts.
  if (path === '/ready') {
    res.writeHead(200, {'content-type': 'text/plain'});
    res.end('ok');
    return;
  }

  // Parameters arrive either as flat form fields or inside a JSON `data` field.
  let data = {};
  const rawData = form.get('data');
  if (rawData) {
    try {
      data = JSON.parse(rawData);
    } catch {
      data = {};
    }
  }
  const search = String(data.search ?? form.get('search') ?? '');
  const limit = Number(data.limit ?? form.get('limit') ?? 1000);

  if (path === '/system' && action === 'GetSystemTotal') {
    return json({cpuRealUsed: 4.2, cpuNum: 4, memTotal: 8192, memRealUsed: 2048});
  }
  if (path === '/system' && action === 'GetDiskInfo') {
    return json([{path: '/', size: ['128G', '30G', '94G', '24%']}]);
  }
  if (path === '/system' && action === 'GetNetWork') {
    return json({up: 0.1, down: 0.4, load: {one: 0.1, five: 0.2, fifteen: 0.3}});
  }

  if (path === '/v2/data' && action === 'getData') {
    const table = form.get('table');
    if (table === 'sites') return json({status: 0, message: paged(sites, search, limit)});
    if (table === 'databases') return json({status: 0, message: paged(mysqlDbs, search, limit)});
    if (table === 'domain') return json({status: 0, message: []});
  }

  if (path === '/v2/database/pgsql/get_list') {
    return json({status: 0, message: paged(pgDbs, search, limit)});
  }

  if (path === '/v2/project/nodejs/get_project_list') {
    return json({status: 0, message: paged(projects, search, limit)});
  }

  // Said on stderr, which Playwright shows: a test that fails because the page
  // asked for something new is explained here.
  console.error(`fake panel: unhandled ${req.method} ${path}?action=${action ?? ''}`);
  json({status: -1, message: `fake panel: ${path}?action=${action ?? ''} is not implemented`});
});

server.listen(PORT, '127.0.0.1', () => console.log(`fake panel on http://127.0.0.1:${PORT}`));
