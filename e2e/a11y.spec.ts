// A11Y-01: automated accessibility scan in light and dark, plus a keyboard-only walk through the frame.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { signInAs } from './helpers';

const SCHEMES = ['light', 'dark'] as const;
const SIZES = [
  { width: 375, height: 740 },
  { width: 1440, height: 900 },
];

async function scan(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const found = results.violations.map((v) => `${v.impact}: ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
  expect(found, label).toEqual([]);
}

for (const scheme of SCHEMES) {
  for (const size of SIZES) {
    test.describe(`${scheme}, ${size.width}px`, () => {
      test.use({ colorScheme: scheme, viewport: size });

      test('signed-in screens and the add sheet have no accessibility violations', async ({ page }) => {
        test.setTimeout(180_000); // several screens, each scanned, while other suites run
        await signInAs(page);
        for (const path of ['/app', '/app/history', '/app/plan', '/app/account']) {
          await page.goto(path);
          await expect(page.locator('h1')).toBeVisible();
          await scan(page, `${path} ${scheme} ${size.width}`);
        }
        await page.getByRole('button', { name: 'Add a transaction' }).first().click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await scan(page, `add sheet ${scheme} ${size.width}`);
        await page.keyboard.press('Escape');
      });

      test('the sign-in page and the 404 page have no violations', async ({ page }) => {
        await page.goto('/auth');
        await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
        await scan(page, `auth ${scheme}`);
        await page.goto('/nowhere');
        await expect(page.locator('h1')).toBeVisible();
        await scan(page, `404 ${scheme}`);
      });
    });
  }
}

test.describe('keyboard only', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('the first Tab reaches the skip link, which moves focus to the content', async ({ page }) => {
    await signInAs(page);
    await page.goto('/app');
    await expect(page.locator('h1')).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to the main content' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main')).toBeFocused();
  });

  test('the whole frame can be used without a mouse, and focus is always visible', async ({ page }) => {
    await signInAs(page);
    await page.goto('/app');
    await expect(page.locator('h1')).toBeVisible();
    const seen = new Set<string>();
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const style = getComputedStyle(el);
        return { name: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30), outline: style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0 };
      });
      if (info) {
        seen.add(info.name);
        expect(info.outline, `focus ring on "${info.name}"`).toBe(true);
      }
    }
    for (const name of ['Add a transaction', 'Home', 'History', 'Plan', 'Account']) expect([...seen].some((s) => s.includes(name)), name).toBe(true);
  });

  test('inside the add sheet, Tab never escapes to the page behind', async ({ page }) => {
    await signInAs(page);
    await page.goto('/app');
    await page.getByRole('button', { name: 'Add a transaction' }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible(); // the sheet is fetched the first time it opens
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Add a transaction' }).first()).toBeFocused();
  });
});
