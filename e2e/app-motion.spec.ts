// The app's motion (as the previous version had it): amounts count up, the budget and category bars fill, the ring sweeps round,
// the six-month bars rise, screens and rows fade up, a row just saved flashes. And all of it stands still for "reduce motion".
import { expect, test, type Browser } from '@playwright/test';
import { isoDaysAgo, seedRows, signInAs, watchProblems } from './helpers';

async function open(browser: Browser, reducedMotion: 'reduce' | 'no-preference') {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion });
  const page = await context.newPage();
  const user = await signInAs(page);
  await seedRows(page, user.email, 'expenses', [
    { amount: '600.00', category: 'food', payment: 'card', merchant: 'Dinner', note: null, created_at: isoDaysAgo(0) },
    { amount: '200.00', category: 'car', payment: 'card', merchant: 'Petrol', note: null, created_at: isoDaysAgo(0) },
    { amount: '90.00', category: 'food', payment: 'card', merchant: 'Earlier', note: null, created_at: isoDaysAgo(35) },
  ]);
  await seedRows(page, user.email, 'incomes', [{ amount: '3000.00', source: 'Salary', created_at: isoDaysAgo(1) }]);
  await seedRows(page, user.email, 'budgets', [{ category: 'all', amount: '1000.00' }]);
  return { page, user };
}

test('with motion allowed: the amounts count up, the bars fill, the ring sweeps and the month bars rise, with no errors', async ({ browser }) => {
  const { page } = await open(browser, 'no-preference');
  const problems = watchProblems(page);
  // record every value the big amount shows from the moment it exists
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __spent: string[] }).__spent = seen;
    new MutationObserver(() => {
      const text = document.querySelector('[data-testid="spent"]')?.textContent;
      if (text && seen[seen.length - 1] !== text) seen.push(text);
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  await page.goto('/app');
  await expect(page.getByTestId('spent')).toHaveText('RM 800.00');
  await expect(page.getByTestId('tile-income')).toContainText('RM 4,000.00'.replace('4,000', '3,000'));
  const seen = await page.evaluate(() => (window as unknown as { __spent: string[] }).__spent);
  expect(seen.length, `the amount should pass through in-between values, saw ${seen.join(', ')}`).toBeGreaterThan(3);
  expect(seen[seen.length - 1]).toBe('RM 800.00');

  // the budget bar ends at 80%, the category bars at their shares, the ring's slices are drawn, the month bars are up
  await expect(page.getByTestId('hero').locator('progress')).toHaveJSProperty('value', 80);
  await expect.poll(() => page.locator('[data-category="food"] rect').last().getAttribute('width')).toBe('75');
  await expect.poll(async () => Number((await page.locator('svg[role="img"] circle').nth(1).getAttribute('stroke-dasharray'))?.split(' ')[0])).toBeGreaterThan(100);
  await expect.poll(() => page.locator('button[aria-pressed] svg').first().evaluate((el) => getComputedStyle(el.querySelector('rect') as Element).transform)).toMatch(/none|matrix\(1, 0, 0, 1, 0, 0\)/);

  // moving to another month glides the amount to the new value, and back
  await page.getByRole('button', { name: 'Previous month' }).click();
  await expect(page.getByTestId('spent')).toHaveText('RM 90.00');
  await page.getByTestId('back-to-now').click();
  await expect(page.getByTestId('spent')).toHaveText('RM 800.00');

  // screens fade up
  await page.getByRole('link', { name: 'History' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'History' })).toBeVisible();
  expect(await page.locator('main > div > div').first().evaluate((el) => getComputedStyle(el.parentElement as Element).animationName)).not.toBe('none');
  expect(problems).toEqual([]);
});

test('with motion allowed: a transaction that was just saved flashes once in History, then settles', async ({ browser }) => {
  const { page } = await open(browser, 'no-preference');
  await page.goto('/app/history');
  await expect(page.getByRole('button', { name: /^Dinner/ })).toBeVisible();
  await page.getByRole('main').getByRole('button', { name: 'Add a transaction' }).first().click();
  const sheet = page.getByRole('dialog', { name: 'Add a transaction' });
  await sheet.getByLabel('Amount (RM)').fill('12.34');
  await sheet.getByLabel('Where (optional)').fill('Fresh one');
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  const row = page.locator('li', { has: page.getByRole('button', { name: /^Fresh one/ }) });
  await expect(row).toBeVisible();
  await expect(row).toHaveClass(/fresh/);
  await expect(row).not.toHaveClass(/fresh/, { timeout: 5000 });
  // clicking a slice of the ring on Home opens History on that category
  await page.goto('/app');
  await expect(page.getByTestId('spent')).toHaveText('RM 812.34');
  // (a point on the ring itself, a little clockwise from the top: the middle of the ring is a hole)
  const ring = (await page.locator('svg[role="img"]').first().boundingBox()) as { x: number; y: number; width: number; height: number };
  const radius = ring.width * 0.35;
  await page.waitForTimeout(1200); // let the ring finish sweeping round
  await page.mouse.click(ring.x + ring.width / 2 + radius * Math.sin(0.35), ring.y + ring.height / 2 - radius * Math.cos(0.35));
  await expect(page.getByRole('heading', { level: 1, name: 'History' })).toBeVisible();
});

test('with less motion: the amounts are simply there, the bars are already full and nothing is animating', async ({ browser }) => {
  const { page } = await open(browser, 'reduce');
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __spent: string[] }).__spent = seen;
    new MutationObserver(() => {
      const text = document.querySelector('[data-testid="spent"]')?.textContent;
      if (text && seen[seen.length - 1] !== text) seen.push(text);
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  await page.goto('/app');
  await expect(page.getByTestId('spent')).toHaveText('RM 800.00');
  expect(await page.evaluate(() => (window as unknown as { __spent: string[] }).__spent)).toEqual(['RM 800.00']);
  await expect(page.getByTestId('hero').locator('progress')).toHaveJSProperty('value', 80);
  // (each one is cut to a single instant; give that instant a frame to pass. Anything still moving after that is a real animation.)
  await expect.poll(() => page.evaluate(() => document.getAnimations().filter((animation) => animation.playState === 'running').length)).toBe(0);
});
