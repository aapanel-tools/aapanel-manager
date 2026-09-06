import {test, expect} from '@playwright/test';

test('unauthenticated user is redirected to login', async ({page}) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole('button', {name: /sign in|войти/i})).toBeVisible();
});

test('admin can sign in and reach the dashboard', async ({page}) => {
  await page.goto('/login');
  // The form uses htmlFor/id association; getByLabel resolves via label text.
  // Russian labels: "Эл. почта" (email), "Пароль" (password).
  // Fallback to input[name=...] selectors if label association fails.
  const emailInput = page.locator('input[name="email"]');
  const passwordInput = page.locator('input[name="password"]');
  await emailInput.fill('admin@example.com');
  await passwordInput.fill('changeme123');
  await page.getByRole('button', {name: /sign in|войти/i}).click();
  await expect(page).toHaveURL(/\/$/); // back at root dashboard
  await expect(page.getByRole('button', {name: /sign out|выйти/i})).toBeVisible();
});
