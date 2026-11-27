// SP-16: the ways in to the split page: a hideable card on Home, a card in the Add sheet, and a sidebar item on a computer; all marked BETA.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { seedRows, signInAs } from './helpers';

const expense = { amount: '12.00', category: 'food', payment: 'card', merchant: 'Lunch', note: null, created_at: new Date().toISOString() };

async function openHome(page: Page) {
  const user = await signInAs(page);
  await seedRows(page, user.email, 'expenses', [expense]);
  await page.goto('/app');
  await expect(page.getByRole('heading', { level: 1, name: /^Hello,/ })).toBeVisible();
  return user;
}

test.describe('the way in to splitting a bill (SP-16)', () => {
  test('Home shows a Split a receipt card with a BETA pill, and it opens the split page with the beta note', async ({ page }) => {
    await openHome(page);
    const card = page.getByTestId('split-card');
    await expect(card).toBeVisible();
    await expect(card).toContainText('Split a receipt');
    await expect(card).toContainText('Beta');
    await expect(card).toContainText('Scan it, tick what you had, and get your share.');
    await page.getByTestId('split-card-link').click();
    await expect(page).toHaveURL(/\/app\/split$/);
    await expect(page.getByRole('heading', { level: 1, name: /Split a receipt/ })).toContainText('Beta');
    await expect(page.getByText('Beta: we read most receipts, but please check each row.')).toBeVisible();
  });

  test('the card can be hidden, stays hidden after a reload, and the feature is still in the Add sheet', async ({ page }) => {
    await openHome(page);
    await page.getByTestId('split-card-dismiss').click();
    await expect(page.getByTestId('split-card')).toHaveCount(0);
    await expect(page.getByText('Hidden. You can still find it in the + menu.')).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: /^Hello,/ })).toBeVisible();
    await expect(page.getByTestId('split-card')).toHaveCount(0);
    await page.getByRole('button', { name: 'Add a transaction' }).first().click();
    await expect(page.getByTestId('split-link')).toBeVisible();
  });

  test('the Add sheet has a Split a receipt card with a BETA pill that closes the sheet and opens the page', async ({ page }) => {
    await openHome(page);
    await page.getByRole('button', { name: 'Add a transaction' }).first().click();
    const link = page.getByTestId('split-link');
    await expect(link).toContainText('Split a receipt');
    await expect(link).toContainText('Beta');
    await expect(link).toContainText('Need to split the bill?');
    await link.click();
    await expect(page).toHaveURL(/\/app\/split$/);
    await expect(page.getByRole('dialog', { name: 'Add a transaction' })).toHaveCount(0);
  });

  test('on a computer the sidebar has a Split a bill item with a BETA pill, and it shows as the current page', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openHome(page);
    const item = page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /Split a bill/ });
    await expect(item).toBeVisible();
    await expect(item).toContainText('Beta');
    await item.click();
    await expect(page).toHaveURL(/\/app\/split$/);
    await expect(item).toHaveAttribute('aria-current', 'page');
    await expect(page).toHaveTitle(/Split a receipt/);
  });

  test('on a phone the tab bar is unchanged: four tabs and the add button, no split tab', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await openHome(page);
    await expect(page.getByRole('link', { name: /Split a bill/ })).toHaveCount(0);
  });

  test('the Home card passes the accessibility scan on a computer and a phone, light and dark, with no sideways scroll', async ({ browser }) => {
    test.setTimeout(120_000);
    for (const [scheme, width] of [['light', 1280], ['dark', 1280], ['light', 320], ['dark', 390]] as const) {
      const context = await browser.newContext({ colorScheme: scheme, viewport: { width, height: 900 } });
      const page = await context.newPage();
      await openHome(page);
      await expect(page.getByTestId('split-card')).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
      expect(results.violations.map((v) => `${v.impact}: ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`), `${scheme} ${width}`).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `no sideways scroll ${width}`).toBeLessThanOrEqual(0);
      await context.close();
    }
  });
});
