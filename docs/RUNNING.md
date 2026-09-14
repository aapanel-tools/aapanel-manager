# aaPanel Manager — running the app

Next.js 16 App Router front-end + back-end proxy for managing aaPanel servers.
Auth, server CRUD, the operations journal, bulk operations over many servers, and
live monitoring via an in-process background poller.

---

## Prerequisites

| Tool | Version |
|------|---------|
| Node.js | 24 LTS |
| pnpm | via `corepack enable` |
| PostgreSQL | 17 — **or** Docker (see below) |

---

## Environment setup

```bash
cp .env.example .env
```

Edit `.env` and fill in:

| Variable | How to generate / notes |
|----------|-------------------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `APP_ENCRYPTION_KEY` | `openssl rand -hex 32` |
| `SEED_ADMIN_EMAIL` | e.g. `admin@example.com` |
| `SEED_ADMIN_PASSWORD` | e.g. `changeme123` (change in prod) |
| `POLL_INTERVAL_MS` | Background poll interval in ms (default: `60000`) |
| `WORKER_CONCURRENCY` | Max parallel server polls per cycle (default: `16`) |
| `ENABLE_POLLER` | Poll in-process (default: `true`); set `false` only with a dedicated worker |

---

## Run mode 1 — Bare-metal (development)

```bash
pnpm install
pnpm prisma migrate dev    # applies migrations + creates dev DB
pnpm prisma db seed        # seeds admin user (SEED_ADMIN_* from .env)
pnpm dev                   # starts Next.js dev server on :3000
```

Default seeded admin: `admin@example.com` / `changeme123`
(set via `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` in `.env`).

---

## Run mode 2 — Bare-metal (production, Ubuntu)

One process: the Next.js server, which also polls aaPanel servers in-process.
No separate worker is needed — a Postgres advisory lock keeps polling correct
even if you run several app replicas.

```bash
pnpm install --frozen-lockfile
pnpm prisma migrate deploy   # apply pending migrations (no prompt, no seed)
pnpm build                   # production build → .next/
```

The app is started with `node scripts/run-next.mjs start` from the repository
root — the same command the Docker image and the release bundle use. It loads
`.env` from the working directory and runs `next start`. There is no standalone
output (see the comment in `next.config.ts`): `.next/standalone/server.js` does
not exist.

### Option A — pm2

Install pm2 once: `npm install -g pm2`

Create `ecosystem.config.cjs` in the repository root:

```js
// ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'aapanel-web',
      script: 'scripts/run-next.mjs',
      args: 'start',
      cwd: __dirname,
      // run-next.mjs reads .env from cwd; these win over it.
      env: { NODE_ENV: 'production', PORT: '3000' },
    },
  ],
};
```

```bash
pm2 start ecosystem.config.cjs
pm2 save           # persist across reboots
pm2 startup        # follow the printed command to enable on boot
```

### Option B — systemd unit

`/etc/systemd/system/aapanel-web.service`:

```ini
[Unit]
Description=aaPanel Manager – web server + in-process poller
After=network.target postgresql.service

[Service]
Type=simple
User=nodeapp
WorkingDirectory=/srv/aapanel
EnvironmentFile=/srv/aapanel/.env
Environment=NODE_ENV=production
Environment=PORT=3000
ExecStart=/usr/bin/node scripts/run-next.mjs start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now aapanel-web
sudo journalctl -fu aapanel-web   # follow logs
```

> **Important:** run `pnpm prisma migrate deploy` before starting (and on every
> deploy) so the schema is in place.
>
> **Dedicated worker (optional):** to move polling off the web server, set
> `ENABLE_POLLER=false` on the web process and run `pnpm worker` separately.
> The Postgres advisory lock ensures exactly one active poller, so neither
> several web replicas nor an extra worker ever double-poll.

---

## Run mode 3 — Docker Compose

`docker-compose.yml` starts two containers:

```
postgres (health-checked)
  └─► app   (runs `prisma migrate deploy` on start, then serves + polls, :3000)
```

A single image: its entrypoint applies pending migrations, then runs the server.
There is no separate migrate/worker container.

```bash
# 1. Fill in DATABASE_URL, AUTH_SECRET, APP_ENCRYPTION_KEY (+ POSTGRES_PASSWORD) in .env
cp .env.example .env

# 2. Build and start everything
docker compose up --build

# Or in detached mode:
docker compose up --build -d
docker compose logs -f app   # tail app logs (incl. poll cycles)
```

### Required env vars for Docker

All values come from `.env` (via `env_file: .env` in compose).
The minimum set for production:

```
DATABASE_URL=postgresql://aapanel:<POSTGRES_PASSWORD>@postgres:5432/aapanel_manager
POSTGRES_PASSWORD=<strong password>
AUTH_SECRET=<openssl rand -base64 32>
APP_ENCRYPTION_KEY=<openssl rand -hex 32>
POLL_INTERVAL_MS=60000
WORKER_CONCURRENCY=16
ENABLE_POLLER=true
```

> **Note:** one image (the `runner` stage) carries the full `node_modules`
> (incl. the Prisma CLI), so its entrypoint runs `prisma migrate deploy` on start
> and then `next start`. No separate migrate/worker container.
>
> **Scaling:** run several `app` replicas if needed — a Postgres advisory lock
> means exactly one polls, and concurrent migrate-on-start runs serialize
> (Prisma locks migrations), so replicas are safe.

---

## Available scripts

| Script | What it does |
|--------|-------------|
| `pnpm dev` | Start dev server (hot-reload) |
| `pnpm build` | Production build (`.next/`) |
| `pnpm start` | Start production server |
| `pnpm worker` | Start an *optional* dedicated poller (the app polls in-process by default) |
| `pnpm lint` | Run ESLint |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Run Vitest unit/integration tests |
| `pnpm test:e2e` | Run Playwright E2E tests |

> **Important:** run `pnpm build` before `pnpm typecheck`.
> Next.js TypedRoutes generates `.next/types/` during build; `tsc --noEmit`
> needs those generated types.
>
> Recommended CI order: `pnpm build && pnpm typecheck && pnpm test`

---

## E2E tests

Playwright tests live in `e2e/`. `playwright.config.ts` starts two servers,
or reuses them when they are already running:

- a stand-in aaPanel on `127.0.0.1:8899` (`e2e/support/fake-panel.mjs`) — the
  suite never talks to a real panel;
- the app on `localhost:3000` via `pnpm dev`.

They also need a reachable database with the seeded admin user
(`prisma/seed.ts`; the tests read the same `SEED_ADMIN_EMAIL` /
`SEED_ADMIN_PASSWORD` overrides). Each test adds the servers it needs, pointed
at the stand-in panel, and removes them afterwards, pass or fail.

Before the tests, `e2e/support/warm-up.ts` signs in once and opens every route
the suite visits, so that `pnpm dev` compiles them outside the tests' timeouts.
If the admin cannot sign in, the run stops there with one message.

Start the dev server fresh for an e2e run: after hot reloads it has been seen to
answer 500 and 404 for pages that work after a restart.

```bash
pnpm test:e2e
```

The two build-id tests (ADR-0011) need a production build started through the
launcher; against `pnpm dev` they are skipped, and the report says why:

```bash
pnpm build
node scripts/run-next.mjs start   # in another terminal — the suite reuses it
pnpm test:e2e
```

In CI the suite is the `e2e` job of `.github/workflows/ci.yml`: a production
build started with `node scripts/run-next.mjs start`, a seeded database and the
stand-in panel. There nothing already running is reused, and the build-id tests
fail rather than skip when the build has no id.
