import {test as base, expect, type Page} from '@playwright/test';
import {login, pressUntil} from './session';

export {expect};
export {ADMIN, login, pressUntil} from './session';

/** Long enough to pass the form's check; a key to nothing. */
const DUMMY_API_SK = 'e2e_dummy_api_sk_value_1234';

export interface ServerToAdd {
  name: string;
  /** Loopback or unroutable only — never a real panel. */
  baseUrl: string;
}

/**
 * Opens the servers table narrowed to one name and says whether that server is
 * in it. It waits for the row or for the empty-list sentence — whichever the app
 * draws — so the answer comes from the app, not from how long a check waited.
 */
async function isListed(page: Page, name: string): Promise<boolean> {
  await page.goto(`/servers?q=${encodeURIComponent(name)}`);
  const row = page.getByRole('row').filter({hasText: name});
  await expect(row.or(page.getByText('Серверов пока нет', {exact: true})).first()).toBeVisible();
  return (await row.count()) > 0;
}

/** Removes a server registration through its dialog, typed confirmation included. */
export async function removeServer(page: Page, name: string): Promise<void> {
  await page.goto(`/servers?q=${encodeURIComponent(name)}`);
  const row = page.getByRole('row').filter({hasText: name});
  // This dialog, by its title, rather than whatever has the role.
  const dialog = page.getByRole('dialog', {name: 'Удалить', exact: true});
  const confirm = dialog.getByLabel('Введите имя сервера для подтверждения');

  // Open, type, confirm — and from the top again if a step cannot be done. The
  // open press may land before hydration and do nothing; and in `pnpm dev` the
  // confirmation field sometimes could not be filled right after the dialog had
  // opened, with no navigation or refresh in between (2026-09-14, cause not
  // found), which left the cleanup waiting out its whole minute. The confirming
  // press is the last step, so a retry never removes twice.
  await expect(async () => {
    if (!(await dialog.isVisible())) {
      await row.getByRole('button', {name: 'Удалить', exact: true}).click({timeout: 2_000});
    }
    await confirm.fill(name, {timeout: 2_000});
    await dialog.getByRole('button', {name: 'Удалить', exact: true}).click({timeout: 2_000});
  }).toPass({timeout: 30_000});

  // The dialog closes only once the app has answered that the server is gone.
  // Checking the table straight after the click passed before the removal had
  // finished, the test moved on, and the page was closed under a request still
  // on its way: on 2026-09-14 the journal showed registrations created by e2e
  // and never deleted, while every removal had "succeeded".
  await expect(dialog).toBeHidden({timeout: 15_000});
  expect(await isListed(page, name), `${name} is still listed after it was removed`).toBe(false);
}

export const test = base.extend<{
  /**
   * Adds a server through the form and returns the path of its page. Whatever a
   * test adds is removed after it, pass or fail: a registration left behind is
   * polled by the app from then on.
   */
  addServer: (server: ServerToAdd) => Promise<string>;
}>({
  // Its own timeout rather than the test's: removing what the test added signs
  // in again (argon2id) and goes through the dialog, and on `pnpm dev` that
  // outlasted the thirty seconds a passing test had left (2026-09-14). The
  // second argument is Playwright's `use`, named otherwise: the React hooks lint
  // rule takes any call of `use` for React's hook.
  addServer: [async ({page, browser, baseURL}, provide) => {
    const added: string[] = [];

    await provide(async ({name, baseUrl}) => {
      await page.goto('/servers');
      const dialog = page.getByRole('dialog', {name: 'Добавить сервер', exact: true});
      await pressUntil(page.getByRole('button', {name: /добавить сервер/i}), dialog);

      await dialog.getByLabel(/название/i).fill(name);
      await dialog.getByLabel(/url панели/i).fill(baseUrl);
      await dialog.getByLabel(/ключ api/i).fill(DUMMY_API_SK);
      // Noted before saving: a save that lands while a check below fails is still removed.
      added.push(name);
      await dialog.getByRole('button', {name: /сохранить/i}).click();
      await expect(dialog).not.toBeVisible();

      const link = page.getByRole('link', {name, exact: true});
      await expect(link).toBeVisible();
      const href = await link.getAttribute('href');
      if (!href || !/^\/servers\/[^/?#]+$/.test(href)) {
        throw new Error(`the servers table has no link to the page of ${name} (href: ${href})`);
      }
      return href;
    });

    if (added.length === 0) return;
    // A context of its own: the test may have ended signed out or on a broken page.
    const context = await browser.newContext({baseURL});
    try {
      const cleanup = await context.newPage();
      await login(cleanup);
      // Whether each server is still there is the app's answer, not a timed look
      // at the table: a cleanup that gave up after ten seconds without a row left
      // registrations behind with every test green (2026-09-14).
      for (const name of added) {
        if (await isListed(cleanup, name)) await removeServer(cleanup, name);
      }
    } finally {
      // After a timeout Playwright has already closed it, and the error from closing
      // it twice would be reported in place of the timeout that explains the failure.
      await context.close().catch(() => undefined);
    }
  }, {timeout: 60_000}],
});
