// ON-01: the first-time guided tour: starts once for a new account, points at the real buttons on a phone and on a computer,
// has Previous / Next / Skip, remembers it was seen, and can be replayed from Account.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { signInAs } from './helpers';

async function home(page: Page) {
  await page.goto('/app');
  await expect(page.getByRole('heading', { level: 1, name: /^Hello,/ })).toBeVisible();
}

for (const [label, viewport] of [['phone', { width: 390, height: 800 }], ['computer', { width: 1280, height: 800 }]] as const) {
  test(`the tour starts for a new account and walks through five steps on a ${label}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await signInAs(page, { tour: true });
    await home(page);
    await expect(page.getByTestId('tour')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Step 1 of 5')).toBeVisible();
    await expect(page.getByTestId('tour').getByRole('button', { name: 'Previous', exact: true })).toBeDisabled();

    // step 1 points at a real, visible Add button
    const ring = page.locator('[data-testid="tour"] rect[rx="14"]').last();
    await expect(ring).toBeVisible();

    await page.getByTestId('tour-next').click();
    await expect(page.getByText('Step 2 of 5')).toBeVisible();
    await expect(page.locator('[data-sheet]')).toBeVisible(); // the Scan step shows the Add pop-up
    await page.getByTestId('tour').getByRole('button', { name: 'Previous', exact: true }).click();
    await expect(page.getByText('Step 1 of 5')).toBeVisible();
    await expect(page.locator('[data-sheet]')).toHaveCount(0);

    for (let i = 0; i < 4; i += 1) await page.getByTestId('tour-next').click();
    await expect(page.getByText('Step 5 of 5')).toBeVisible();
    await page.getByTestId('tour-next').click(); // Done
    await expect(page.getByTestId('tour')).toBeHidden();

    // seen: it does not come back
    await home(page);
    await page.waitForTimeout(2200);
    await expect(page.getByTestId('tour')).toBeHidden();
  });
}

test('Skip ends the tour at once, Esc does too, and Account can replay it', async ({ page }) => {
  await signInAs(page, { tour: true });
  await home(page);
  await expect(page.getByTestId('tour')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Skip tour' }).click();
  await expect(page.getByTestId('tour')).toBeHidden();

  await page.goto('/app/account');
  await page.getByTestId('tour-replay').scrollIntoViewIfNeeded();
  await page.getByTestId('tour-replay').click();
  await expect(page.getByTestId('tour')).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('tour')).toBeHidden();
});

test('other tests never see the tour: it stays away when it was already seen on this device', async ({ page }) => {
  await signInAs(page);
  await home(page);
  await page.waitForTimeout(2200);
  await expect(page.getByTestId('tour')).toBeHidden();
});

test('the tour card passes the accessibility scan on a phone, light and dark', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await signInAs(page, { tour: true });
  await home(page);
  await expect(page.getByTestId('tour')).toBeVisible({ timeout: 10_000 });
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    const results = await new AxeBuilder({ page }).include('[data-testid="tour"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
  }
});
