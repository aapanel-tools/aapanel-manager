import {defineConfig} from '@playwright/test';
import {APP_URL, PANEL_PORT, PANEL_URL} from './e2e/support/urls';

/**
 * In CI (the `e2e` job of .github/workflows/ci.yml) the suite runs against the
 * production build made by the step before it; locally, against whatever answers
 * on the port, or `pnpm dev`.
 */
const CI = Boolean(process.env.CI);

export default defineConfig({
  testDir: './e2e',
  // Signs in once and opens every route before the tests, so `pnpm dev` compiles
  // them outside the tests' timeouts (e2e/support/warm-up.ts).
  globalSetup: './e2e/support/warm-up.ts',
  // A stray test.only must not turn a CI run into a run of one test.
  forbidOnly: CI,
  // No retries: a test that passes on its second try is reported as passing, and
  // the instability that hides is what this suite is there to show.
  retries: 0,
  reporter: CI ? [['list'], ['github']] : 'list',
  use: {baseURL: APP_URL, trace: 'retain-on-failure'},
  webServer: [
    {
      // The only panel the suite talks to (e2e/support/fake-panel.mjs).
      command: `node e2e/support/fake-panel.mjs ${PANEL_PORT}`,
      url: `${PANEL_URL}/ready`,
      reuseExistingServer: !CI,
      timeout: 15_000,
    },
    {
      // In CI: the build, started the way production starts it, so the build-id
      // tests run (ADR-0011); a server CI did not start is not the build under
      // test, so nothing is reused there. Locally a server already on the port is
      // used as it is — a build started with `node scripts/run-next.mjs start`
      // included — and otherwise `pnpm dev`.
      command: CI ? 'node scripts/run-next.mjs start' : 'pnpm dev',
      url: APP_URL,
      reuseExistingServer: !CI,
      stdout: CI ? 'pipe' : 'ignore',
      timeout: 120_000,
    },
  ],
});
