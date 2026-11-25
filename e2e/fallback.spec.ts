// REL-01 / PF-04: what the app does when things around it fail.
import { expect, test } from '@playwright/test';
import { signInAs } from './helpers';

test('going offline shows a clear banner, and coming back removes it', async ({ page, context }) => {
  await signInAs(page);
  await page.goto('/app');
  await expect(page.locator('h1')).toBeVisible();
  await context.setOffline(true);
  await expect(page.getByText(/You are offline/)).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText(/You are offline/)).toBeHidden();
});

test('a corrupted session store does not trap the person on a spinner', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('sb-127-auth-token', '{not json'));
  await page.goto('/app');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
});

test('a signed-out visitor to an app screen is sent to sign-in, never shown app content', async ({ page }) => {
  await page.goto('/app/history');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0);
});

test('the language choice survives a reload and applies to the whole screen', async ({ page }) => {
  await signInAs(page);
  await page.goto('/app/account');
  await page.getByLabel('Language').selectOption('ms');
  await expect(page.getByRole('dialog', { name: 'Akaun', exact: true }).or(page.getByRole('region', { name: 'Akaun', exact: true }))).toBeVisible();
  await page.reload();
  await expect(page.getByRole('dialog', { name: 'Akaun', exact: true }).or(page.getByRole('region', { name: 'Akaun', exact: true }))).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('ms');
});

test('storage being unavailable for writes does not break the language switch for this visit', async ({ page }) => {
  await signInAs(page);
  await page.goto('/app/account');
  await page.evaluate(() => {
    Object.defineProperty(Storage.prototype, 'setItem', {
      value: () => {
        throw new DOMException('blocked', 'SecurityError');
      },
    });
  });
  await page.getByLabel('Language').selectOption('zh');
  await expect(page.getByRole('dialog', { name: '账户', exact: true }).or(page.getByRole('region', { name: '账户', exact: true }))).toBeVisible();
});

test('the manifest and service worker are served and valid', async ({ request }) => {
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest.name).toBe('VinExpenses');
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
  const sw = await request.get('/sw.js');
  expect(sw.status()).toBe(200);
  expect(sw.headers()['cache-control']).toBe('no-cache');
});
