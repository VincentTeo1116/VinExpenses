// PL-01 … PL-05: deposit and loan calculators, saved items, reminders. Numbers are checked against hand-worked sums.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { dbRows, seedRows, signInAs, ymdDaysFromNow } from './helpers';

async function openTab(page: Page, tab: 'Deposits' | 'Loans') {
  await page.goto('/app/plan');
  await expect(page.getByRole('heading', { level: 1, name: 'Plan' })).toBeVisible();
  await page.getByRole('tab', { name: tab }).click();
}

const deposit = (over: Record<string, unknown> = {}) => ({
  name: 'Maybank FD', bank: 'Maybank', principal: 10000, rate: 3.5, start_date: ymdDaysFromNow(-100), tenure_value: 12, tenure_unit: 'months',
  maturity_date: ymdDaysFromNow(265), payout: 'maturity', tax_rate: 0, day_basis: 365, reminders_on: true, reminder_days: [7, 1, 0], status: 'open', interest_recorded: false, ...over,
});
const loan = (over: Record<string, unknown> = {}) => ({
  name: 'Car loan', lender: 'Public Bank', principal: 60000, rate: 3, method: 'reducing', term_months: 60, first_payment_date: ymdDaysFromNow(10), fees: 0, instalment: 1078.2,
  reminders_on: true, reminder_days: [3, 0], status: 'open', paid_through: null, ...over,
});

test.describe('fixed deposit calculator (PL-01)', () => {
  test('simple interest, worked by hand: 10,000 at 3.5% for a year is 350.00; with 10% tax, 315.00', async ({ page }) => {
    await signInAs(page);
    await openTab(page, 'Deposits');
    await page.getByLabel('Deposit amount (RM)').fill('10000');
    await page.getByLabel('Interest rate (% a year)').fill('3.5');
    await page.getByLabel('Start date').fill('2026-01-01');
    await expect(page.getByTestId('fd-maturity')).toHaveText('RM 10,350.00');
    await expect(page.getByTestId('fd-interest')).toHaveText('RM 350.00');
    await page.getByLabel('Tax on interest (%, optional)').fill('10');
    await expect(page.getByTestId('fd-net')).toHaveText('RM 315.00');
    await expect(page.getByTestId('fd-maturity')).toHaveText('RM 10,315.00');
    await expect(page.getByText(/Matures on .* \(365 days\)/)).toBeVisible();
  });

  test('mistakes are explained in words, and results return when fixed', async ({ page }) => {
    await signInAs(page);
    await openTab(page, 'Deposits');
    await page.getByLabel('Deposit amount (RM)').fill('abc');
    await expect(page.getByText('The amount must be a number.')).toBeVisible();
    await page.getByLabel('Deposit amount (RM)').fill('5000');
    await page.getByLabel('Interest rate (% a year)').fill('31');
    await expect(page.getByText('The rate must be 30 or less.')).toBeVisible();
    await expect(page.getByTestId('fd-result')).toHaveCount(0);
    await page.getByLabel('Interest rate (% a year)').fill('4');
    await expect(page.getByTestId('fd-result')).toBeVisible();
    await page.getByLabel('Deposit amount (RM)').fill('5000.555');
    await expect(page.getByText('Use at most 2 decimal places.')).toBeVisible();
  });

  test('a monthly payout is listed, and the payouts add up to the interest', async ({ page }) => {
    await signInAs(page);
    await openTab(page, 'Deposits');
    await page.getByLabel('Deposit amount (RM)').fill('12000');
    await page.getByLabel('Interest rate (% a year)').fill('4');
    await page.getByLabel('Start date').fill('2026-01-01');
    await page.getByLabel('Interest is paid').selectOption('monthly');
    const items = page.getByRole('list', { name: 'Payouts' }).getByRole('listitem');
    await expect(items).toHaveCount(12);
    const amounts = (await items.locator('strong').allTextContents()).map((s) => Math.round(Number(s.replace(/[^\d.]/g, '')) * 100));
    const interest = Number((await page.getByTestId('fd-interest').textContent())?.replace(/[^\d.]/g, ''));
    expect(amounts.reduce((a, b) => a + b, 0)).toBe(Math.round(interest * 100)); // 480.00
  });

  test('the earnings table pages through days, months and years', async ({ page }) => {
    await signInAs(page);
    await openTab(page, 'Deposits');
    await page.getByLabel('Deposit amount (RM)').fill('20000');
    await page.getByLabel('Interest rate (% a year)').fill('3');
    await page.getByLabel('Tenure', { exact: true }).fill('2');
    await page.getByLabel('Tenure unit').selectOption('years');
    const table = page.getByRole('region', { name: 'Earnings table' });
    await expect(table.getByRole('row')).toHaveCount(13); // header + 12 months
    await page.getByRole('button', { name: 'Next page' }).click();
    await expect(page.getByText('Page 2 of 2')).toBeVisible();
    await page.getByRole('button', { name: 'Daily', exact: true }).click();
    await expect(table.getByRole('row')).toHaveCount(32);
    await expect(page.getByText(/Page 1 of 24/)).toBeVisible();
    await page.getByRole('button', { name: 'Yearly', exact: true }).click();
    await expect(table.getByRole('row')).toHaveCount(3);
  });

  test('works offline: the sums still update, saving says why it cannot', async ({ page, context }) => {
    const user = await signInAs(page);
    await openTab(page, 'Deposits');
    await context.setOffline(true);
    await page.getByLabel('Deposit amount (RM)').fill('10000');
    await page.getByLabel('Interest rate (% a year)').fill('3.5');
    await page.getByLabel('Start date').fill('2026-01-01');
    await expect(page.getByTestId('fd-interest')).toHaveText('RM 350.00');
    await page.getByLabel('Name', { exact: true }).fill('Offline FD');
    await page.getByRole('button', { name: 'Save deposit' }).click();
    await expect(page.getByText(/You are offline\. Connect to save this/)).toBeVisible();
    expect(await dbRows(page, user.email, 'fixed_deposits')).toHaveLength(0);
  });
});

