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

/** Removes a server registration through its dialog, typed confirmation included. */
export async function removeServer(page: Page, name: string): Promise<void> {
  await page.goto('/servers');
  const row = page.getByRole('row').filter({hasText: name});
  const dialog = page.getByRole('dialog');
  await pressUntil(row.getByRole('button', {name: 'Удалить', exact: true}), dialog);

  await dialog.getByLabel('Введите имя сервера для подтверждения').fill(name);
  await dialog.getByRole('button', {name: 'Удалить', exact: true}).click();

  await expect(page.getByRole('row').filter({hasText: name})).toHaveCount(0);
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
      const dialog = page.getByRole('dialog');
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
      for (const name of added) {
        await cleanup.goto('/servers');
        // Waited for, not counted at once: counting straight after the page
        // arrived found no row and left a registration behind (2026-09-14).
        const present = await cleanup
          .getByRole('row')
          .filter({hasText: name})
          .first()
          .waitFor({state: 'visible', timeout: 10_000})
          .then(
            () => true,
            () => false,
          );
        if (present) await removeServer(cleanup, name);
      }
    } finally {
      await context.close();
    }
  }, {timeout: 60_000}],
});
