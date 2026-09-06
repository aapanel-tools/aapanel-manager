#!/bin/sh
# Single-image entrypoint: apply pending DB migrations, then run the web server.
# `prisma migrate deploy` is idempotent and takes a Postgres advisory lock, so it
# is safe even when several replicas start at once (they serialize; extras find
# nothing to apply). `set -e` aborts startup if migrations fail — the container
# never serves against an out-of-date schema.
set -e

echo "[entrypoint] applying database migrations (prisma migrate deploy)…"
pnpm prisma migrate deploy

echo "[entrypoint] starting application…"
exec "$@"
