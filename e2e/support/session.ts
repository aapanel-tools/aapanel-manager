import {expect, type Locator, type Page} from '@playwright/test';

/** The administrator prisma/seed.ts creates, read with the same overrides. */
export const ADMIN = {
  email: process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com',
  password: process.env.SEED_ADMIN_PASSWORD ?? 'changeme123',
};

/**
 * Presses a control until what it brings up is on screen.
 *
 * A page drawn on the server shows its buttons before React has attached their
 * handlers, and a press in that window does nothing at all. On a loaded machine
 * the window lasts seconds — measured on 2026-09-14: four tests pressed "add
 * server" into it and waited for a dialog that never came. Only for controls
 * that are harmless to press twice: opening a dialog, refreshing a list.
 */
export async function pressUntil(control: Locator, appears: Locator): Promise<void> {
  await expect(async () => {
    await control.click();
    await expect(appears.first()).toBeVisible({timeout: 2_000});
  }).toPass({timeout: 20_000});
}

/** Signs the seeded administrator in and waits for the fleet summary. */
export async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.locator('input[name="email"]').fill(ADMIN.email);
  await page.locator('input[name="password"]').fill(ADMIN.password);
  await page.getByRole('button', {name: /войти|sign in/i}).click();
  // Signing in lands on the fleet summary (Ф-7), not on the servers table. The
  // password check is argon2id, slow by design, and with several workers
  // signing in at once it outlasted the default five seconds.
  await expect(page).toHaveURL(/\/$/, {timeout: 15_000});
}
