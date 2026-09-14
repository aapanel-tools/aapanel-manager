import {chromium, type FullConfig} from '@playwright/test';
import {login} from './session';

/**
 * Opens every route the suite visits, once, before any test starts.
 *
 * `pnpm dev` compiles a route on its first request, and that request is slow.
 * Measured on 2026-09-14 with four workers starting together: 23 s for /login,
 * 13–15 s for the fleet summary — counted against each test's own timeouts, so
 * three sign-ins failed. A route first requested while others were still
 * compiling also came back once as Next's own 404 page, for a server that
 * existed. After this the tests time the app, not the compiler; against a
 * production build it costs a few seconds.
 *
 * It also stops the run with one sentence when the seeded administrator cannot
 * sign in, instead of the same failure in every test.
 *
 * Playwright starts the webServer entries before globalSetup, so the app and
 * the stand-in panel are already up here.
 */
export default async function warmUp(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({baseURL});
    try {
      await login(page);
    } catch (cause) {
      throw new Error(
        'e2e warm-up: the seeded administrator could not sign in — is the database up and seeded (prisma/seed.ts)?',
        {cause},
      );
    }
    // An id that matches no server still compiles each route: the layout answers not-found.
    for (const path of ['/servers', '/servers/warm-up', '/servers/warm-up/projects']) {
      await page.goto(path);
    }
  } finally {
    await browser.close();
  }
}
