# aaPanel Manager

> Self-hosted dashboard for managing a fleet of **aaPanel** servers from one place:
> Node.js projects, databases, live monitoring, and bulk operations across many machines at once.

🌍 **Language:** **English** · [Русский](README.ru.md)

[![CI](https://github.com/aapanel-tools/aapanel-manager/actions/workflows/ci.yml/badge.svg)](https://github.com/aapanel-tools/aapanel-manager/actions/workflows/ci.yml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](LICENSE)

---

![aaPanel Manager — servers dashboard](docs/screenshots/servers.png)

## Why this project

[aaPanel](https://www.aapanel.com/) (the international edition of BT Panel) is a popular web
control panel for Linux servers. It is fine for one server; with dozens, you log into each
panel separately and repeat the same operation by hand as many times as you have machines.

aaPanel Manager exists for exactly that. It talks to panels over their HTTP API and puts one
interface over the whole fleet: a single list of servers with live metrics, project and
database management, bulk operations with a per-server report, and a journal of who did what.

The app is **self-hosted**: it runs on your own server, `api_sk` keys are stored encrypted
(AES-256-GCM) and never reach the browser — a panel is always called through a backend proxy.

API coverage was reconstructed and verified against live aaPanel v8 panels, including the
parts the official documentation does not describe.

## App features

- 🖥️ **Multi-server** — add / edit / remove aaPanel servers; `api_sk` encrypted at rest (AES-256-GCM)
- 🟢 **Node.js projects** — list, status, info, logs, start / stop / restart, create / modify / delete
- 📊 **Live monitoring** — CPU / RAM / disk with auto-refresh (in-process polling + Server-Sent Events)
- 👥 **Users & roles** — admin / viewer, user management, self password change
- 🗄️ **Databases** — MySQL and PostgreSQL in one table (each engine has its own API); create and delete with typed confirmation
- ⚡ **Bulk operations** — one operation across many servers: preview, a canary server first, stop at the first failure, a per-server report, and cancellation
- 📓 **Operations journal** — who changed what, on which server, and how it ended
- 🔒 **Secure by design** — backend proxy; secrets never reach the browser; the panel's TLS certificate is pinned by fingerprint rather than trusted blindly
- 🌐 **i18n & themes** — English / Russian, light / dark

> **Status:** actively developed. Multi-server, Node.js projects, databases, monitoring, bulk operations, the operations journal and user management work today. Files, FTP, cron and firewall are already covered in the API docs and are on the roadmap for the app.

## Screenshots

|  |  |
|---|---|
| **Servers (dark theme)**<br>![Servers — dark](docs/screenshots/servers-dark.png) | **Add a server**<br>![Add server](docs/screenshots/add-server.png) |
| **Users & roles**<br>![Users](docs/screenshots/users.png) | **Versions & updates**<br>![Settings](docs/screenshots/settings.png) |

## Tech stack

Next.js 16 (App Router · React Server Components · Server Actions) · React 19 · TypeScript · Prisma 7 + PostgreSQL · Auth.js v5 · Tailwind v4 · Docker.

## Quick start (development)

**Requirements:** Node 24, pnpm 11 (`corepack enable`), PostgreSQL.

```bash
git clone https://github.com/aapanel-tools/aapanel-manager.git
cd aapanel-manager/web
pnpm install
cp .env.example .env          # set DATABASE_URL, AUTH_SECRET, APP_ENCRYPTION_KEY
pnpm prisma migrate deploy
pnpm dev                      # http://localhost:3000
```

For production (Docker images, releasing by tag, self-update) see [docs/RELEASING.md](docs/RELEASING.md).

## Roadmap

- [x] Multiple servers: add, test the connection, keys encrypted at rest
- [x] Node.js projects: list, status, logs, start / stop / restart, create and modify
- [x] Databases: MySQL and PostgreSQL in one table, create and delete
- [x] Live monitoring: CPU / RAM / disk, background polling and updates over SSE
- [x] Bulk operations: preview, a canary server first, stop at the first failure, a per-server report
- [x] Operations journal, users and roles
- [x] The panel's TLS certificate pinned by fingerprint
- [x] Versions and updates: releases by tag, Docker image, self-update
- [ ] Sites, files, FTP, cron, firewall
- [ ] Alerts and a fleet-wide summary

## Disclaimer

An unofficial tool, not affiliated with the aaPanel developers. Verified on aaPanel v8;
panel behaviour may change between versions. Official panel documentation:
[aapanel.com/docs](https://www.aapanel.com/docs/).

## License

Copyright (c) 2026 vsgrade.

[GNU Affero General Public License v3.0](LICENSE) — you may run, study, modify and
share this software. If you modify it and let others use it over a network, you must
offer them the source of your modified version under the same terms.
