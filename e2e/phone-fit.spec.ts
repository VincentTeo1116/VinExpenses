// Every pop-up fits the screen exactly (nothing to drag sideways) on phone, tablet and computer; and the History swipe gestures.
import { expect, test, type Page } from '@playwright/test';
import { dbRows, isoDaysAgo, openAccount, seedRows, signInAs, ymdDaysFromNow } from './helpers';

const WIDTHS = [320, 375, 430, 768, 1024, 1440];

/** What is wrong with the pop-ups on screen right now (an empty list means they all fit). */
const misfits = (page: Page) =>
  page.evaluate(() => {
    const problems: string[] = [];
    const pageOver = document.documentElement.scrollWidth - window.innerWidth;
    if (pageOver > 0) problems.push(`the page is ${pageOver}px wider than the screen`);
    for (const sheet of document.querySelectorAll<HTMLElement>('[role="dialog"]')) {
      const name = sheet.querySelector('h2')?.textContent ?? 'dialog';
      const box = sheet.getBoundingClientRect();
      if (box.left < -0.5 || box.right > window.innerWidth + 0.5) problems.push(`"${name}" sticks out of the screen (${Math.round(box.left)}..${Math.round(box.right)} of ${window.innerWidth})`);
      if (sheet.scrollWidth > sheet.clientWidth) problems.push(`"${name}" can be scrolled sideways by ${sheet.scrollWidth - sheet.clientWidth}px`);
      if (getComputedStyle(sheet).overflowX !== 'hidden' && getComputedStyle(sheet).overflowX !== 'clip') problems.push(`"${name}" allows sideways scrolling`);
      for (const el of sheet.querySelectorAll<HTMLElement>('*')) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && (r.right > box.right + 1 || r.left < box.left - 1) && !el.closest('.sr-only') && getComputedStyle(el).position !== 'absolute') {
          problems.push(`"${name}": <${el.tagName.toLowerCase()}> "${(el.textContent ?? '').trim().slice(0, 24)}" sticks out (${Math.round(r.left)}..${Math.round(r.right)} of ${Math.round(box.left)}..${Math.round(box.right)})`);
          break;
        }
      }
    }
    return problems;
  });

async function seed(page: Page) {
  const user = await signInAs(page, { name: 'A very long display name that should never widen anything' });
  await seedRows(page, user.email, 'expenses', [
    { amount: '123456789.99', category: 'food', payment: 'card', merchant: 'A merchant with an exceptionally long name that goes on and on', note: 'a-very-long-unbroken-note-'.repeat(4), created_at: isoDaysAgo(0) },
    { amount: '12.50', category: 'car', payment: 'bank', merchant: 'Petronas', note: null, created_at: isoDaysAgo(1) },
  ]);
  await seedRows(page, user.email, 'recurring_expenses', [{ name: 'Rent for the apartment near the station', amount: '1200.00', category: 'utilities', payment: 'bank', frequency: 'monthly', start_date: ymdDaysFromNow(5), next_due: ymdDaysFromNow(5) }]);
  return user;
}

for (const width of WIDTHS) {
  test(`every pop-up fits the screen and cannot be dragged sideways at ${width}px`, async ({ browser }) => {
    test.setTimeout(150_000);
    const touch = width < 1024;
    const context = await browser.newContext({ viewport: { width, height: width < 600 ? 720 : 900 }, reducedMotion: 'reduce', hasTouch: touch, isMobile: touch });
    const page = await context.newPage();
    await seed(page);
    const check = async (label: string) => expect(await misfits(page), `${label} at ${width}px`).toEqual([]);
    const close = async () => {
      await page.getByRole('dialog').last().getByRole('button', { name: 'Close' }).click();
    };

    // add: expense (with the nearby list's button and the scan box) and income
    await page.goto('/app');
    await expect(page.getByTestId('spent')).toBeVisible();
    await page.keyboard.press('Escape'); // any reminder pop-up
    await page.getByRole('button', { name: 'Add a transaction' }).first().click();
    await expect(page.getByRole('dialog', { name: 'Add a transaction' })).toBeVisible();
    await check('add an expense');
    await page.getByLabel('Amount (RM)').fill('abc');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await check('add an expense, with errors');
    await page.getByRole('button', { name: 'Income', exact: true }).click();
    await check('add income');
    await close();

    // edit an existing one, with its very long name and note
    await page.goto('/app/history');
    await page.getByRole('button', { name: /^A merchant with/ }).click();
    await expect(page.getByRole('dialog', { name: 'Edit transaction' })).toBeVisible();
    await check('edit a transaction');
    await close();

    // Plan: the add form is a pop-up now; and the delete question
    await page.goto('/app/plan');
    await page.getByRole('button', { name: 'Add a regular item' }).click();
    await expect(page.getByRole('dialog', { name: 'Add a regular item' })).toBeVisible();
    await check('add a regular item');
    await page.getByRole('dialog').getByRole('button', { name: 'Income', exact: true }).click();
    await check('add regular income');
    await close();
    await page.getByRole('button', { name: /^Delete Rent/ }).click();
    await check('delete a regular item');
    await close();

    // Account, and each of its sections on top of it
    await openAccount(page);
    await check('account');
    for (const section of ['Reminder settings', 'Telegram', 'Monthly report', 'Your data', 'Security', 'Change password', 'Delete my account']) {
      await page.getByRole('dialog', { name: 'Account', exact: true }).getByRole('button', { name: section, exact: true }).click();
      await expect(page.getByRole('dialog', { name: section, exact: true })).toBeVisible();
      await check(`account: ${section}`);
      await close();
    }
    await page.getByRole('dialog', { name: 'Account', exact: true }).getByRole('button', { name: 'Categories' }).click();
    await check('account: categories');
    await context.close();
  });
}

