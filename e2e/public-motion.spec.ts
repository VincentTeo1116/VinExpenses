// The public pages' motion: it runs for people who allow it (and never hides content for good), and stops for people who ask for less.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { watchProblems } from './helpers';

const open = async (browser: Browser, reducedMotion: 'reduce' | 'no-preference', width = 1280) => {
  const context = await browser.newContext({ viewport: { width, height: 800 }, reducedMotion });
  return context.newPage();
};
const scrollThrough = async (page: Page) => {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y <= height; y += 500) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(90);
  }
};

test('with motion allowed: sections fade in as they are reached, numbers count up, nothing is hidden for good, no policy violations', async ({ browser }) => {
  const page = await open(browser, 'no-preference');
  const problems = watchProblems(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Know where your money goes');
  // below the fold, not yet reached: dimmed
  const heading = page.getByRole('heading', { name: 'Start with this month' });
  expect(await heading.evaluate((el) => Number(getComputedStyle(el.closest('div') as Element).opacity))).toBeLessThan(1);
  await scrollThrough(page);
  await expect(heading).toBeVisible();
  await expect.poll(() => heading.evaluate((el) => Number(getComputedStyle(el.closest('div') as Element).opacity))).toBe(1);
  // the numbers reached their final values
  const stats = page.locator('section[aria-label="At a glance"]');
  await expect(stats).toContainText('3');
  await expect(stats).toContainText('<200');
  await expect(stats).toContainText('100%');
  expect(problems).toEqual([]);
});

test('with less motion: everything is visible at once and nothing animates', async ({ browser }) => {
  const page = await open(browser, 'reduce');
  await page.goto('/');
  const heading = page.getByRole('heading', { name: 'Start with this month' });
  expect(await heading.evaluate((el) => Number(getComputedStyle(el.closest('div') as Element).opacity))).toBe(1);
  expect(await page.locator('section[aria-label="At a glance"]').textContent()).toContain('100%');
  const animating = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length);
  expect(animating).toBe(0);
});

test('the legal pages: the contents list follows the reading, the top button appears, and a section can be jumped to', async ({ browser }) => {
  const page = await open(browser, 'no-preference');
  await page.goto('/privacy');
  await expect(page.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeVisible();
  const toc = page.getByRole('navigation', { name: 'Sections' });
  await toc.getByRole('link', { name: /Security|How it is protected/ }).first().click();
  await expect(page.getByRole('heading', { name: /How it is protected/ })).toBeInViewport();
  await expect(toc.locator('[aria-current="true"]')).toContainText(/protected|Security/i);
  await expect(page.getByRole('button', { name: 'Back to the top' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to the top' }).click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(50);
});

test('the old .html addresses still open the new pages', async ({ page }) => {
  for (const [from, to, heading] of [['/privacy.html', '/privacy', 'Privacy Policy'], ['/terms.html', '/terms', 'Terms of Use'], ['/welcome.html', '/', 'Know where your money goes']] as const) {
    await page.goto(from);
    await expect(page).toHaveURL(new RegExp(`${to === '/' ? '/$' : `${to}$`}`));
    await expect(page.getByRole('heading', { level: 1 })).toContainText(heading);
  }
});

test('the try-it calculator gives the same answer as the app\'s loan maths', async ({ page }) => {
  await page.goto('/');
  const amount = page.getByLabel('Loan amount');
  await amount.focus();
  // defaults are RM 300,000 at 4.2% for 25 years: RM 1,616.83 a month
  await expect(page.getByTestId('quick-payment')).toHaveText('RM 1,616.83');
  await amount.press('ArrowRight');
  await expect(page.getByTestId('quick-payment')).not.toHaveText('RM 1,616.83');
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the public pages still pass the accessibility scan after every animation has run (${scheme})`, async ({ browser }) => {
    test.setTimeout(90_000);
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'no-preference', colorScheme: scheme });
    const page = await context.newPage();
    for (const path of ['/', '/privacy', '/terms']) {
      await page.goto(path);
      await scrollThrough(page);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(1500);
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      expect(results.violations.map((v) => `${v.impact}: ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`), `${path} ${scheme}`).toEqual([]);
    }
  });
}
