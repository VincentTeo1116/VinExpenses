// UX-STAB: closing a pop-up must not rebuild the screen behind it (it looked like a page refresh), and the menus stay while a page downloads.
import { expect, test } from '@playwright/test';
import { signInAs } from './helpers';

test.use({ viewport: { width: 390, height: 800 } });

test('opening and closing the Account pop-up on a phone leaves Home exactly as it was (no rebuild)', async ({ page }) => {
  await signInAs(page);
  await page.goto('/app');
  await expect(page.getByRole('heading', { level: 1, name: /^Hello,/ })).toBeVisible();
  // mark the Home screen's element; a rebuild would create a new element without the mark
  await page.evaluate(() => {
    (document.querySelector('main > div > div') as HTMLElement & { __mark?: boolean }).__mark = true;
  });
  await page.getByRole('link', { name: 'Account' }).first().click();
  const account = page.getByRole('dialog', { name: 'Account', exact: true });
  await expect(account).toBeVisible();
  await account.getByRole('button', { name: 'Close' }).click();
  await expect(account).toBeHidden();
  const stillThere = await page.evaluate(() => Boolean((document.querySelector('main > div > div') as HTMLElement & { __mark?: boolean } | null)?.__mark));
  expect(stillThere).toBe(true);
});

test('the Save button sits in a footer attached to the pop-up, not floating over the form', async ({ page }) => {
  await signInAs(page);
  await page.goto('/app');
  await expect(page.getByRole('heading', { level: 1, name: /^Hello,/ })).toBeVisible();
  await page.getByRole('button', { name: 'Add a transaction' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Add a transaction' });
  const save = dialog.getByRole('button', { name: 'Save', exact: true });
  await expect(save).toBeVisible();
  const [d, s] = await Promise.all([dialog.boundingBox(), save.boundingBox()]);
  // the button is inside the pop-up, near its bottom edge, and the pop-up's own edges frame it (no outside gap)
  expect(s!.y + s!.height).toBeLessThanOrEqual(d!.y + d!.height);
  expect(d!.y + d!.height - (s!.y + s!.height)).toBeLessThan(48);
});
