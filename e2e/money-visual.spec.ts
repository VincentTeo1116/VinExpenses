// A11Y-01 and RESP-01 for the money screens, with realistic and awkward data (very long names, large amounts, many rows).
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { HEIGHTS, isoDaysAgo, seedRows, signInAs, WIDTHS, ymdDaysFromNow } from './helpers';

async function withData(page: Page) {
  const user = await signInAs(page, { name: 'Visual Money' });
  const expenses = Array.from({ length: 14 }, (_, i) => ({
    amount: i === 0 ? '123456789.99' : (5 + i * 3.5).toFixed(2),
    category: ['food', 'car', 'travel', 'health', 'shopping', 'utilities'][i % 6],
    payment: ['card', 'bank', 'ewallet'][i % 3],
    merchant: i === 1 ? 'A very long merchant name that keeps going and going to test wrapping in a narrow row' : `Place ${i}`,
    note: i % 4 === 0 ? 'a note' : null,
    created_at: isoDaysAgo(i % 5),
  }));
  await seedRows(page, user.email, 'expenses', expenses);
  await seedRows(page, user.email, 'incomes', [{ amount: '4500.00', source: 'Salary', created_at: isoDaysAgo(2) }]);
  await seedRows(page, user.email, 'recurring_expenses', [
    { name: 'Rent for the flat near the office with a long name', amount: '1500.00', category: 'utilities', payment: 'bank', frequency: 'monthly', start_date: ymdDaysFromNow(9), next_due: ymdDaysFromNow(9) },
    { name: 'Gym', amount: '80.00', category: 'health', payment: 'card', frequency: 'monthly', start_date: ymdDaysFromNow(2), next_due: ymdDaysFromNow(2), active: false },
  ]);
  await seedRows(page, user.email, 'recurring_incomes', [{ source: 'Salary', amount: '4500.00', frequency: 'monthly', start_date: ymdDaysFromNow(20), next_due: ymdDaysFromNow(20) }]);
  await seedRows(page, user.email, 'budgets', [{ category: 'all', amount: '2000.00' }, { category: 'food', amount: '60.00' }, { category: 'car', amount: '20.00' }]);
  await seedRows(page, user.email, 'fixed_deposits', [
    { name: 'A fixed deposit with a very long name that should wrap neatly on a narrow phone screen', bank: 'Some Bank Berhad', principal: 123456.78, rate: 3.85, start_date: ymdDaysFromNow(-100), tenure_value: 12, tenure_unit: 'months', maturity_date: ymdDaysFromNow(265), payout: 'monthly', tax_rate: 0, day_basis: 365, reminders_on: true, reminder_days: [7, 1, 0], status: 'open', interest_recorded: false },
    { name: 'Matured one', bank: null, principal: 5000, rate: 3, start_date: ymdDaysFromNow(-366), tenure_value: 12, tenure_unit: 'months', maturity_date: ymdDaysFromNow(-1), payout: 'maturity', tax_rate: 0, day_basis: 365, reminders_on: true, reminder_days: [7, 1, 0], status: 'open', interest_recorded: false },
  ]);
  await seedRows(page, user.email, 'loans', [
    { name: 'Home loan with a long descriptive name for the narrow layout', lender: 'Another Bank', principal: 450000, rate: 4.25, method: 'reducing', term_months: 360, first_payment_date: ymdDaysFromNow(-70), fees: 1200, instalment: 2213.5, reminders_on: true, reminder_days: [3, 0], status: 'open', paid_through: null },
    { name: 'Phone', lender: null, principal: 3000, rate: 0, method: 'flat', term_months: 12, first_payment_date: ymdDaysFromNow(4), fees: 0, instalment: 250, reminders_on: true, reminder_days: [3, 0], status: 'open', paid_through: null },
  ]);
  return user;
}