test.describe('saved deposits (PL-03)', () => {
  test('save, see progress, edit, close, reopen and delete', async ({ page }) => {
    const user = await signInAs(page);
    await openTab(page, 'Deposits');
    await page.getByLabel('Deposit amount (RM)').fill('10000');
    await page.getByLabel('Interest rate (% a year)').fill('3.5');
    await page.getByLabel('Name', { exact: true }).fill('Maybank 12m');
    await page.getByLabel('Bank (optional)').fill('Maybank');
    await page.getByRole('button', { name: 'Save deposit' }).click();
    await expect(page.getByText('Deposit saved')).toBeVisible();

    const saved = (await dbRows(page, user.email, 'fixed_deposits'))[0] as Record<string, unknown>;
    expect(saved).toMatchObject({ name: 'Maybank 12m', bank: 'Maybank', status: 'open', interest_recorded: false, reminders_on: true });
    expect(Number(saved.principal)).toBe(10000);
    expect(saved.reminder_days).toEqual([7, 1, 0]);

    const card = page.locator('[data-deposit="Maybank 12m"]');
    await expect(card).toContainText('Earning');
    await card.getByRole('button', { name: /^Edit: Maybank 12m/ }).click();
    await expect(page.getByText('Editing “Maybank 12m”')).toBeVisible();
    await page.getByLabel('Interest rate (% a year)').fill('4');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Deposit updated')).toBeVisible();
    expect(Number(((await dbRows(page, user.email, 'fixed_deposits'))[0] as Record<string, unknown>).rate)).toBe(4);
    expect(await dbRows(page, user.email, 'fixed_deposits')).toHaveLength(1);

    await card.getByRole('button', { name: /^Close: / }).click();
    await expect(card).toContainText('Closed');
    await expect(card).toContainText('Reminders off');
    await card.getByRole('button', { name: /^Reopen: / }).click();
    await expect(card).toContainText('Earning');

    await card.getByRole('button', { name: /^Delete: / }).click();
    await expect(page.getByRole('dialog', { name: /Delete “Maybank 12m”\?/ })).toBeVisible();
    await page.getByRole('button', { name: 'Delete', exact: true }).last().click();
    await expect(card).toHaveCount(0);
    expect(await dbRows(page, user.email, 'fixed_deposits')).toHaveLength(0);
  });

  test('a name is needed to save, and reminder days are checked', async ({ page }) => {
    await signInAs(page);
    await openTab(page, 'Deposits');
    await page.getByLabel('Deposit amount (RM)').fill('1000');
    await page.getByLabel('Interest rate (% a year)').fill('3');
    await page.getByRole('button', { name: 'Save deposit' }).click();
    await expect(page.getByText('Give it a name to save it.')).toBeVisible();
    await page.getByLabel('Name', { exact: true }).fill('X');
    await page.getByLabel('Days before (for example 7, 1, 0)').fill('7, abc');
    await expect(page.getByText(/Use whole numbers separated by commas/)).toBeVisible();
  });

  test('matured: the interest is added to income once, and cannot be added twice', async ({ page }) => {
    const user = await signInAs(page);
    await seedRows(page, user.email, 'fixed_deposits', [deposit({ name: 'Matured FD', start_date: ymdDaysFromNow(-366), maturity_date: ymdDaysFromNow(-1) })]);
    await openTab(page, 'Deposits');
    const card = page.locator('[data-deposit="Matured FD"]');
    await expect(card).toContainText('Matured');
    await card.getByRole('button', { name: 'Add interest to income' }).click();
    await expect(page.getByText(/added to your income/)).toBeVisible();
    await expect(card.getByRole('button', { name: 'Add interest to income' })).toHaveCount(0);
    const incomes = await dbRows(page, user.email, 'incomes');
    expect(incomes).toHaveLength(1);
    expect(incomes[0]).toMatchObject({ source: 'FD interest: Matured FD', amount: '350.00' });
    expect(((await dbRows(page, user.email, 'fixed_deposits'))[0] as Record<string, unknown>).interest_recorded).toBe(true);
  });

  test('two devices open at once: the second one is told the interest was already added, and no second income appears', async ({ page, context }) => {
    const user = await signInAs(page);
    await seedRows(page, user.email, 'fixed_deposits', [deposit({ name: 'Twice FD', start_date: ymdDaysFromNow(-366), maturity_date: ymdDaysFromNow(-1) })]);
    await openTab(page, 'Deposits');
    const other = await context.newPage();
    await other.goto('/app/plan');
    await other.getByRole('tab', { name: 'Deposits' }).click();
    const first = page.locator('[data-deposit="Twice FD"]').getByRole('button', { name: 'Add interest to income' });
    const second = other.locator('[data-deposit="Twice FD"]').getByRole('button', { name: 'Add interest to income' });
    await expect(second).toBeVisible();
    await first.click();
    await expect(page.getByText(/added to your income/)).toBeVisible();
    await second.click();
    await expect(other.getByText('This interest was already recorded.')).toBeVisible();
    expect(await dbRows(page, user.email, 'incomes')).toHaveLength(1);
  });

  test('renewing starts a new deposit at the old maturity date and closes the old one', async ({ page }) => {
    const user = await signInAs(page);
    await seedRows(page, user.email, 'fixed_deposits', [deposit({ name: 'Old FD', start_date: ymdDaysFromNow(-366), maturity_date: ymdDaysFromNow(-1) })]);
    await openTab(page, 'Deposits');
    await page.locator('[data-deposit="Old FD"]').getByRole('button', { name: /^Renew: / }).click();
    await expect(page.getByLabel('Start date')).toHaveValue(ymdDaysFromNow(-1));
    await page.getByLabel('Name', { exact: true }).fill('New FD');
    await page.getByRole('button', { name: 'Save deposit' }).click();
    await expect(page.getByText('Renewed. The old deposit was closed.')).toBeVisible();
    const rows = (await dbRows(page, user.email, 'fixed_deposits')) as Record<string, unknown>[];
    expect(rows.find((r) => r.name === 'Old FD')?.status).toBe('closed');
    expect(rows.find((r) => r.name === 'New FD')).toMatchObject({ status: 'open', start_date: ymdDaysFromNow(-1) });
  });
});

