// RP-01, HI-02: the in-app monthly report: right numbers, comparison with last month, Back and Esc, print view.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { isoDaysAgo, seedRows, signInAs } from './helpers';

const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const lastMonthDay = (day: number) => {
  const d = new Date();
  d.setMonth(d.getMonth() - 1, day);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
};
const exp = (amount: string, category: string, merchant: string | null, created_at: string) => ({ amount, category, payment: 'card', merchant, note: null, created_at });

async function withMonths(page: Page) {
  const user = await signInAs(page);
  await seedRows(page, user.email, 'expenses', [
    exp('100.00', 'food', 'Kopi Corner', isoDaysAgo(0)),
    exp('50.00', 'food', 'Kopi Corner KL 2', isoDaysAgo(0)),
    exp('250.00', 'car', 'Petronas', isoDaysAgo(0)),
    exp('80.00', 'food', 'Kopi Corner', lastMonthDay(10)),
    exp('40.00', 'shopping', 'Mydin', lastMonthDay(11)),
  ]);
  await seedRows(page, user.email, 'incomes', [
    { amount: '3000.00', source: 'Salary', created_at: isoDaysAgo(0) },
    { amount: '2500.00', source: 'Salary', created_at: lastMonthDay(25) },
  ]);
  return user;
}

test('the report adds up: income, expenses, net, a plain-English line, top merchants and categories', async ({ page }) => {
  await withMonths(page);
  await page.goto(`/app/report?month=${thisMonth()}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Monthly expense report' })).toBeVisible();
  await expect(page.getByTestId('report-income')).toHaveText('RM 3,000.00');
  await expect(page.getByTestId('report-expenses')).toHaveText('RM 400.00');
  await expect(page.getByTestId('report-net')).toHaveText('RM 2,600.00');
  await expect(page.getByTestId('report-line')).toContainText('you spent RM 400.00 and received RM 3,000.00. That leaves RM 2,600.00.');
  // two branches of the same place are counted as one merchant
  await expect(page.getByRole('region', { name: 'Top merchants' }).or(page.locator('section', { has: page.getByRole('heading', { name: 'Top merchants' }) }))).toContainText('150.00');
  await expect(page.locator('section', { has: page.getByRole('heading', { name: 'Where it went' }) })).toContainText('Car');
  await expect(page.getByTestId('report-rows').getByRole('row')).toHaveCount(1 + 4); // header + 3 expenses + 1 income
});

test('compared with last month: up or down with the percentage, and the biggest category changes', async ({ page }) => {
  await withMonths(page);
  await page.goto(`/app/report?month=${thisMonth()}`);
  const compare = page.locator('section', { has: page.getByRole('heading', { name: 'Compared with last month' }) });
  await expect(compare).toContainText('Up RM 280.00 (233%)'); // 400 against 120
  await expect(compare).toContainText('Up RM 500.00 (20%)'); // income 3,000 against 2,500
  await expect(compare).toContainText('Car: +RM 250.00');
  const table = page.locator('section', { has: page.getByRole('heading', { name: 'Category comparison' }) });
  await expect(table.getByRole('row', { name: /Shopping/ })).toContainText('Decreased RM 40.00 (100%)');
  await expect(table.getByRole('row', { name: /Car/ })).toContainText('Increased RM 250.00 (New)');
});

test('a month with nothing in it says so, and nothing to compare with says so', async ({ page }) => {
  const user = await signInAs(page);
  await seedRows(page, user.email, 'expenses', [exp('9.00', 'food', 'X', isoDaysAgo(0))]);
  await page.goto('/app/report?month=2020-01');
  await expect(page.getByTestId('report-line')).toContainText('There are no transactions in');
  await expect(page.getByText('No expenses were recorded in')).toBeVisible();
  await page.goto(`/app/report?month=${thisMonth()}`);
  await expect(page.getByText('No transactions last month to compare with.')).toBeVisible();
});

test('the month can be changed on the page, and a made-up month falls back to this one', async ({ page }) => {
  await withMonths(page);
  await page.goto('/app/report?month=banana');
  await expect(page.getByTestId('report-expenses')).toHaveText('RM 400.00');
  const last = new Date();
  last.setMonth(last.getMonth() - 1);
  await page.getByLabel('Month', { exact: true }).fill(`${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}`);
  await expect(page.getByTestId('report-expenses')).toHaveText('RM 120.00');
});

test('it opens from History with the month being looked at, and Back and Esc return to History', async ({ page }) => {
  await withMonths(page);
  await page.goto('/app/history');
  await page.getByLabel('Month').selectOption(thisMonth());
  await page.getByRole('button', { name: 'Monthly report' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Monthly expense report' })).toBeVisible();
  expect(page.url()).toContain(`month=${thisMonth()}`);
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'History' })).toBeVisible();
  await page.getByRole('button', { name: 'Monthly report' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Monthly expense report' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { level: 1, name: 'History' })).toBeVisible();
});

test('print: the menus disappear and the report stays; the print button opens the print dialog', async ({ page }) => {
  await withMonths(page);
  await page.goto(`/app/report?month=${thisMonth()}`);
  await page.addInitScript(() => undefined);
  await page.evaluate(() => {
    (window as unknown as { __printed: number }).__printed = 0;
    window.print = () => {
      (window as unknown as { __printed: number }).__printed += 1;
    };
  });
  await page.getByRole('button', { name: 'Print or save as PDF' }).click();
  expect(await page.evaluate(() => (window as unknown as { __printed: number }).__printed)).toBe(1);
  await page.emulateMedia({ media: 'print' });
  const menus = page.locator('nav[aria-label="Main navigation"]');
  await expect(menus).toHaveCount(2);
  for (const nav of await menus.all()) await expect(nav).toBeHidden();
  await expect(page.getByRole('button', { name: 'Print or save as PDF' })).toBeHidden();
  await expect(page.getByTestId('report-expenses')).toBeVisible();
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the report passes the accessibility scan (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await withMonths(page);
    await page.goto(`/app/report?month=${thisMonth()}`);
    await expect(page.getByTestId('report-expenses')).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
  });
}
