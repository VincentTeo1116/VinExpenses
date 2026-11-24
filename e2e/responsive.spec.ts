// RESP-01: the signed-in frame works from 320 px to 1920 px, with no horizontal scroll and no clipped controls.
import { expect, test } from '@playwright/test';
import { HEIGHTS, signInAs, WIDTHS } from './helpers';

for (const width of WIDTHS) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: HEIGHTS[width] ?? 800 } });

    test('the frame fits, the right navigation shows, and the + button is a full-size target', async ({ page }) => {
      await signInAs(page);
      await page.goto('/app');
      await expect(page.getByRole('heading', { level: 1, name: /^Hello,/ })).toBeVisible();

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, 'horizontal scroll').toBeLessThanOrEqual(0);

      const desktop = width >= 1024;
      const sidebar = page.locator('aside');
      const tabbar = page.locator('nav').last();
      if (desktop) {
        await expect(sidebar).toBeVisible();
        await expect(page.getByRole('button', { name: 'Add a transaction' }).first()).toBeVisible();
      } else {
        await expect(sidebar).toBeHidden();
        await expect(tabbar).toBeVisible();
        const fab = tabbar.getByRole('button', { name: 'Add a transaction' });
        const box = await fab.boundingBox();
        expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
        // the tab bar must stay inside the screen
        const bar = await tabbar.boundingBox();
        expect((bar?.x ?? -1)).toBeGreaterThanOrEqual(0);
        expect((bar?.x ?? 0) + (bar?.width ?? 0)).toBeLessThanOrEqual(width);
      }

      // every visible tab or link is at least 44px tall
      const small = await page.evaluate(() =>
        [...document.querySelectorAll('nav a, nav button, main button, main select')]
          .filter((el) => (el as HTMLElement).offsetParent !== null)
          .map((el) => ({ name: (el.textContent || el.getAttribute('aria-label') || '').trim(), h: el.getBoundingClientRect().height }))
          .filter((item) => item.h > 0 && item.h < 44),
      );
      expect(small, 'targets under 44px').toEqual([]);

      await page.screenshot({ path: `screenshots/shell-${width}.png` });
    });

    test('the add sheet opens inside the screen and can be closed with the keyboard', async ({ page }) => {
      await signInAs(page);
      await page.goto('/app');
      await page.getByRole('button', { name: 'Add a transaction' }).first().click();
      const dialog = page.getByRole('dialog', { name: 'Add a transaction' });
      await expect(dialog).toBeVisible();
      await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined)))); // measure after the sheet has settled
      const box = await dialog.boundingBox();
      expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
      expect((box?.y ?? -1)).toBeGreaterThanOrEqual(0);
      expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(HEIGHTS[width] ?? 800);
      await page.screenshot({ path: `screenshots/sheet-${width}.png` });
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
    });

    test('the not-found page fits too', async ({ page }) => {
      const response = await page.goto('/this-page-does-not-exist');
      expect(response?.status()).toBe(404);
      await expect(page.getByRole('heading', { name: 'We can’t find that page' })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      await page.screenshot({ path: `screenshots/404-${width}.png` });
    });
  });
}

test.describe('sticky sidebar', () => {
  test.use({ viewport: { width: 1440, height: 800 } });
  test('stays the height of the window and pinned to the top while a long page scrolls', async ({ page }) => {
    await signInAs(page);
    await page.goto('/app');
    await expect(page.getByRole('heading', { level: 1, name: /^Hello,/ })).toBeVisible(); // wait until the app has drawn
    await page.evaluate(() => {
      // real content makes the page long (the page policy would block an inline height)
      for (let i = 0; i < 200; i += 1) {
        const line = document.createElement('p');
        line.textContent = `Line ${i} of a very long page`;
        line.className = 'filler';
        document.getElementById('main')?.appendChild(line);
      }
    });
    await page.evaluate(() => window.scrollTo(0, 2500));
    await page.waitForFunction(() => window.scrollY > 1000);
    const box = await page.locator('aside').boundingBox();
    expect(Math.round(box?.y ?? -1)).toBe(0);
    expect(Math.round(box?.height ?? 0)).toBe(800);
  });
});
