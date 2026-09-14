import {test, expect} from '@playwright/test';
import {login} from './support/app';

test('unauthenticated user is redirected to login', async ({page}) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole('button', {name: /sign in|войти/i})).toBeVisible();
});

test('admin can sign in and reach the fleet summary', async ({page}) => {
  await login(page);
  await expect(page.getByRole('button', {name: /sign out|выйти/i})).toBeVisible();
});
