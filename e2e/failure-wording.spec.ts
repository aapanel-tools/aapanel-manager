import {test, expect, login, pressUntil} from './support/app';

/**
 * A poll that fails is told in the reader's language on both screens that show
 * it (Д-35, ADR-0012).
 *
 * Both used to show describeError()'s English sentence — "panel unreachable —
 * fetch failed (ECONNREFUSED)" — in the middle of a Russian interface: the refresh
 * message because the action handed that sentence back, the fleet summary because
 * it was what the poll stored. Unit tests pin down each half; only here do the
 * stored kind, the phrase built from it and the page drawing it meet.
 */
test('an unreachable panel is said in the reader’s language in the refresh message and on the fleet summary', async ({
  page,
  addServer,
}) => {
  // Adds a server, refreshes it, reads the summary and removes the server again.
  test.setTimeout(90_000);
  const name = `e2e-unreachable-${Date.now()}`;

  await login(page);
  // Loopback, on a port nothing listens on: refused, and never someone's machine.
  await addServer({name, baseUrl: 'http://127.0.0.1:1'});

  await page.goto(`/servers?q=${encodeURIComponent(name)}`);
  const row = page.getByRole('row').filter({hasText: name});
  // Pressed again if the first press landed before hydration; a refresh is
  // harmless to repeat.
  await pressUntil(
    row.getByRole('button', {name: 'Обновить', exact: true}),
    page.getByText(`${name}: панель недоступна`),
  );
  await expect(page.getByText('panel unreachable')).toHaveCount(0);

  await page.goto('/');
  // The attention row links to the server; the journal list on the same page
  // names it too (server.create, server.refresh), but as plain text.
  const item = page.getByRole('listitem').filter({has: page.getByRole('link', {name, exact: true})});
  await expect(item).toContainText('панель недоступна');
  await expect(item).not.toContainText('panel unreachable');
});
