// TX-01 … TX-06, HI-01 … HI-03: adding, changing and deleting records, History, the budget heads-up and the offline queue.
import { expect, test, type Page } from '@playwright/test';
import { BACKEND } from './api';
import { dbRows, isoDaysAgo, seedRows, signInAs } from './helpers';

const addButton = (page: Page) => page.getByRole('button', { name: 'Add a transaction' }).first();
const sheet = (page: Page, name = 'Add a transaction') => page.getByRole('dialog', { name });


/** The add sheet's code is fetched shortly after the app loads; going offline before that would leave nothing to open. */
async function addSheetReady(page: Page) {
  await page.waitForFunction(() => performance.getEntriesByType('resource').some((entry) => entry.name.includes('AddSheet')));
}

async function openHistory(page: Page) {
  await page.goto('/app/history');
  await expect(page.getByRole('heading', { level: 1, name: 'History' })).toBeVisible();
}

async function addExpense(page: Page, input: { amount: string; category?: string; payment?: string; merchant?: string; note?: string }) {
  await addButton(page).click();
  const dialog = sheet(page);
  await dialog.getByLabel('Amount (RM)').fill(input.amount);
  if (input.category) await dialog.getByRole('radio', { name: input.category }).check();
  if (input.payment) await dialog.getByRole('radio', { name: input.payment }).check();
  if (input.merchant) await dialog.getByLabel('Where (optional)').fill(input.merchant);
  if (input.note) await dialog.getByLabel('Note (optional)').fill(input.note);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
}

test.describe('adding (TX-01 … TX-03)', () => {
  test('an expense: amount first, category, payment and place; it appears in History and in the database', async ({ page }) => {
    const user = await signInAs(page);
    await page.goto('/app');
    await addExpense(page, { amount: '12.5', category: 'Food', payment: 'Card', merchant: 'Kopitiam Ali', note: 'lunch' });
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();
    await expect(sheet(page)).toBeHidden();

    await page.getByRole('link', { name: 'History' }).first().click();
    const row = page.getByRole('button', { name: /^Kopitiam Ali/ });
    await expect(row).toBeVisible();
    await expect(row).toContainText('− RM 12.50');
    await expect(row).toContainText('Food · Card');
    const saved = await dbRows(page, user.email, 'expenses');
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ amount: '12.50', category: 'food', payment: 'card', merchant: 'Kopitiam Ali', note: 'lunch', user_id: user.id });
  });

  test('every field explains itself, and nothing is saved until the amount is right', async ({ page }) => {
    const user = await signInAs(page);
    await page.goto('/app');
    await addButton(page).click();
    const dialog = sheet(page);
    for (const bad of ['', '0', 'abc', '12.345', '-5', '1e5']) {
      await dialog.getByLabel('Amount (RM)').fill(bad);
      await dialog.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(dialog.getByText('Enter an amount above 0, with up to 2 decimals.'), JSON.stringify(bad)).toBeVisible();
    }
    await dialog.getByLabel('Amount (RM)').fill('5');
    await dialog.getByLabel('Date').fill('');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog.getByText('Choose a real date.')).toBeVisible();
    expect(await dbRows(page, user.email, 'expenses')).toHaveLength(0);
  });

  test('an income: pick a source, it counts as plus', async ({ page }) => {
    const user = await signInAs(page);
    await page.goto('/app');
    await addButton(page).click();
    const dialog = sheet(page);
    await dialog.getByRole('button', { name: 'Income', exact: true }).click();
    await dialog.getByLabel('Amount (RM)').fill('3,000');
    await dialog.getByRole('radio', { name: 'Bonus' }).check();
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'History' }).first().click();
    const row = page.getByRole('button', { name: /^Bonus/ });
    await expect(row).toContainText('+ RM 3,000.00');
    expect((await dbRows(page, user.email, 'incomes'))[0]).toMatchObject({ amount: '3000.00', source: 'Bonus' });
  });

  test('the same amount at the same place twice asks first; "Save again" saves it', async ({ page }) => {
    const user = await signInAs(page);
    await page.goto('/app');
    await addExpense(page, { amount: '8.80', category: 'Beverages', merchant: 'Tealive' });
    await expect(sheet(page)).toBeHidden();
    await addExpense(page, { amount: '8.80', category: 'Beverages', merchant: 'tealive ' });
    const dialog = sheet(page);
    await expect(dialog.getByText('Looks like a repeat')).toBeVisible();
    expect(await dbRows(page, user.email, 'expenses')).toHaveLength(1);
    await dialog.getByRole('button', { name: 'Save again' }).click();
    await expect(dialog).toBeHidden();
    expect(await dbRows(page, user.email, 'expenses')).toHaveLength(2);
  });

  test('the N key opens the add sheet, but not while typing in a field', async ({ page }) => {
    await signInAs(page);
    await page.goto('/app/history');
    await expect(page.getByRole('heading', { level: 1, name: 'History' })).toBeVisible();
    await page.getByRole('searchbox').fill('n');
    await expect(sheet(page)).toBeHidden();
    await page.getByRole('searchbox').blur();
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('n');
    await expect(sheet(page)).toBeVisible();
  });
});

