import {test, expect, login} from './support/app';

// Connection refused at once: a panel that is not there, without waiting out a timeout.
const ABSENT_PANEL = 'http://127.0.0.1:1';

test('server detail: an absent panel is said on the summary and on the projects list', async ({page, addServer}) => {
  const name = `e2e-detail-${Date.now()}`;

  await login(page);
  const serverPath = await addServer({name, baseUrl: ABSENT_PANEL});

  await page.goto(serverPath);
  await expect(page.getByRole('heading', {level: 1, name})).toBeVisible();
  // The panel's own refusal, so the summary may blame the server (server-overview.tsx).
  await expect(page.getByText(/^Сервер недоступен — /)).toBeVisible({timeout: 15_000});

  await page.getByRole('link', {name: 'Проекты', exact: true}).click();
  await expect(page).toHaveURL(/\/servers\/[^/]+\/projects$/);
  // No rows were ever read, so this is the failure block rather than the stale notice.
  await expect(page.getByRole('alert').filter({hasText: 'Не удалось загрузить проекты'})).toBeVisible({
    timeout: 15_000,
  });
});
