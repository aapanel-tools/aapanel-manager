import {defineConfig} from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    // 'server-only' throws at import time in non-RSC contexts (including Vitest).
    // This alias replaces it with an empty stub so tests of server-only modules
    // still exercise the real logic while the guard is preserved in production.
    alias: {'server-only': path.resolve(__dirname, 'src/__mocks__/server-only.ts')},
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    globals: true,
    // One file at a time. Part of this suite talks to a real PostgreSQL, and the
    // job queue is global by design: `runNextJob` claims the oldest pending job
    // in the database, because in production exactly one leader drains one
    // queue. Two files exercising that concurrently steal each other's jobs —
    // measured as `queue.test.ts` expecting 'succeeded' and finding 'pending'
    // while `jobs.test.ts` expected 'pending' and found 'running'. No amount of
    // per-file cleanup fixes it: the other file creates its rows *during* the
    // test, not before it.
    //
    // Running files sequentially also removes the disk contention that made any
    // test exceed the 20 s ceiling on a busy machine (Д-15). Measured on this
    // box: ~6 s with four failures in six runs, ~39 s with none. Thirty seconds
    // buys a gate whose red actually means something — and the production build
    // in the same gate takes 2.6 minutes anyway.
    fileParallelism: false,
    setupFiles: ['src/test-setup.ts'],
    // Runs once, in the main process, before any worker starts: checks that the
    // database a third of this suite needs is actually there, and stops the run
    // with one readable line instead of 49 connection errors (Д-8).
    globalSetup: ['src/test-globalsetup.ts'],
    // Part of this suite talks to a real PostgreSQL. The first query in a worker
    // also pays for the Prisma engine starting up, which on Windows over a synced
    // folder does not fit in vitest's 5s default — the run then fails on a cold
    // database and passes on a warm one, which is worse than a slow test. CI has
    // a warmed service container and never comes close to this ceiling.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
