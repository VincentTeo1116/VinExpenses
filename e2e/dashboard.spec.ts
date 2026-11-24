// DB-01 … DB-10: the Home screen, checked against real records in the stand-in database.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { isoDaysAgo, seedRows, signInAs, ymdDaysFromNow } from './helpers';

const row = (amount: string, category: string, merchant: string | null, daysAgo = 0, extra: Record<string, unknown> = {}) => ({ amount, category, payment: 'card', merchant, note: null, created_at: isoDaysAgo(daysAgo), ...extra });

async function openHome(page: Page) {
  await page.goto('/app');
  await expect(page.getByRole('heading', { level: 1, name: /^Hello,/ })).toBeVisible();
}

test.describe('dashboard (DB-01 … DB-10)', () => {
  test('a new person sees a clear first step, and the + button opens the add sheet', async ({ page }) => {
    await signInAs(page);
    await openHome(page);
    await expect(page.getByText('Add your first expense')).toBeVisible();
    await page.getByRole('button', { name: 'Add a transaction' }).first().click();
    await expect(page.getByRole('dialog', { name: 'Add a transaction' })).toBeVisible();
  });

  test('the big card, the three tiles and the daily average add up from the records', async ({ page }) => {
    const user = await signInAs(page);
    await seedRows(page, user.email, 'expenses', [row('100.00', 'food', 'Lunch'), row('50.50', 'car', 'Petrol')]);
    await seedRows(page, user.email, 'incomes', [{ amount: '3000.00', source: 'Salary', created_at: isoDaysAgo(0) }]);
    await openHome(page);
    await expect(page.getByTestId('spent')).toHaveText('RM 150.50');
    await expect(page.getByTestId('tile-income')).toContainText('RM 3,000.00');
    await expect(page.getByTestId('tile-balance')).toContainText('RM 2,849.50');
    await expect(page.getByTestId('tile-budget')).toContainText('Not set');
    // the biggest card is really the biggest thing on the screen
    const hero = await page.getByTestId('hero').boundingBox();
    const tile = await page.getByTestId('tile-income').boundingBox();
    expect((hero?.width ?? 0) * (hero?.height ?? 0)).toBeGreaterThan((tile?.width ?? 1) * (tile?.height ?? 1) * 2);
  });

  test('spending more than income shows a negative balance in red', async ({ page }) => {
    const user = await signInAs(page);
    await seedRows(page, user.email, 'expenses', [row('500.00', 'food', 'Big')]);
    await seedRows(page, user.email, 'incomes', [{ amount: '100.00', source: 'Gift', created_at: isoDaysAgo(0) }]);
    await openHome(page);
    await expect(page.getByTestId('tile-balance')).toHaveAttribute('data-negative', 'true');
    await expect(page.getByTestId('tile-balance')).toContainText('−RM 400.00');
  });

  test('with a budget: what is left, safe to spend per day, and the tile opens Budgets', async ({ page }) => {
    const user = await signInAs(page);
    await seedRows(page, user.email, 'budgets', [{ category: 'all', amount: '1000.00' }]);
    await seedRows(page, user.email, 'expenses', [row('200.00', 'food', 'Shop')]);
    await openHome(page);
    await expect(page.getByTestId('tile-budget')).toContainText('RM 800.00');
    await expect(page.getByTestId('safe')).toContainText('Safe to spend today');
    await page.getByTestId('tile-budget').click();
    await expect(page.getByRole('tab', { name: 'Budgets' })).toHaveAttribute('aria-selected', 'true');
  });

  test('a budget that is used up says so, with no "safe to spend"', async ({ page }) => {
    const user = await signInAs(page);
    await seedRows(page, user.email, 'budgets', [{ category: 'all', amount: '100.00' }]);
    await seedRows(page, user.email, 'expenses', [row('150.00', 'food', 'Shop')]);
    await openHome(page);
    await expect(page.getByTestId('tile-budget')).toContainText('Over budget');
    await expect(page.getByTestId('safe')).toHaveCount(0);
    await expect(page.getByText('Budget used up')).toBeVisible();
  });

  test('categories: ranked with shares; tapping one opens History narrowed to it', async ({ page }) => {
    const user = await signInAs(page);
    await seedRows(page, user.email, 'expenses', [row('75.00', 'food', 'A'), row('25.00', 'car', 'B')]);
    await openHome(page);
    const list = page.getByRole('list').filter({ has: page.locator('[data-category]') });
    await expect(list.locator('[data-category]').first()).toContainText('75%');
    await list.locator('[data-category="car"]').click();
    await expect(page.getByRole('heading', { level: 1, name: 'History' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^B/ }).first()).toBeVisible();
    await expect(page.getByText('A', { exact: true })).toHaveCount(0);
  });

  test('the month switcher moves back and forward, and the six-month bars jump to a month', async ({ page }) => {
    const user = await signInAs(page);
    await seedRows(page, user.email, 'expenses', [row('40.00', 'food', 'Now'), row('90.00', 'food', 'Earlier', 35)]);
    await openHome(page);
    await expect(page.getByTestId('spent')).toHaveText('RM 40.00');
    await page.getByRole('button', { name: 'Previous month' }).click();
    await expect(page.getByTestId('spent')).toHaveText('RM 90.00');
    await page.getByRole('button', { name: 'This month', exact: true }).click();
    await expect(page.getByTestId('spent')).toHaveText('RM 40.00');
    await page.getByRole('button', { name: /spent RM 90\.00/ }).click();
    await expect(page.getByTestId('spent')).toHaveText('RM 90.00');
    // the chart card has its own way back, and it goes away once you are back
    await page.getByTestId('back-to-now').click();
    await expect(page.getByTestId('spent')).toHaveText('RM 40.00');
    await expect(page.getByTestId('back-to-now')).toHaveCount(0);
  });

  test('a fixed bill from a schedule is left out of the daily average, and says so', async ({ page }) => {
    const user = await signInAs(page);
    await seedRows(page, user.email, 'recurring_expenses', [{ name: 'Rent', amount: '1200.00', category: 'utilities', payment: 'bank', frequency: 'monthly', start_date: ymdDaysFromNow(20), next_due: ymdDaysFromNow(20) }]);
    await seedRows(page, user.email, 'expenses', [row('1200.00', 'utilities', 'Rent', 0, { note: 'Rent' }), row('30.00', 'food', 'Lunch')]);
    await openHome(page);
    await expect(page.getByText(/leaves out RM 1,200\.00 of fixed bills/)).toBeVisible();
    await expect(page.getByTestId('daily')).not.toHaveText('RM 0.00');
  });

  test('coming up lists bills and income by date; recent activity opens the record to edit', async ({ page }) => {
    const user = await signInAs(page);
    await seedRows(page, user.email, 'recurring_expenses', [{ name: 'Internet', amount: '129.00', category: 'utilities', payment: 'card', frequency: 'monthly', start_date: ymdDaysFromNow(2), next_due: ymdDaysFromNow(2) }]);
    await seedRows(page, user.email, 'expenses', [row('12.00', 'food', 'Nasi lemak')]);
    await openHome(page);
    await expect(page.getByRole('region', { name: 'Coming up' })).toContainText('Internet');
    await expect(page.getByRole('region', { name: 'Coming up' })).toContainText(/in 2 days/i);
    await page.getByRole('region', { name: 'Recent activity' }).getByRole('button', { name: /Nasi lemak/ }).click();
    await expect(page.getByRole('dialog', { name: 'Edit' })).toBeVisible();
  });

  test('quick add: a place visited twice becomes a one-tap chip that opens a copy dated today', async ({ page }) => {
    const user = await signInAs(page);
    await seedRows(page, user.email, 'expenses', [row('4.00', 'food', 'Kopi corner', 3), row('4.50', 'food', 'Kopi corner', 1)]);
    await openHome(page);
    await page.getByRole('button', { name: /Kopi corner/ }).first().click();
    await expect(page.getByRole('dialog', { name: 'Add a transaction' })).toBeVisible();
    await expect(page.getByLabel('Amount (RM)')).toHaveValue('4.5');
  });

  test('the whole page works in Malay and Chinese', async ({ page }) => {
    const user = await signInAs(page);
    await seedRows(page, user.email, 'expenses', [row('10.00', 'food', 'X')]);
    await page.addInitScript(() => localStorage.setItem('ve_lang', 'ms'));
    await page.goto('/app');
    await expect(page.getByText('Pendapatan').first()).toBeVisible();
    await page.addInitScript(() => localStorage.setItem('ve_lang', 'zh'));
    await page.reload();
    await expect(page.getByText('收入').first()).toBeVisible();
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`no accessibility violations (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      const user = await signInAs(page);
      await seedRows(page, user.email, 'budgets', [{ category: 'all', amount: '300.00' }]);
      await seedRows(page, user.email, 'expenses', [row('120.00', 'food', 'Lunch'), row('60.00', 'car', 'Petrol', 2), row('45.00', 'food', 'Lunch', 5), row('30.00', 'food', 'Lunch', 9)]);
      await seedRows(page, user.email, 'incomes', [{ amount: '2000.00', source: 'Salary', created_at: isoDaysAgo(0) }]);
      await openHome(page);
      await expect(page.getByTestId('spent')).toBeVisible();
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      expect(result.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
    });
  }
});