test.describe('loan calculator (PL-02)', () => {
  test('reducing balance, worked by hand: 100,000 at 4.5% over 10 years is RM 1,036.38 a month', async ({ page }) => {
    await signInAs(page);
    await openTab(page, 'Loans');
    await page.getByLabel('Loan amount (RM)').fill('100000');
    await page.getByLabel('Interest rate (% a year)').fill('4.5');
    await page.getByLabel('Loan term', { exact: true }).fill('10');
    await expect(page.getByTestId('ln-instalment')).toHaveText('RM 1,036.38');
    // the exact schedule rounds each payment to the sen and lets the last one absorb the difference
    const interest = Number((await page.getByTestId('ln-interest').textContent())?.replace(/[^\d.]/g, ''));
    expect(interest).toBeGreaterThan(24365);
    expect(interest).toBeLessThan(24367);
  });

  test('flat rate: 100,000 at 3% over 5 years is RM 1,916.67 a month, and the real rate is shown and higher', async ({ page }) => {
    await signInAs(page);
    await openTab(page, 'Loans');
    await page.getByLabel('Loan amount (RM)').fill('100000');
    await page.getByLabel('Interest rate (% a year)').fill('3');
    await page.getByLabel('How interest is calculated').selectOption('flat');
    await expect(page.getByTestId('ln-instalment')).toHaveText('RM 1,916.67');
    await expect(page.getByTestId('ln-interest')).toHaveText('RM 15,000.00');
    const real = Number((await page.getByTestId('ln-real').textContent())?.replace('%', ''));
    expect(real).toBeGreaterThan(5);
    expect(real).toBeLessThan(6);
    await expect(page.getByText(/A flat rate looks lower than it is/)).toBeVisible();
  });

  test('the schedule pages by 12 months and ends at zero', async ({ page }) => {
    await signInAs(page);
    await openTab(page, 'Loans');
    await page.getByLabel('Loan amount (RM)').fill('30000');
    await page.getByLabel('Interest rate (% a year)').fill('5');
    await page.getByLabel('Loan term', { exact: true }).fill('3');
    const table = page.getByRole('region', { name: 'Repayment schedule' });
    await expect(table.getByRole('row')).toHaveCount(13);
    await page.getByRole('button', { name: 'Next page' }).click();
    await page.getByRole('button', { name: 'Next page' }).click();
    await expect(page.getByText('Page 3 of 3')).toBeVisible();
    await expect(table.getByRole('row').last()).toContainText('RM 0.00');
    await page.getByRole('button', { name: 'Yearly', exact: true }).click();
    await expect(table.getByRole('row')).toHaveCount(4);
  });

  test('bad input is explained, and a too-small loan is refused', async ({ page }) => {
    await signInAs(page);
    await openTab(page, 'Loans');
    await page.getByLabel('Loan amount (RM)').fill('0');
    await expect(page.getByText('The amount must be at least 1.')).toBeVisible();
    await page.getByLabel('Loan amount (RM)').fill('100');
    await page.getByLabel('Interest rate (% a year)').fill('41');
    await expect(page.getByText('The rate must be 40 or less.')).toBeVisible();
  });
});