/** A finger dragged across the first row of History. */
async function drag(page: Page, name: RegExp, dx: number, dy = 0) {
  const target = page.getByRole('button', { name }).first();
  const box = (await target.boundingBox()) as { x: number; y: number; width: number; height: number };
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await target.evaluate(
    (el, p) => {
      const fire = (type: string, cx: number, cy: number) => el.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: cx, clientY: cy, bubbles: true, cancelable: true }));
      fire('pointerdown', p.x, p.y);
      for (let step = 1; step <= 6; step += 1) fire('pointermove', p.x + (p.dx * step) / 6, p.y + (p.dy * step) / 6);
      fire('pointerup', p.x + p.dx, p.y + p.dy);
    },
    { x, y, dx, dy },
  );
}

test.describe('swipe gestures on History (TX-04)', () => {
  for (const [name, width] of [['phone', 390], ['tablet', 820]] as const) {
    test(`${name}: swipe right duplicates, swipe left deletes with Undo, and scrolling or a short nudge does nothing`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', hasTouch: true, isMobile: true });
      const page = await context.newPage();
      const user = await signInAs(page);
      await seedRows(page, user.email, 'expenses', [
        { amount: '12.50', category: 'food', payment: 'card', merchant: 'Kopitiam', note: null, created_at: isoDaysAgo(0) },
        { amount: '30.00', category: 'car', payment: 'bank', merchant: 'Petronas', note: null, created_at: isoDaysAgo(1) },
      ]);
      await page.goto('/app/history');
      await expect(page.getByRole('button', { name: /^Kopitiam/ })).toBeVisible();

      // a short nudge, and a mostly up-and-down drag, do nothing
      await drag(page, /^Kopitiam/, 30);
      await drag(page, /^Kopitiam/, 20, 160);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect(await dbRows(page, user.email, 'expenses')).toHaveLength(2);

      // right: the add sheet opens as a copy
      await drag(page, /^Kopitiam/, 120);
      const sheet = page.getByRole('dialog', { name: 'Add a transaction' });
      await expect(sheet).toBeVisible();
      await expect(sheet.getByLabel('Amount (RM)')).toHaveValue(/^12.50?$/);
      await expect(sheet.getByLabel('Where (optional)')).toHaveValue('Kopitiam');
      await sheet.getByRole('button', { name: 'Close' }).click();

      // left: gone, with a way back
      await drag(page, /^Petronas/, -120);
      await expect(page.getByRole('button', { name: /^Petronas/ })).toHaveCount(0);
      await expect.poll(async () => (await dbRows(page, user.email, 'expenses')).length).toBe(1);
      await page.getByRole('button', { name: 'Undo' }).click();
      await expect(page.getByRole('button', { name: /^Petronas/ })).toBeVisible();

      // the row is left exactly as it was: nothing shifted, no leftover styling
      expect(await page.locator('[data-slide][style], li[data-swipe]').count()).toBe(0);
      await context.close();
    });
  }

  test('a mouse does not swipe: the row opens for editing as before', async ({ page }) => {
    const user = await signInAs(page);
    await seedRows(page, user.email, 'expenses', [{ amount: '12.50', category: 'food', payment: 'card', merchant: 'Kopitiam', note: null, created_at: isoDaysAgo(0) }]);
    await page.goto('/app/history');
    const row = page.getByRole('button', { name: /^Kopitiam/ });
    const box = (await row.boundingBox()) as { x: number; y: number; width: number; height: number };
    await page.mouse.move(box.x + 40, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 200, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
    expect(await dbRows(page, user.email, 'expenses')).toHaveLength(1);
    await row.click();
    await expect(page.getByRole('dialog', { name: 'Edit transaction' })).toBeVisible();
  });
});
