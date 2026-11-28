// IN-01: the Install page explains how to add the app to a home screen on each device, offers one-tap install only when the browser does,
// recognises an already-installed app, and passes the accessibility check in both themes.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { watchProblems } from './helpers';

const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

test('the page answers 200, shows the steps for the detected device, and lets the person switch', async ({ browser }) => {
  const context = await browser.newContext({ userAgent: ANDROID, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const problems = watchProblems(page);
  const response = await page.goto('/install');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Install ManaDuit on your phone');
  await expect(page.getByRole('button', { name: 'Android' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('install-steps')).toContainText('Install app');
  await page.getByRole('button', { name: 'iPhone and iPad' }).click();
  await expect(page.getByTestId('install-steps')).toContainText('Add to Home Screen');
  await expect(page.getByTestId('install-browser')).toContainText('Safari');
  await page.getByRole('button', { name: 'Computer' }).click();
  await expect(page.getByTestId('install-steps')).toContainText('address bar');
  expect(problems).toEqual([]);
  await context.close();
});

test('an iPhone opens on the iPhone steps and has no one-tap button', async ({ browser }) => {
  const context = await browser.newContext({ userAgent: IPHONE, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto('/install');
  await expect(page.getByRole('button', { name: 'iPhone and iPad' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('install-button')).toHaveCount(0);
  await context.close();
});

test('the one-tap button appears only when the browser offers installing, and uses the browser dialog', async ({ page }) => {
  await page.goto('/install');
  await expect(page.getByTestId('install-button')).toHaveCount(0);
  await page.evaluate(() => {
    const offer = new Event('beforeinstallprompt', { cancelable: true }) as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
    offer.prompt = () => {
      (window as unknown as { __asked: boolean }).__asked = true;
      return Promise.resolve();
    };
    offer.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(offer);
  });
  await expect(page.getByTestId('install-button')).toBeVisible();
  await page.getByTestId('install-button').click();
  await expect(page.getByTestId('install-done')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __asked?: boolean }).__asked)).toBe(true);
});

test('inside an installed app the page says so instead of showing install steps to follow', async ({ browser }) => {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    const real = window.matchMedia.bind(window);
    window.matchMedia = (query: string) => (query.includes('display-mode: standalone') ? ({ ...real(query), matches: true } as MediaQueryList) : real(query));
  });
  const page = await context.newPage();
  await page.goto('/install');
  await expect(page.getByTestId('install-done')).toBeVisible();
  await context.close();
});

test('it is reachable from the home page and the footer, and is listed for search engines', async ({ page, request }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Add it to your home screen' }).click();
  await expect(page).toHaveURL(/\/install$/);
  await expect(page.getByRole('contentinfo').getByRole('link', { name: 'Install the app' })).toBeVisible();
  expect((await request.get('/install.html')).status()).toBe(200);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/install$/);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the page passes axe in ${scheme} mode on a phone`, async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: scheme, viewport: { width: 360, height: 740 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto('/install');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    for (const name of ['Android', 'iPhone and iPad', 'Computer']) {
      await page.getByRole('button', { name }).click();
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`), name).toEqual([]);
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await context.close();
  });
}