/** Visits each money screen and state, and calls `check` on it. */
async function eachScreen(page: Page, check: (name: string) => Promise<void>) {
  await withData(page);
  await page.goto('/app');
  await expect(page.getByTestId('spent')).toBeVisible();
  await check('home');

  await page.goto('/app/history');
  await expect(page.getByRole('button', { name: /^Place 2/ })).toBeVisible();
  await check('history');

  await page.getByRole('button', { name: /^Place 2/ }).click();
  await expect(page.getByRole('dialog', { name: 'Edit transaction' })).toBeVisible();
  await check('edit sheet');
  await page.keyboard.press('Escape');

  await page.getByRole('main').getByRole('button', { name: 'Add a transaction' }).or(page.getByRole('button', { name: 'Add a transaction' }).first()).first().click();
  await expect(page.getByRole('dialog', { name: 'Add a transaction' })).toBeVisible();
  await page.getByLabel('Amount (RM)').fill('abc');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Enter an amount above 0, with up to 2 decimals.')).toBeVisible();
  await check('add sheet with an error');
  await page.getByRole('button', { name: 'Income', exact: true }).click();
  await check('add income');
  await page.keyboard.press('Escape');

  await page.goto('/app/plan');
  await expect(page.getByRole('listitem').filter({ hasText: 'Gym' }).first()).toBeVisible();
  await check('recurring');
  await page.getByRole('listitem').filter({ hasText: 'Gym' }).first().getByRole('button', { name: /^Delete/ }).click();
  await expect(page.getByRole('dialog', { name: 'Delete this regular item?' })).toBeVisible();
  await check('delete a regular item');
  await page.keyboard.press('Escape');

  await page.getByRole('tab', { name: 'Budgets' }).click();
  await expect(page.locator('[data-budget="food"] progress')).toBeVisible();
  await check('budgets');

  await page.getByRole('tab', { name: 'Deposits' }).click();
  await page.getByLabel('Deposit amount (RM)').fill('250000');
  await page.getByLabel('Interest rate (% a year)').fill('3.85');
  await page.getByLabel('Interest is paid').selectOption('monthly');
  await expect(page.locator('[data-deposit="Matured one"]')).toBeVisible();
  await check('deposits');

  await page.getByRole('tab', { name: 'Loans' }).click();
  await page.getByLabel('Loan amount (RM)').fill('450000');
  await page.getByLabel('Interest rate (% a year)').fill('4.25');
  await page.getByLabel('Loan term', { exact: true }).fill('30');
  await expect(page.locator('[data-loan="Phone"]')).toBeVisible();
  await check('loans');

  await page.goto('/app/account');
  await page.getByRole('button', { name: 'Categories' }).click();
  await expect(page.getByRole('dialog', { name: 'Categories' })).toBeVisible();
  await check('categories sheet');
  await page.keyboard.press('Escape');
  await check('account');
}

for (const scheme of ['light', 'dark'] as const) {
  for (const width of [375, 1440]) {
    test(`every money screen passes the accessibility scan (${scheme}, ${width}px)`, async ({ browser }) => {
      test.setTimeout(180_000); // a long walk through every screen, with a scan on each
      const context = await browser.newContext({ colorScheme: scheme, viewport: { width, height: HEIGHTS[width] ?? 800 }, reducedMotion: 'reduce' });
      const page = await context.newPage();
      await eachScreen(page, async (name) => {
        const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
        expect(results.violations.map((v) => `${v.impact}: ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`), `${name} (${scheme} ${width})`).toEqual([]);
        if (scheme === 'light') await page.screenshot({ path: `screenshots/money-${width}-${name.replace(/\W+/g, '-')}.png`, fullPage: name === 'home' || name === 'history' || name === 'recurring' || name === 'budgets' || name === 'deposits' || name === 'loans' });
      });
      await context.close();
    });
  }
}

for (const width of WIDTHS) {
  test(`no money screen scrolls sideways or clips a control at ${width}px`, async ({ browser }) => {
    test.setTimeout(180_000);
    const context = await browser.newContext({ viewport: { width, height: HEIGHTS[width] ?? 800 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await eachScreen(page, async (name) => {
      await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined)))); // measure after the sheet has settled
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `${name} at ${width}px`).toBeLessThanOrEqual(0);
      const small = await page.evaluate(() =>
        [...document.querySelectorAll('button, a, input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]):not([type="file"]), select, textarea, label:has(input[type="radio"]), label:has(input[type="checkbox"])')]
          .filter((el) => (el as HTMLElement).offsetParent !== null && !el.closest('[inert]'))
          .map((el) => ({ name: (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 36), h: el.getBoundingClientRect().height }))
          .filter((item) => item.h > 0 && item.h < 44),
      );
      expect(small.filter((item) => !/Skip/.test(item.name)), `targets under 44px on ${name} at ${width}px`).toEqual([]);
    });
    await context.close();
  });
}