test.describe('saved loans (PL-03)', () => {
  test('a loan that began in the past counts earlier payments as paid; mark next paid and undo', async ({ page }) => {
    const user = await signInAs(page);
    await openTab(page, 'Loans');
    await page.getByLabel('Loan amount (RM)').fill('12000');
    await page.getByLabel('Interest rate (% a year)').fill('0');
    await page.getByLabel('Loan term', { exact: true }).fill('12');
    await page.getByLabel('Term unit').selectOption('months');
    await page.getByLabel('First payment date').fill(ymdDaysFromNow(-65));
    await page.getByLabel('Name', { exact: true }).fill('Old loan');
    await page.getByRole('button', { name: 'Save loan' }).click();
    await expect(page.getByText('Loan saved. Payments before today are counted as already paid.')).toBeVisible();
    const saved = (await dbRows(page, user.email, 'loans'))[0] as Record<string, unknown>;
    expect(saved.paid_through).toBeTruthy();
    expect(Number(saved.instalment)).toBe(1000);

    const card = page.locator('[data-loan="Old loan"]');
    await expect(card).toContainText(/3 of 12 paid/);
    await card.getByRole('button', { name: /^Mark next payment paid: / }).click();
    await expect(card).toContainText(/4 of 12 paid/);
    await card.getByRole('button', { name: /^Undo last paid: / }).click();
    await expect(card).toContainText(/3 of 12 paid/);
  });

  test('an unpaid past instalment shows as overdue and in the reminders', async ({ page }) => {
    const user = await signInAs(page);
    await seedRows(page, user.email, 'loans', [loan({ name: 'Late loan', first_payment_date: ymdDaysFromNow(-40), paid_through: null })]);
    await openTab(page, 'Loans');
    const card = page.locator('[data-loan="Late loan"]');
    await expect(card).toContainText(/payment\(s\) overdue/);
    await expect(page.getByRole('list', { name: 'Reminders' })).toContainText('Late loan');
    await expect(page.getByRole('list', { name: 'Reminders' })).toContainText('missed');
  });

  test('edit changes the saved loan, and delete removes it', async ({ page }) => {
    const user = await signInAs(page);
    await seedRows(page, user.email, 'loans', [loan({ name: 'Edit me' })]);
    await openTab(page, 'Loans');
    const card = page.locator('[data-loan="Edit me"]');
    await card.getByRole('button', { name: /^Edit: / }).click();
    await page.getByLabel('Name', { exact: true }).fill('Edited');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Loan updated')).toBeVisible();
    expect(await dbRows(page, user.email, 'loans')).toHaveLength(1);
    expect(((await dbRows(page, user.email, 'loans'))[0] as Record<string, unknown>).name).toBe('Edited');
    await page.locator('[data-loan="Edited"]').getByRole('button', { name: /^Delete: / }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).last().click();
    await expect(page.locator('[data-loan="Edited"]')).toHaveCount(0);
    expect(await dbRows(page, user.email, 'loans')).toHaveLength(0);
  });

  test('"all loans" adds the other active loans to the one being worked out', async ({ page }) => {
    const user = await signInAs(page);
    await seedRows(page, user.email, 'loans', [loan({ name: 'Existing', principal: 12000, rate: 0, term_months: 12, instalment: 1000, first_payment_date: ymdDaysFromNow(5) })]);
    await openTab(page, 'Loans');
    await page.getByLabel('Loan amount (RM)').fill('6000');
    await page.getByLabel('Interest rate (% a year)').fill('0');
    await page.getByLabel('Loan term', { exact: true }).fill('12');
    await page.getByLabel('Term unit').selectOption('months');
    await expect(page.getByTestId('ln-all')).toContainText('RM 1,500.00');
  });
});

