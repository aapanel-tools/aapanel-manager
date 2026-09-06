FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=$PNPM_HOME:$PATH
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

# ── deps: install all dependencies (incl. devDeps for the prisma CLI) ─────────
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ── builder: generate the Prisma client + build the Next.js app ───────────────
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build-time-only env. `next build` loads route modules, and src/lib/db/prisma.ts
# instantiates the client at import (DATABASE_URL must be present — it never
# connects; all app pages are auth-gated/dynamic, so no queries run at build).
# These values are scoped to this RUN only: NOT baked into any image layer and
# never used at runtime (the runner receives the real env).
RUN export DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build" \
           AUTH_SECRET="build-time-placeholder-not-used-at-runtime-0000" \
           APP_ENCRYPTION_KEY="0000000000000000000000000000000000000000000000000000000000000000" \
 && pnpm prisma generate \
 && pnpm build

# ── runner: single image — applies migrations on start, then runs the server ──
# One image (not a separate runner + migrate/worker): it carries the full
# node_modules so the bundled prisma CLI can run `prisma migrate deploy` at
# startup, then `next start` serves the app. The app also polls aaPanel servers
# in-process (src/instrumentation.ts), guarded by a Postgres advisory lock, so
# scaling to several replicas is safe — no separate worker process is needed.
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
# Version metadata (passed by the release workflow) — surfaced by getCurrentVersion().
ARG APP_VERSION=""
ARG APP_COMMIT=""
ARG APP_BUILD_TIME=""
ENV APP_VERSION=$APP_VERSION APP_COMMIT=$APP_COMMIT APP_BUILD_TIME=$APP_BUILD_TIME
# Full build output: node_modules (incl. prisma CLI), the compiled app, static
# assets, and the files `next start` + `prisma migrate deploy` need.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=builder /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/tsconfig.json ./tsconfig.json
# The build cache is not needed at runtime — drop it to keep the image smaller.
RUN rm -rf ./.next/cache
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
EXPOSE 3000
# Apply pending migrations, then run the CMD (the web server).
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["pnpm", "start"]
