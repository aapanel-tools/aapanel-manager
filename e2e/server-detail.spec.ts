import {test, expect} from '@playwright/test';

const ADMIN = {email: 'admin@example.com', password: 'changeme123'};

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.locator('input[name="email"]').fill(ADMIN.email);
  await page.locator('input[name="password"]').fill(ADMIN.password);
  await page.getByRole('button', {name: /войти|sign in/i}).click();
  await expect(page).toHaveURL(/\/servers/);
}

test('server detail: overview offline banner + projects load-failed, then cleanup', async ({page}) => {
  const name = `e2e-detail-${Date.now()}`;

  // ── 1. Login ─────────────────────────────────────────────────────────────────
  await login(page);

  // ── 2. Create server ─────────────────────────────────────────────────────────
  await page.getByRole('button', {name: /добавить сервер/i}).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  await dialog.getByLabel(/название/i).fill(name);
  // Use http://127.0.0.1:1 — connection refused immediately (fast-failing).
  await dialog.getByLabel(/url панели/i).fill('http://127.0.0.1:1');
  await dialog.getByLabel(/ключ api/i).fill('e2e_dummy_api_sk_value_1234');
  await dialog.getByRole('button', {name: /сохранить/i}).click();

  await expect(dialog).not.toBeVisible();
  // Server name is rendered as a link inside a table cell.
  await expect(page.getByRole('link', {name})).toBeVisible();

  // ── 3. Click server name → detail page ───────────────────────────────────────
  await page.getByRole('link', {name}).click();
  await expect(page).toHaveURL(/\/servers\/[^/]+$/);

  // Heading shows server name (h1 in layout).
  await expect(page.getByRole('heading', {level: 1, name})).toBeVisible();

  // Overview offline banner — text is t('offline') = "Сервер недоступен".
  // The component renders it as a <p> inside a bordered div.
  // Use a broad text match since it's followed by " — <error message>".
  await expect(page.locator('text=Сервер недоступен').first()).toBeVisible({timeout: 15_000});

  // ── 4. Navigate to Projects via section nav ───────────────────────────────────
  // Section nav renders <Link> with text from detail.projects = "Проекты".
  await page.getByRole('link', {name: 'Проекты'}).click();
  await expect(page).toHaveURL(/\/servers\/[^/]+\/projects$/);

  // Projects load-failed banner — role="alert", text t('loadFailed') = "Не удалось загрузить проекты".
  // Filter to the specific alert that contains the expected text (excludes Next.js route announcer).
  const loadFailedAlert = page.getByRole('alert').filter({hasText: 'Не удалось загрузить проекты'});
  await expect(loadFailedAlert).toBeVisible({timeout: 15_000});
  await expect(loadFailedAlert).toContainText('Не удалось загрузить проекты');

  // ── 5. Go back to /servers and delete the created server ─────────────────────
  await page.goto('/servers');
  await expect(page).toHaveURL(/\/servers/);

  const row = page.getByRole('row').filter({hasText: name});
  await row.getByRole('button', {name: /^удалить$/i}).click();

  const confirmDialog = page.getByRole('dialog');
  await expect(confirmDialog).toBeVisible();
  await confirmDialog.getByRole('button', {name: /^удалить$/i}).click();

  // Row should be gone.
  await expect(page.getByRole('cell', {name})).toHaveCount(0);
});