test.describe('changing and deleting (TX-04)', () => {
  test('a record opens for editing with its values, and the change is saved', async ({ page }) => {
    const user = await signInAs(page);
    await seedRows(page, user.email, 'expenses', [{ amount: '20.00', category: 'food', payment: 'card', merchant: 'Old Place', note: null, created_at: isoDaysAgo(1) }]);
    await openHistory(page);
    await page.getByRole('button', { name: /^Old Place/ }).click();
    const dialog = sheet(page, 'Edit transaction');
    await expect(dialog.getByLabel('Amount (RM)')).toHaveValue('20');
    await expect(dialog.getByLabel('Where (optional)')).toHaveValue('Old Place');
    await expect(dialog.getByRole('button', { name: 'Expense', exact: true })).toHaveCount(0); // the kind cannot change
    await dialog.getByLabel('Amount (RM)').fill('25.5');
    await dialog.getByLabel('Where (optional)').fill('New Place');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Changes saved')).toBeVisible();
    await expect(page.getByRole('button', { name: /^New Place/ })).toContainText('− RM 25.50');
    expect((await dbRows(page, user.email, 'expenses'))[0]).toMatchObject({ amount: '25.50', merchant: 'New Place' });
  });

  test('deleting shows Undo, and Undo puts the record back with its date', async ({ page }) => {
    const user = await signInAs(page);
    const when = isoDaysAgo(3);
    await seedRows(page, user.email, 'expenses', [{ amount: '9.90', category: 'travel', payment: 'bank', merchant: 'Grab', note: 'ride', created_at: when }]);
    await openHistory(page);
    await page.getByRole('button', { name: /^Grab/ }).click();
    await sheet(page, 'Edit transaction').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('Deleted', { exact: true })).toBeVisible();
    expect(await dbRows(page, user.email, 'expenses')).toHaveLength(0);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByText('Put back')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Grab/ })).toBeVisible();
    const back = await dbRows(page, user.email, 'expenses');
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ amount: '9.90', merchant: 'Grab', note: 'ride', category: 'travel' });
    expect(new Date(String(back[0]?.created_at)).toISOString()).toBe(when);
  });

  test('the Duplicate button on a row copies it to today', async ({ page }) => {
    const user = await signInAs(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedRows(page, user.email, 'expenses', [{ amount: '4.00', category: 'food', payment: 'card', merchant: 'Roti', note: null, created_at: isoDaysAgo(5) }]);
    await openHistory(page);
    await page.getByRole('button', { name: /^Duplicate: Roti/ }).click();
    const dialog = sheet(page);
    await expect(dialog.getByLabel('Where (optional)')).toHaveValue('Roti');
    await expect(dialog.getByLabel('Date')).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(async () => (await dbRows(page, user.email, 'expenses')).length).toBe(2);
  });
});

