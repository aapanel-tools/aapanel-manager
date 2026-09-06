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
pnpm build                   # Next.js standalone output → .next/standalone/
```

### Option A — pm2

Install pm2 once: `npm install -g pm2`

Create `ecosystem.config.cjs` in the repository root:

```js
// ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'aapanel-web',
      script: 'node',
      args: 'server.js',
      cwd: '.next/standalone',
      env_file: '.env',
      // Next.js standalone ignores NODE_ENV from env_file in some versions;
      // set it explicitly here too:
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
WorkingDirectory=/srv/aapanel/.next/standalone
EnvironmentFile=/srv/aapanel/.env
Environment=NODE_ENV=production
Environment=PORT=3000
ExecStart=/usr/bin/node server.js
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
| `pnpm build` | Production build (Next.js standalone) |
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

Playwright tests live in `e2e/`. They require a running dev server (the
`playwright.config.ts` `webServer` block starts it automatically) and a
reachable database with the seeded admin user.

```bash
pnpm test:e2e
```
