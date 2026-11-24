// RC-01 … RC-04, BU-01, AC-06: recurring bills and income, budgets, and the person's own categories and date format.
import { expect, test, type Page } from '@playwright/test';
import { dbRows, seedRows, signInAs, ymdDaysFromNow } from './helpers';

const sheet = (page: Page, name: string) => page.getByRole('dialog', { name });

async function openPlan(page: Page, tab?: 'Budgets') {
  await page.goto('/app/plan');
  await expect(page.getByRole('heading', { level: 1, name: 'Plan' })).toBeVisible();
  if (tab) await page.getByRole('tab', { name: tab }).click();
}

const form = (page: Page) => page.getByRole('region', { name: /Add a regular item|^Edit$/ });

test.describe('recurring (RC-01 … RC-04)', () => {
  test('a monthly bill that was due in the past posts every missed month at once, and keeps its day', async ({ page }) => {
    const user = await signInAs(page);
    await openPlan(page);
    await page.getByRole('button', { name: 'Add a regular item' }).click(); // the form is a pop-up
    const start = ymdDaysFromNow(-70);
    await page.getByLabel('Name').fill('Rent');
    await page.getByLabel('Amount (RM)').fill('1200');
    await page.getByRole('radio', { name: 'Utilities' }).check();
    await page.getByLabel('First or next date').fill(start);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('recurring entries were added').or(page.getByText(/\d+ recurring entries were added/))).toBeVisible();

    const posted = await dbRows(page, user.email, 'expenses');
    expect(posted.length).toBeGreaterThanOrEqual(2);
    expect(posted.every((row) => row.merchant === 'Rent' && row.amount === '1200.00' && row.category === 'utilities')).toBe(true);
    const schedule = (await dbRows(page, user.email, 'recurring_expenses'))[0] as { next_due: string; start_date: string; active: boolean };
    expect(schedule.start_date).toBe(start);
    expect(schedule.next_due > ymdDaysFromNow(-1)).toBe(true); // the next one is in the future
    expect(schedule.active).toBe(true);
    // posting again changes nothing
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Plan' })).toBeVisible();
    await page.waitForTimeout(600);
    expect(await dbRows(page, user.email, 'expenses')).toHaveLength(posted.length);
  });

  test('the summary counts income as plus and bills as minus, never as one sum', async ({ page }) => {
    const user = await signInAs(page);
    await seedRows(page, user.email, 'recurring_expenses', [
      { name: 'Rent', amount: '1200.00', category: 'utilities', payment: 'bank', frequency: 'monthly', start_date: ymdDaysFromNow(10), next_due: ymdDaysFromNow(10) },
      { name: 'Netflix', amount: '120.00', category: 'entertain', payment: 'card', frequency: 'yearly', start_date: ymdDaysFromNow(100), next_due: ymdDaysFromNow(100) },
      { name: 'Paused one', amount: '999.00', category: 'other', payment: 'card', frequency: 'monthly', start_date: ymdDaysFromNow(5), next_due: ymdDaysFromNow(5), active: false },
    ]);
    await seedRows(page, user.email, 'recurring_incomes', [{ source: 'Salary', amount: '3000.00', frequency: 'monthly', start_date: ymdDaysFromNow(20), next_due: ymdDaysFromNow(20) }]);
    await openPlan(page);
    // only two totals are shown: each month and each year (3,000 in, 1,200 + 120/12 out; the paused one is left out)
    await expect(page.getByRole('list', { name: '3 active' })).toBeVisible();
    await expect(page.getByTestId('rec-totals')).toContainText('Total each month');
    await expect(page.getByTestId('rec-net')).toHaveText('+ RM 1,790.00');
    await expect(page.getByTestId('rec-totals')).toContainText('Total each year');
    await expect(page.getByTestId('rec-net-year')).toHaveText('+ RM 21,480.00');

    // each row carries its own sign
    await expect(page.getByRole('listitem').filter({ hasText: 'Rent' }).first()).toContainText('− RM 1,200.00');
    await expect(page.getByRole('listitem').filter({ hasText: 'Salary' }).first()).toContainText('+ RM 3,000.00');
  });

  test('when the bills cost more than the income, both totals are minus', async ({ page }) => {
    const user = await signInAs(page);
    await seedRows(page, user.email, 'recurring_expenses', [{ name: 'Car loan', amount: '900.00', category: 'car', payment: 'bank', frequency: 'monthly', start_date: ymdDaysFromNow(3), next_due: ymdDaysFromNow(3) }]);
    await seedRows(page, user.email, 'recurring_incomes', [{ source: 'Side job', amount: '300.00', frequency: 'monthly', start_date: ymdDaysFromNow(3), next_due: ymdDaysFromNow(3) }]);
    await openPlan(page);
    await expect(page.getByTestId('rec-net')).toHaveText('− RM 600.00');
    await expect(page.getByTestId('rec-net-year')).toHaveText('− RM 7,200.00');
  });

  test('pause and resume; resuming skips the dates missed while paused instead of posting them', async ({ page }) => {
    const user = await signInAs(page);
    const old = ymdDaysFromNow(-95);
    await seedRows(page, user.email, 'recurring_expenses', [{ name: 'Gym', amount: '80.00', category: 'health', payment: 'card', frequency: 'monthly', start_date: old, next_due: old, active: false }]);
    await openPlan(page);
    const row = page.getByRole('listitem').filter({ hasText: 'Gym' }).first();
    await expect(row).toContainText('Paused');
    await row.getByRole('button', { name: /^Resume/ }).click();
    await expect(page.getByText('Resumed', { exact: true })).toBeVisible();
    await page.waitForTimeout(600);
    expect(await dbRows(page, user.email, 'expenses')).toHaveLength(0); // nothing back-filled
    const schedule = (await dbRows(page, user.email, 'recurring_expenses'))[0] as { next_due: string; active: boolean };
    expect(schedule.active).toBe(true);
    expect(schedule.next_due >= ymdDaysFromNow(0)).toBe(true);
    await page.getByRole('listitem').filter({ hasText: 'Gym' }).first().getByRole('button', { name: /^Pause/ }).click();
    await expect(page.getByText('Paused', { exact: true }).first()).toBeVisible();
  });

  test('edit changes a schedule; delete asks first and keeps what was already posted', async ({ page }) => {
    const user = await signInAs(page);
    await seedRows(page, user.email, 'recurring_expenses', [{ name: 'Phone', amount: '60.00', category: 'utilities', payment: 'card', frequency: 'monthly', start_date: ymdDaysFromNow(8), next_due: ymdDaysFromNow(8) }]);
    await seedRows(page, user.email, 'expenses', [{ amount: '60.00', category: 'utilities', payment: 'card', merchant: 'Phone', note: 'Phone', created_at: new Date().toISOString() }]);
    await openPlan(page);
    await page.getByRole('listitem').filter({ hasText: 'Phone' }).first().getByRole('button', { name: /^Edit/ }).click();
    await expect(form(page).getByLabel('Name')).toHaveValue('Phone');
    await form(page).getByLabel('Amount (RM)').fill('65');
    await form(page).getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();
    expect((await dbRows(page, user.email, 'recurring_expenses'))[0]).toMatchObject({ amount: '65.00' });

    await page.getByRole('listitem').filter({ hasText: 'Phone' }).first().getByRole('button', { name: /^Delete/ }).click();
    const dialog = sheet(page, 'Delete this regular item?');
    await expect(dialog.getByText('“Phone” will stop posting. Entries it already added are kept.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('Deleted', { exact: true })).toBeVisible();
    expect(await dbRows(page, user.email, 'recurring_expenses')).toHaveLength(0);
    expect(await dbRows(page, user.email, 'expenses')).toHaveLength(1);
  });

  test('a schedule with an end date stops itself after the last one (a loan instalment)', async ({ page }) => {
    const user = await signInAs(page);
    await seedRows(page, user.email, 'recurring_expenses', [{ name: 'Loan', amount: '500.00', category: 'other', payment: 'bank', frequency: 'monthly', start_date: ymdDaysFromNow(-65), next_due: ymdDaysFromNow(-65), end_date: ymdDaysFromNow(-30) }]);
    await openPlan(page);
    await expect(page.getByText(/recurring entries were added/)).toBeVisible();
    const posted = await dbRows(page, user.email, 'expenses');
    expect(posted.length).toBeGreaterThanOrEqual(1);
    expect(posted.length).toBeLessThanOrEqual(2);
    const schedule = (await dbRows(page, user.email, 'recurring_expenses'))[0] as { active: boolean };
    expect(schedule.active).toBe(false);
    await expect(page.getByRole('listitem').filter({ hasText: 'Loan' }).first()).toContainText('Finished');
  });

  test('two devices open at the same time never post the same bill twice', async ({ page, browser }) => {
    const user = await signInAs(page);
    await seedRows(page, user.email, 'recurring_expenses', [{ name: 'Insurance', amount: '100.00', category: 'health', payment: 'bank', frequency: 'monthly', start_date: ymdDaysFromNow(-40), next_due: ymdDaysFromNow(-40) }]);
    // the first page has not loaded the app yet; open the same person on a second device
    const second = await (await browser.newContext()).newPage();
    await second.addInitScript((value) => localStorage.setItem('sb-127-auth-token', value), user.session);
    await Promise.all([page.goto('/app/plan'), second.goto('/app/plan')]);
    await expect(page.getByRole('heading', { level: 1, name: 'Plan' })).toBeVisible();
    await expect(second.getByRole('heading', { level: 1, name: 'Plan' })).toBeVisible();
    await page.waitForTimeout(1500);
    const posted = await dbRows(page, user.email, 'expenses');
    const dates = posted.map((row) => String(row.created_at).slice(0, 10));
    expect(new Set(dates).size).toBe(dates.length); // no date twice
    expect(posted.length).toBeGreaterThanOrEqual(1);
    expect(posted.length).toBeLessThanOrEqual(2);
  });

  test('the form checks each field', async ({ page }) => {
    await signInAs(page);
    await openPlan(page);
    await page.getByRole('button', { name: 'Add a regular item' }).click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Enter a name.')).toBeVisible();
    await expect(page.getByText('Enter an amount above 0, with up to 2 decimals.')).toBeVisible();
  });
});

test.describe('budgets (BU-01)', () => {
  test('set an overall limit and a category limit; progress turns amber, then red', async ({ page }) => {
    const user = await signInAs(page);
    await seedRows(page, user.email, 'expenses', [
      { amount: '85.00', category: 'food', payment: 'card', merchant: 'A', created_at: new Date().toISOString() },
      { amount: '130.00', category: 'car', payment: 'card', merchant: 'B', created_at: new Date().toISOString() },
    ]);
    await openPlan(page, 'Budgets');
    await page.getByLabel('Overall', { exact: true }).fill('1000');
    await page.getByLabel('Food', { exact: true }).fill('100');
    await page.getByLabel('Car', { exact: true }).fill('100');
    await page.getByRole('button', { name: 'Save budgets' }).click();
    await expect(page.getByText('Budgets saved')).toBeVisible();

    const rows = await dbRows(page, user.email, 'budgets');
    expect(rows.map((r) => `${r.category}:${r.amount}`).sort()).toEqual(['all:1000.00', 'car:100.00', 'food:100.00']);

    const food = page.locator('[data-budget="food"]');
    await expect(food.locator('progress')).toHaveAttribute('value', '85');
    await expect(food).toContainText('RM 85.00 spent');
    await expect(food).toContainText('RM 15.00 left');
    const car = page.locator('[data-budget="car"]');
    await expect(car.locator('progress')).toHaveAttribute('value', '100');
    await expect(car).toContainText('Over by RM 30.00');
    const overall = page.locator('[data-budget="all"]');
    await expect(overall).toContainText('RM 215.00 spent');
  });

  test('emptying a field removes that limit; a bad value is explained and nothing is saved', async ({ page }) => {
    const user = await signInAs(page);
    await seedRows(page, user.email, 'budgets', [{ category: 'food', amount: '50.00' }, { category: 'all', amount: '500.00' }]);
    await openPlan(page, 'Budgets');
    await page.getByLabel('Food', { exact: true }).fill('abc');
    await page.getByRole('button', { name: 'Save budgets' }).click();
    await expect(page.getByText('Enter an amount above 0, with up to 2 decimals.')).toBeVisible();
    expect(await dbRows(page, user.email, 'budgets')).toHaveLength(2);

    await page.getByLabel('Food', { exact: true }).fill('');
    await page.getByRole('button', { name: 'Save budgets' }).click();
    await expect(page.getByText('Budgets saved')).toBeVisible();
    expect((await dbRows(page, user.email, 'budgets')).map((r) => r.category)).toEqual(['all']);
  });
});

test.describe('account preferences (AC-06)', () => {
  test('the date format changes how dates look, and is remembered', async ({ page }) => {
    const user = await signInAs(page);
    await seedRows(page, user.email, 'expenses', [{ amount: '1.00', category: 'food', payment: 'card', merchant: 'X', created_at: new Date(2026, 9, 19, 12).toISOString() }]);
    await page.goto('/app/history');
    await expect(page.getByRole('region', { name: '19 Oct 2026' })).toBeVisible();
    await page.goto('/app/account');
    await page.getByLabel('Date format').selectOption('dmy');
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();
    await page.goto('/app/history');
    await expect(page.getByRole('region', { name: '19/10/2026' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('region', { name: '19/10/2026' })).toBeVisible();
    expect((await dbRows(page, user.email, 'user_preferences'))[0]).toMatchObject({ date_format: 'dmy' });
  });

  test('rename a category, hide one, add your own; hidden ones stay on past records', async ({ page }) => {
    const user = await signInAs(page);
    await seedRows(page, user.email, 'expenses', [{ amount: '30.00', category: 'car', payment: 'card', merchant: 'Wash', created_at: new Date().toISOString() }]);
    await page.goto('/app/account');
    await page.getByRole('button', { name: 'Categories' }).click();
    const dialog = sheet(page, 'Categories');

    const food = dialog.locator('[data-key="food"] input');
    await food.fill('Makan');
    await food.press('Enter');
    await expect(page.getByText('Saved', { exact: true }).first()).toBeVisible();

    await dialog.locator('[data-key="car"]').getByRole('button', { name: /^Hide/ }).click();
    await expect(dialog.locator('[data-key="car"]')).toContainText('Show');

    await dialog.getByLabel('Add a new one').fill('Pets');
    await dialog.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(dialog.locator('[data-key^="c-pets"]')).toBeVisible();
    await dialog.getByLabel('Add a new one').fill('pets');
    await dialog.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(dialog.getByText('You already have one with that name.')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('dialog', { name: 'Account', exact: true }).getByRole('button', { name: 'Close' }).click(); // Account is a pop-up too

    // the add sheet offers the renamed and the new one, but not the hidden one
    await page.getByRole('button', { name: 'Add a transaction' }).first().click();
    const add = sheet(page, 'Add a transaction');
    await expect(add.getByRole('radio', { name: 'Makan' })).toBeVisible();
    await expect(add.getByRole('radio', { name: 'Pets' })).toBeVisible();
    await expect(add.getByRole('radio', { name: 'Car', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');

    // the old record keeps its category name
    await page.goto('/app/history');
    await expect(page.getByRole('button', { name: /^Wash/ })).toContainText('Car');
    const rows = await dbRows(page, user.email, 'user_categories');
    expect(rows.map((r) => r.category_key)).toEqual(expect.arrayContaining(['food', 'car']));
  });

  test('the last turned-on category cannot be hidden', async ({ page }) => {
    const user = await signInAs(page);
    const base = { icon: 'fa-tag', color: '#6b7280', is_builtin: true, sort_order: 0 };
    const all = ['beverages', 'travel', 'entertain', 'work', 'food', 'shopping', 'utilities', 'car', 'health'];
    await seedRows(page, user.email, 'user_categories', all.map((key) => ({ ...base, category_key: key, label: key, active: false })));
    await page.goto('/app/account');
    await page.getByRole('button', { name: 'Categories' }).click();
    const dialog = sheet(page, 'Categories');
    await expect(dialog.locator('[data-key="other"]')).toBeVisible();
    await dialog.locator('[data-key="other"]').getByRole('button', { name: /^Hide/ }).click();
    await expect(dialog.getByText('Keep at least one turned on.')).toBeVisible();
  });
});
