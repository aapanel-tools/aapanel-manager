import {test, expect, login, removeServer} from './support/app';

test('admin can add a server, see it in the table, and delete it', async ({page, addServer}) => {
  const name = `e2e-${Date.now()}`;

  await login(page);
  // Unroutable on purpose: saving a registration must not depend on the panel answering.
  await addServer({name, baseUrl: 'https://10.255.255.1:8888'});

  await page.goto('/servers');
  await expect(page.getByRole('cell', {name})).toBeVisible();

  await removeServer(page, name);
});
