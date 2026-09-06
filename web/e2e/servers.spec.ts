import {test, expect} from '@playwright/test';

const ADMIN = {email: 'admin@example.com', password: 'changeme123'};

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  // Label association via htmlFor/id; fall back to name-attribute selectors
  // (same pattern used in auth.spec.ts).
  await page.locator('input[name="email"]').fill(ADMIN.email);
  await page.locator('input[name="password"]').fill(ADMIN.password);
  await page.getByRole('button', {name: /войти|sign in/i}).click();
  // / redirects to /servers
  await expect(page).toHaveURL(/\/servers/);
}

test('admin can add a server, see it in the table, and delete it', async ({page}) => {
  const name = `e2e-${Date.now()}`;

  await login(page);

  // ── Add server ──────────────────────────────────────────────────────────────
  // The toolbar renders "Добавить сервер" via t('add').
  await page.getByRole('button', {name: /добавить сервер/i}).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  // Fields are wired via htmlFor → id (sf-name, sf-baseUrl, sf-apiSk, sf-tag).
  // getByLabel resolves through that association.
  await dialog.getByLabel(/название/i).fill(name);
  await dialog.getByLabel(/url панели/i).fill('https://10.255.255.1:8888');
  await dialog.getByLabel(/ключ api/i).fill('e2e_dummy_api_sk_value_1234');

  // Submit — do NOT click "Проверить подключение".
  await dialog.getByRole('button', {name: /сохранить/i}).click();

  // ── Verify row appears ───────────────────────────────────────────────────────
  // createServerAction calls revalidatePath('/servers'); the page will refresh.
  // Wait for the dialog to close first, then the row to appear.
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('cell', {name})).toBeVisible();

  // ── Delete it ────────────────────────────────────────────────────────────────
  // Find the table row containing our server name, then click its delete icon
  // (aria-label "Удалить") scoped to that row to avoid ambiguity with the
  // dialog title / confirm button.
  const row = page.getByRole('row').filter({hasText: name});
  await row.getByRole('button', {name: /^удалить$/i}).click();

  // The delete confirmation dialog opens.
  const confirmDialog = page.getByRole('dialog');
  await expect(confirmDialog).toBeVisible();

  // The destructive confirm button (variant="destructive") — text is "Удалить".
  // Scope strictly to the dialog to avoid clicking the row button again.
  await confirmDialog.getByRole('button', {name: /^удалить$/i}).click();

  // ── Verify row is gone ───────────────────────────────────────────────────────
  // deleteServerAction calls revalidatePath + router.refresh(); row should vanish.
  await expect(page.getByRole('cell', {name})).toHaveCount(0);
});