test.describe('budgets heads-up (TX-05)', () => {
  test('a message when an expense crosses 80% and again at 100%, and not for every expense', async ({ page }) => {
    const user = await signInAs(page);
    await seedRows(page, user.email, 'budgets', [{ category: 'food', amount: '100.00' }]);
    await page.goto('/app');
    await addExpense(page, { amount: '50', category: 'Food' });
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();
    await expect(page.getByText(/has used \d+% of its budget/)).toHaveCount(0);
    await page.waitForTimeout(300);

    await addExpense(page, { amount: '35', category: 'Food', merchant: 'second' });
    await expect(page.getByText('Food has used 85% of its budget.')).toBeVisible();

    await addExpense(page, { amount: '20', category: 'Food', merchant: 'third' });
    await expect(page.getByText('Food is over its budget.')).toBeVisible();
    await page.waitForTimeout(300);

    await addExpense(page, { amount: '5', category: 'Food', merchant: 'fourth' });
    await page.waitForTimeout(800);
    await expect(page.getByText('Food is over its budget.')).toHaveCount(1); // the earlier toast only; no new one
  });
});

test.describe('History (HI-01 … HI-03)', () => {
  test('grouped by day with a signed day total; filters and search narrow it down', async ({ page }) => {
    const user = await signInAs(page);
    await seedRows(page, user.email, 'expenses', [
      { amount: '10.00', category: 'food', payment: 'card', merchant: 'Nasi Lemak', created_at: isoDaysAgo(0) },
      { amount: '30.00', category: 'car', payment: 'bank', merchant: 'Petronas', created_at: isoDaysAgo(0) },
      { amount: '5.00', category: 'food', payment: 'ewallet', merchant: 'Kopi', created_at: isoDaysAgo(40) },
    ]);
    await seedRows(page, user.email, 'incomes', [{ amount: '100.00', source: 'Salary', created_at: isoDaysAgo(0) }]);
    await openHistory(page);

    // today: -10 -30 +100 = +60
    const today = page.locator('section[aria-label]').filter({ hasText: 'Today' }).first();
    await expect(today.getByText('+ RM 60.00')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Salary/ })).toContainText('+ RM 100.00');

    await page.getByLabel('Show').selectOption('income');
    await expect(page.getByRole('button', { name: /^Nasi Lemak/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Salary/ })).toBeVisible();
    await page.getByLabel('Show').selectOption('all');

    await page.getByLabel('Category').selectOption('car');
    await expect(page.getByRole('button', { name: /^Petronas/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Nasi Lemak/ })).toHaveCount(0);
    await page.getByLabel('Category').selectOption('');

    await page.getByRole('searchbox').fill('kopi');
    await expect(page.getByRole('button', { name: /^Kopi/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Nasi/ })).toHaveCount(0);
    await page.getByRole('searchbox').fill('zzz nothing');
    await expect(page.getByText('Nothing matches. Try another month or clear the search.')).toBeVisible();
  });

  test('an empty History says what to do', async ({ page }) => {
    await signInAs(page);
    await openHistory(page);
    await expect(page.getByText('Nothing here yet. Tap + to add your first transaction.')).toBeVisible();
    await page.getByRole('main').getByRole('button', { name: 'Add a transaction' }).last().click(); // the one in the empty state
    await expect(sheet(page)).toBeVisible();
  });

  test('a history longer than 1,000 records is read completely', async ({ page }) => {
    const user = await signInAs(page);
    const rows = Array.from({ length: 1205 }, (_, i) => ({ amount: '1.00', category: 'food', payment: 'card', merchant: `bulk-${i}`, created_at: isoDaysAgo(i) }));
    await seedRows(page, user.email, 'expenses', rows);
    await openHistory(page);
    await page.getByRole('searchbox').fill('bulk-1204'); // the very last one, beyond the first page of 1,000
    await expect(page.getByRole('button', { name: /^bulk-1204/ })).toBeVisible();
    await page.getByRole('searchbox').fill('bulk-999');
    await expect(page.getByRole('button', { name: /^bulk-999/ }).first()).toBeVisible();
  });

  test('you never see, change or delete anyone else\'s records', async ({ page, browser }) => {
    const mine = await signInAs(page, { name: 'Me' });
    const other = await signInAs(await (await browser.newContext()).newPage(), { name: 'Other' });
    await seedRows(page, other.email, 'expenses', [{ amount: '777.00', category: 'food', payment: 'card', merchant: 'Secret Shop', created_at: isoDaysAgo(1) }]);
    const secret = (await dbRows(page, other.email, 'expenses'))[0] as { id: string };
    await openHistory(page);
    await expect(page.getByText('Secret Shop')).toHaveCount(0);
    expect(await dbRows(page, mine.email, 'expenses')).toHaveLength(0);

    // try anyway, straight at the database, with my own sign-in
    const attempt = await page.evaluate(async ({ id, backend }) => {
      const stored = JSON.parse(localStorage.getItem('sb-127-auth-token') ?? '{}') as { access_token: string };
      const headers = { apikey: 'e2e-anon-key-for-tests-only-0000000', Authorization: `Bearer ${stored.access_token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
      const read = await (await fetch(`${backend}/rest/v1/expenses?id=eq.${id}`, { headers })).json();
      const patch = await (await fetch(`${backend}/rest/v1/expenses?id=eq.${id}`, { method: 'PATCH', headers, body: JSON.stringify({ amount: '1.00' }) })).json();
      const del = await (await fetch(`${backend}/rest/v1/expenses?id=eq.${id}`, { method: 'DELETE', headers })).json();
      const forged = await fetch(`${backend}/rest/v1/expenses`, { method: 'POST', headers, body: JSON.stringify({ user_id: 'someone-else', amount: '1.00', category: 'food', payment: 'card' }) });
      return { read, patch, del, forgedStatus: forged.status };
    }, { id: secret.id, backend: BACKEND });
    expect(attempt.read).toEqual([]);
    expect(attempt.patch).toEqual([]);
    expect(attempt.del).toEqual([]);
    expect(attempt.forgedStatus).toBe(403);
    expect((await dbRows(page, other.email, 'expenses'))[0]).toMatchObject({ amount: '777.00', merchant: 'Secret Shop' });
  });
});

test.describe('offline (TX-06)', () => {
  test('saved on this device while offline, shown as not synced, sent when the connection returns', async ({ page, context }) => {
    const user = await signInAs(page);
    await page.goto('/app/history');
    await expect(page.getByRole('heading', { level: 1, name: 'History' })).toBeVisible();
    await addSheetReady(page);
    await context.setOffline(true);
    await expect(page.getByText(/You are offline/)).toBeVisible();

    await addExpense(page, { amount: '15', category: 'Food', merchant: 'Offline Cafe' });
    await expect(page.getByText('Saved on this device. It will be sent when you are back online.')).toBeVisible();
    const row = page.getByRole('button', { name: /^Offline Cafe/ });
    await expect(row).toContainText('Not synced');
    await expect(page.getByText('1 saved on this device, waiting to be sent.')).toBeVisible();
    expect(await dbRows(page, user.email, 'expenses')).toHaveLength(0);

    // it survives a reload while still offline
    const kept = await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('ve_pending_')).length);
    expect(kept).toBe(1);

    await context.setOffline(false);
    await expect(page.getByText('1 entries saved offline were sent.')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Offline Cafe/ })).not.toContainText('Not synced');
    const saved = await dbRows(page, user.email, 'expenses');
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ amount: '15.00', merchant: 'Offline Cafe' });
    expect(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('ve_pending_')).length)).toBe(0);
  });

  test('a record waiting to be sent can be deleted before it is sent', async ({ page, context }) => {
    const user = await signInAs(page);
    await page.goto('/app/history');
    await expect(page.getByRole('heading', { level: 1, name: 'History' })).toBeVisible();
    await addSheetReady(page);
    await context.setOffline(true);
    await addExpense(page, { amount: '3', category: 'Food', merchant: 'Oops' });
    await page.getByRole('button', { name: /^Oops/ }).click();
    await sheet(page, 'Edit transaction').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('button', { name: /^Oops/ })).toHaveCount(0);
    await context.setOffline(false);
    await page.waitForTimeout(800);
    expect(await dbRows(page, user.email, 'expenses')).toHaveLength(0);
  });
});
