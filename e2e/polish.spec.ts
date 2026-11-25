// UX-POLISH: toast edges, drawn (not emoji) icons on Budgets, and the note helping to pick a category.
import { expect, test } from '@playwright/test';
import { dbRows, signInAs, ymdDaysFromNow } from './helpers';

test('the note (remarks) helps pick the category, and a category the person chose is kept', async ({ page }) => {
  await signInAs(page);
  await page.goto('/app');
  await expect(page.getByRole('heading', { level: 1, name: /^Hello,/ })).toBeVisible();
  await page.getByRole('button', { name: 'Add a transaction' }).first().click();
  await page.getByLabel('Note (optional)').fill('starbucks with the team');
  await expect(page.getByRole('radio', { name: 'Beverages', exact: true })).toBeChecked();
  // the person picks another one: typing more in the note no longer changes it
  await page.getByRole('radio', { name: 'Food', exact: true }).check();
  await page.getByLabel('Note (optional)').fill('starbucks with the team again');
  await expect(page.getByRole('radio', { name: 'Food', exact: true })).toBeChecked();
});

test('a toast has no coloured stripe on its left edge and carries a soft shadow instead', async ({ page }) => {
  await signInAs(page);
  await page.goto('/app/plan');
  await page.getByRole('tab', { name: 'Budgets' }).click();
  await page.getByLabel('Overall').fill('500');
  await page.getByRole('button', { name: /^Save/ }).first().click();
  const toast = page.getByText('Budgets saved');
  await expect(toast).toBeVisible();
  const shadow = await toast.locator('xpath=ancestor::*[contains(@class,"toast")][1]').evaluate((el) => getComputedStyle(el).boxShadow);
  expect(shadow).not.toContain('inset');
  expect(shadow).not.toBe('none');
});

test('Budgets uses drawn icons, never emoji', async ({ page }) => {
  await signInAs(page);
  await page.goto('/app/plan');
  await page.getByRole('tab', { name: 'Budgets' }).click();
  const rows = page.locator('[data-budget]');
  await expect(rows.first()).toBeVisible();
  const count = await rows.count();
  for (let i = 0; i < count; i += 1) {
    const row = rows.nth(i);
    await expect(row.locator('svg').first()).toBeVisible();
    expect((await row.textContent()) ?? '').not.toMatch(/\p{Extended_Pictographic}/u);
  }
});

test('a date in the future shows a warning, and saving asks first; Yes saves it, No lets the date be changed', async ({ page }) => {
  const user = await signInAs(page);
  await page.goto('/app');
  await expect(page.getByRole('heading', { level: 1, name: /^Hello,/ })).toBeVisible();
  await page.getByRole('button', { name: 'Add a transaction' }).first().click();
  await page.getByLabel('Amount (RM)').fill('12.50');
  await page.getByRole('radio', { name: 'Food', exact: true }).check();
  await page.getByLabel('Date').fill(ymdDaysFromNow(3));
  await expect(page.getByTestId('future-hint')).toBeVisible();

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const ask = page.getByRole('dialog', { name: 'Save a future expense?' });
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'No, change the date' }).click();
  await expect(ask).toBeHidden();
  expect((await dbRows(page, user.email, 'expenses')).length).toBe(0);

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByTestId('future-yes').click();
  await expect(page.getByText('Saved')).toBeVisible();
  expect((await dbRows(page, user.email, 'expenses')).length).toBe(1);
});

test('today and past dates never ask', async ({ page }) => {
  const user = await signInAs(page);
  await page.goto('/app');
  await expect(page.getByRole('heading', { level: 1, name: /^Hello,/ })).toBeVisible();
  await page.getByRole('button', { name: 'Add a transaction' }).first().click();
  await page.getByLabel('Amount (RM)').fill('5.00');
  await page.getByRole('radio', { name: 'Food', exact: true }).check();
  await page.getByLabel('Date').fill(ymdDaysFromNow(-1));
  await expect(page.getByTestId('future-hint')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved')).toBeVisible();
  expect((await dbRows(page, user.email, 'expenses')).length).toBe(1);
});
