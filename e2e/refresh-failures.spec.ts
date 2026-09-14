import type {APIRequestContext, Page, Route} from '@playwright/test';
import {test, expect, login, pressUntil} from './support/app';
import {PANEL_URL} from './support/urls';

/**
 * What the screen says when a call to the app gets no answer, when the session
 * ends, and when the app is updated under an open tab (ADR-0010, ADR-0011 and
 * the stale-data rules of settle-refresh.ts). Until these tests, all of it was
 * checked by hand in a browser: the project has no render tests.
 *
 * The line is cut by Playwright in the browser, never by stopping anything —
 * the app and the stand-in panel keep running.
 */

const TIME = String.raw`\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}`;

interface Cut {
  /** How many action calls have failed so far. */
  count: () => number;
  restore: () => Promise<void>;
}

/**
 * Makes every server-action call from this page fail as a dropped connection.
 *
 * An action call is a POST to the page's own path; the page, its scripts and
 * its RSC requests are GETs and pass untouched. Only buttons that read are
 * pressed while the cut is in place, and nothing that can throw comes before
 * the handler's decision: a handler that throws lets the request through.
 */
async function cutActionCalls(page: Page): Promise<Cut> {
  const path = new URL(page.url()).pathname;
  let failed = 0;
  const matches = (url: URL) => url.pathname === path;
  const handler = (route: Route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    failed += 1;
    return route.abort('internetdisconnected');
  };
  await page.route(matches, handler);
  return {count: () => failed, restore: () => page.unroute(matches, handler)};
}

test('a list that cannot refresh keeps its rows, says how old they are and closes deleting', async ({
  page,
  addServer,
}) => {
  await login(page);
  const serverPath = await addServer({name: `e2e-stale-list-${Date.now()}`, baseUrl: PANEL_URL});
  await page.goto(`${serverPath}/projects`);

  const rows = page.getByRole('row').filter({hasText: 'api-service-'});
  const enabledDeletes = rows.getByRole('button', {name: 'Удалить', exact: true, disabled: false});
  const refresh = page.getByRole('button', {name: 'Обновить', exact: true});
  const age = page.getByText(new RegExp(`^Данные на ${TIME} UTC$`));
  const stale = page.getByRole('status').filter({hasText: 'Не удалось обновить'});

  await expect(rows).toHaveCount(6);
  await expect(age).toBeVisible();
  await expect(enabledDeletes).toHaveCount(6);

  const cut = await cutActionCalls(page);
  await pressUntil(refresh, stale);

  await expect(stale).toContainText(new RegExp(`показаны данные на ${TIME} UTC`));
  await expect(stale).toContainText('Нет связи с приложением');
  await expect(stale).toContainText('Удаление недоступно, пока список не обновится.');
  await expect(rows).toHaveCount(6);
  await expect(enabledDeletes).toHaveCount(0);
  await expect(age).toHaveCount(0);
  expect(cut.count()).toBeGreaterThan(0);

  await cut.restore();
  await refresh.click();

  await expect(stale).toHaveCount(0);
  await expect(age).toBeVisible();
  await expect(enabledDeletes).toHaveCount(6);
});

test('the server summary keeps its readings and their time through failed polls', async ({page, addServer}) => {
  // One poll every four seconds: the first cut poll, one more, then a good one.
  test.setTimeout(60_000);

  await login(page);
  const serverPath = await addServer({name: `e2e-stale-summary-${Date.now()}`, baseUrl: PANEL_URL});
  await page.goto(serverPath);

  const stamp = page.getByText(new RegExp(`^Обновлено: ${TIME} UTC$`));
  const readings = page.getByText('Ядра', {exact: true});
  const noReadings = page.getByText(/^(Сервер недоступен|Не удалось получить показатели) — /);
  const stale = page.getByRole('status').filter({hasText: 'Не удалось обновить'});

  await expect(readings).toBeVisible();
  await expect(stamp).toBeVisible();

  const cut = await cutActionCalls(page);
  await expect(stale).toContainText('Нет связи с приложением', {timeout: 15_000});

  const frozen = (await stamp.textContent()) ?? '';
  const when = new RegExp(`(${TIME}) UTC$`).exec(frozen)?.[1];
  expect(when, 'the summary shows when its readings arrived').toBeTruthy();

  // Another poll fails, and the time on screen is still that of the last readings.
  const failedSoFar = cut.count();
  await expect.poll(cut.count, {timeout: 15_000}).toBeGreaterThan(failedSoFar);
  await expect(stamp).toHaveText(frozen);
  await expect(stale).toContainText(`показаны данные на ${when} UTC`);
  await expect(readings).toBeVisible();
  await expect(noReadings).toHaveCount(0);

  await cut.restore();
  await expect(stale).toHaveCount(0, {timeout: 15_000});
  await expect(stamp).not.toHaveText(frozen);
});

