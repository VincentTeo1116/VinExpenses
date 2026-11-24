// PU-03: a real 404 status with the custom page, in each language, and a way back.
import { expect, test } from '@playwright/test';

test('an unknown address returns HTTP 404 with the custom page', async ({ page }) => {
  const response = await page.goto('/typo-address');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'We can’t find that page' })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
});

test('unknown addresses inside the app folders, and private files, are 404 too, not a soft "found" page', async ({ request }) => {
  for (const path of ['/app/nope', '/app/history/extra', '/auth/x', '/app/../secret', '/.env', '/legacy/app.js', '/src/main.tsx', '/package.json', '/_redirects.bak']) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(404);
    expect(await response.text(), path).toContain('404');
  }
});

test('the real app addresses answer 200', async ({ request }) => {
  for (const path of ['/app', '/app/history', '/app/plan', '/app/account', '/auth']) expect((await request.get(path)).status(), path).toBe(200);
});

test('with no previous page, the main button goes to the app', async ({ page }) => {
  await page.goto('/oops');
  await expect(page.getByRole('button', { name: 'Go to the app' })).toBeVisible();
  await expect(page.locator('#home')).toBeHidden();
  await page.getByRole('button', { name: 'Go to the app' }).click();
  await page.waitForURL(/\/app$/);
});

test('with a previous page on this site, Go back returns to it', async ({ page }) => {
  await page.goto('/auth');
  await page.evaluate(() => {
    window.location.href = '/oops';
  });
  await page.waitForURL(/\/oops$/);
  await expect(page.getByRole('button', { name: 'Go back' })).toBeVisible();
  await page.getByRole('button', { name: 'Go back' }).click();
  await page.waitForURL(/\/auth$/);
});

test('Stay here stops the automatic return', async ({ page }) => {
  await page.goto('/oops');
  await page.getByRole('button', { name: 'Stay here' }).click();
  await page.waitForTimeout(1500);
  await expect(page.locator('#count')).toHaveText('');
  expect(new URL(page.url()).pathname).toBe('/oops');
});

test('the page speaks the language chosen in the app', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ve_lang', 'ms'));
  await page.goto('/oops');
  await expect(page.getByRole('heading', { name: 'Kami tidak menemui halaman itu' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('ms');
});

test('a tampered language value is ignored (English is used)', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ve_lang', '<img src=x onerror=alert(1)>'));
  await page.goto('/oops');
  await expect(page.getByRole('heading', { name: 'We can’t find that page' })).toBeVisible();
});