test.describe('reminders (PL-04)', () => {
  test('a deposit maturing tomorrow shows on Plan and Home, one pop-up, and "24 hours" holds across reloads', async ({ page }) => {
    const user = await signInAs(page);
    await seedRows(page, user.email, 'fixed_deposits', [deposit({ name: 'Soon FD', maturity_date: ymdDaysFromNow(1), start_date: ymdDaysFromNow(-364) })]);
    await page.goto('/app');
    const popup = page.getByRole('dialog', { name: 'Don\'t forget' });
    await expect(popup).toBeVisible();
    await expect(popup).toContainText('Soon FD matures tomorrow');
    await popup.getByRole('button', { name: 'Don\'t show for 24 hours' }).click();
    await expect(popup).toHaveCount(0);
    const prefs = (await dbRows(page, user.email, 'user_preferences'))[0] as Record<string, unknown>;
    expect(new Date(String(prefs.reminder_snooze_until)).getTime()).toBeGreaterThan(Date.now() + 23 * 3600 * 1000);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: /^Hello,/ })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Don\'t forget' })).toHaveCount(0);
    // still on the page itself: a slim bar that opens
    const bar = page.getByTestId('reminder-bar');
    await expect(bar).toContainText('1 coming up');
    await expect(page.getByRole('list', { name: 'Reminders', exact: true })).toHaveCount(0);
    await bar.getByRole('button', { name: /Reminders/ }).click();
    await expect(page.getByRole('list', { name: 'Reminders', exact: true })).toContainText('Soon FD');
    await bar.getByRole('button', { name: /Reminders/ }).click();
    await expect(page.getByRole('list', { name: 'Reminders', exact: true })).toHaveCount(0);
  });

  test('closed items and items with reminders off are not listed; the pop-up can just be closed', async ({ page }) => {
    const user = await signInAs(page);
    await seedRows(page, user.email, 'fixed_deposits', [
      deposit({ name: 'Closed FD', maturity_date: ymdDaysFromNow(1), status: 'closed' }),
      deposit({ name: 'Silent FD', maturity_date: ymdDaysFromNow(1), reminders_on: false }),
      deposit({ name: 'Loud FD', maturity_date: ymdDaysFromNow(0) }),
    ]);
    await page.goto('/app');
    const popup = page.getByRole('dialog', { name: 'Don\'t forget' });
    await expect(popup).toContainText('Loud FD');
    await expect(popup).not.toContainText('Closed FD');
    await expect(popup).not.toContainText('Silent FD');
    await page.keyboard.press('Escape');
    await expect(popup).toHaveCount(0);
  });

  test('a person with nothing due is not interrupted', async ({ page }) => {
    const user = await signInAs(page);
    await seedRows(page, user.email, 'fixed_deposits', [deposit({ name: 'Far FD', maturity_date: ymdDaysFromNow(200) })]);
    await page.goto('/app');
    await expect(page.getByRole('heading', { level: 1, name: /^Hello,/ })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});

for (const scheme of ['light', 'dark'] as const) {
  test(`deposits and loans screens pass the accessibility scan (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const user = await signInAs(page);
    await seedRows(page, user.email, 'fixed_deposits', [deposit({ name: 'FD A', maturity_date: ymdDaysFromNow(1) }), deposit({ name: 'FD B', start_date: ymdDaysFromNow(-366), maturity_date: ymdDaysFromNow(-2) })]);
    await seedRows(page, user.email, 'loans', [loan({ name: 'Loan A' }), loan({ name: 'Loan B', first_payment_date: ymdDaysFromNow(-70) })]);
    for (const tab of ['Deposits', 'Loans'] as const) {
      await openTab(page, tab);
      await page.getByLabel(tab === 'Deposits' ? 'Deposit amount (RM)' : 'Loan amount (RM)').fill('25000');
      await page.getByLabel('Interest rate (% a year)').fill('4');
      await page.getByRole('button', { name: tab === 'Deposits' ? 'Save deposit' : 'Save loan' }).click(); // shows the name error too
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`), `${tab} ${scheme}`).toEqual([]);
    }
  });
}