test('an ended session is said above the page, and the notice goes once the session is back', async ({
  page,
  context,
  addServer,
}) => {
  await login(page);
  const serverPath = await addServer({name: `e2e-session-${Date.now()}`, baseUrl: PANEL_URL});
  await page.goto(`${serverPath}/projects`);

  const rows = page.getByRole('row').filter({hasText: 'api-service-'});
  const refresh = page.getByRole('button', {name: 'Обновить', exact: true});
  const ended = page.getByRole('alert').filter({hasText: 'Сеанс завершён. Войдите в новой вкладке'});
  const stale = page.getByRole('status').filter({hasText: 'Не удалось обновить'});

  await expect(rows).toHaveCount(6);

  // Signed out behind the tab's back — what an expired session looks like to it.
  const session = await context.cookies();
  await context.clearCookies();
  await pressUntil(refresh, ended);

  await expect(ended).toBeVisible();
  await expect(stale).toContainText('Сеанс завершён — войдите в приложение снова');
  await expect(rows).toHaveCount(6);

  // Signing in again elsewhere brings the session back; the next answer clears the notice.
  await context.addCookies(session);
  await refresh.click();

  await expect(ended).toHaveCount(0);
  await expect(stale).toHaveCount(0);
});

test.describe('a tab and the build that rendered it (ADR-0011)', () => {
  const NO_BUILD_ID =
    'the server has no build id: run `pnpm build`, then `node scripts/run-next.mjs start` (`pnpm dev` has none)';

  async function serverBuild(request: APIRequestContext): Promise<string | null> {
    const body: unknown = await (await request.get('/api/health')).json();
    const id = body && typeof body === 'object' ? (body as {deploymentId?: unknown}).deploymentId : null;
    return typeof id === 'string' && id.length > 0 ? id : null;
  }

  /**
   * Locally a server without a build id skips these tests, with the reason. In
   * CI it fails them: CI builds through run-next.mjs, so a missing id there is
   * the very defect they are for, and a skip would pass it green.
   */
  function requireBuild(id: string | null): void {
    if (process.env.CI) expect(id, NO_BUILD_ID).toBeTruthy();
    else test.skip(!id, NO_BUILD_ID);
  }

  const outdatedNotice = (page: Page) => page.getByRole('alert').filter({hasText: 'Приложение обновлено'});

  // The watch listens only once React has hydrated the page; a focus before
  // that reaches nobody, so the return to the tab is repeated until it is heard.
  const comeBack = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event('focus')));

  test('coming back to a tab of the running build says nothing', async ({page, request}) => {
    requireBuild(await serverBuild(request));

    let checks = 0;
    page.on('requestfinished', (req) => {
      if (new URL(req.url()).pathname === '/api/health') checks += 1;
    });

    await login(page);
    await expect
      .poll(
        async () => {
          await comeBack(page);
          return checks;
        },
        {timeout: 20_000},
      )
      .toBeGreaterThan(0);

    // The answer is in; two frames let React commit whatever it led to.
    await page.evaluate(
      () => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
    );
    await expect(outdatedNotice(page)).toHaveCount(0);
  });

  test('coming back to a tab after the app was updated says so before anything is pressed', async ({
    page,
    request,
  }) => {
    const current = await serverBuild(request);
    requireBuild(current);

    // In place before the page loads, so whichever check runs first sees the new build.
    await page.route('**/api/health', (route) =>
      route.fulfill({json: {ok: true, deploymentId: `${current}-next`}}),
    );

    await login(page);
    await expect(async () => {
      await comeBack(page);
      await expect(outdatedNotice(page)).toBeVisible({timeout: 2_000});
    }).toPass({timeout: 20_000});
  });
});
