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
    setupFiles: ['src/test-setup.ts'],
    // Part of this suite talks to a real PostgreSQL. The first query in a worker
    // also pays for the Prisma engine starting up, which on Windows over a synced
    // folder does not fit in vitest's 5s default — the run then fails on a cold
    // database and passes on a warm one, which is worse than a slow test. CI has
    // a warmed service container and never comes close to this ceiling.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
