import { test, expect } from '@playwright/test';
import { signInAs, seedRows, ymdDaysFromNow, isoDaysAgo } from './helpers';

for (const width of [320, 390]) {
  test(`reminders fit at ${width}px with large text and long names`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'dark' });
    const user = await signInAs(page);
    await seedRows(page, user.email, 'fixed_deposits', [{ name: 'Long-term household emergency savings deposit', bank: 'Maybank', principal: 9999999, rate: 3.5, start_date: ymdDaysFromNow(-364), tenure_value: 12, tenure_unit: 'months', maturity_date: ymdDaysFromNow(1), payout: 'maturity', tax_rate: 0, day_basis: 365, reminders_on: true, reminder_days: [7, 1, 0], status: 'open', interest_recorded: false }]);
    await page.goto('/app');
    const dialog = page.getByRole('dialog', { name: "Don't forget" });
    await expect(dialog).toBeVisible();
    await page.evaluate(() => { document.documentElement.style.fontSize = '20px'; });
    await expect.poll(() => dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    const heading = await dialog.getByRole('heading').boundingBox();
    const item = await dialog.getByRole('listitem').first().boundingBox();
    expect(item!.y - (heading!.y + heading!.height)).toBeGreaterThanOrEqual(20);
    await page.screenshot({ path: `test-results/reminders-${width}.png` });
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const bar = page.getByTestId('reminder-bar');
    await bar.getByRole('button').first().click();
    await expect(bar.getByRole('list')).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/home-reminders-${width}.png` });
  });
}

test('mobile partial swipes close on outside tap and another row', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const user = await signInAs(page);
  await seedRows(page, user.email, 'expenses', ['Lunch', 'Dinner'].map((merchant) => ({ merchant, amount: 20, category: 'food', payment: 'card', created_at: isoDaysAgo(0) })));
  await page.goto('/app/history');
  const rows = page.locator('li[data-kind="expense"]');
  await expect(rows).toHaveCount(2);
  const swipe = async (index: number) => {
    await rows.nth(index).dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 1, clientX: 200, clientY: 10 });
    await rows.nth(index).dispatchEvent('pointermove', { pointerType: 'touch', pointerId: 1, clientX: 140, clientY: 10 });
    await rows.nth(index).dispatchEvent('pointerup', { pointerType: 'touch', pointerId: 1, clientX: 140, clientY: 10 });
  };
  await swipe(0);
  await expect(rows.nth(0)).toHaveAttribute('data-swipe', 'delete');
  await swipe(1);
  await expect(rows.nth(0)).not.toHaveAttribute('data-swipe');
  await expect(rows.nth(1)).toHaveAttribute('data-swipe', 'delete');
  await page.getByRole('heading', { name: 'History', exact: true }).click();
  await expect(rows.nth(1)).not.toHaveAttribute('data-swipe');
});
