import {defineConfig} from '@playwright/test';
import {APP_URL, PANEL_PORT, PANEL_URL} from './e2e/support/urls';

export default defineConfig({
  testDir: './e2e',
  // Signs in once and opens every route before the tests, so `pnpm dev` compiles
  // them outside the tests' timeouts (e2e/support/warm-up.ts).
  globalSetup: './e2e/support/warm-up.ts',
  use: {baseURL: APP_URL, trace: 'retain-on-failure'},
  webServer: [
    {
      // The only panel the suite talks to (e2e/support/fake-panel.mjs).
      command: `node e2e/support/fake-panel.mjs ${PANEL_PORT}`,
      url: `${PANEL_URL}/ready`,
      reuseExistingServer: true,
      timeout: 15_000,
    },
    {
      // A server already running on the port is used as it is — including a
      // production build started with `node scripts/run-next.mjs start`, which
      // the build-id test needs (ADR-0011).
      command: 'pnpm dev',
      url: APP_URL,
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
