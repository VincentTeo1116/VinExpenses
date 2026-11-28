// AU-17: the language choice is a globe chip inside the sign-in card. It changes the page, is a real labelled list for keyboards and screen readers,
// stays inside the card, and passes the accessibility check in both themes down to a 320 px phone.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('the chip sits inside the card, shows the language, and switching changes the page', async ({ page }) => {
  await page.goto('/auth');
  const card = page.locator('main > div').first();
  const select = card.getByLabel('Language');
  await expect(select).toHaveCount(1);
  await expect(card.locator('span[aria-hidden]', { hasText: 'EN' })).toBeVisible();
  await expect(page.getByLabel('Language')).toHaveCount(1); // no second language control left on the page
  await select.selectOption('ms');
  await expect(card.locator('span[aria-hidden]', { hasText: 'BM' })).toBeVisible();
  await expect(page.getByLabel('Bahasa')).toHaveValue('ms');
  await page.getByLabel('Bahasa').selectOption('zh');
  await expect(card.locator('span[aria-hidden]', { hasText: '中文' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', /zh/);
});

test('the chip can be reached and changed from the keyboard', async ({ page }) => {
  await page.goto('/auth');
  await page.getByLabel('Language').focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByLabel(/Language|Bahasa/)).toHaveValue('ms');
});

for (const scheme of ['light', 'dark'] as const) {
  for (const width of [320, 390, 1280]) {
    test(`the sign-in card with the chip passes axe and fits: ${scheme}, ${width}px`, async ({ browser }) => {
      const context = await browser.newContext({ colorScheme: scheme, viewport: { width, height: 800 }, reducedMotion: 'reduce' });
      const page = await context.newPage();
      await page.goto('/auth');
      await expect(page.getByLabel('Language')).toHaveCount(1);
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
      const chip = await page.locator('span[aria-hidden]', { hasText: 'EN' }).boundingBox();
      const card = await page.locator('main > div').first().boundingBox();
      expect(chip && card && chip.x >= card.x && chip.x + chip.width <= card.x + card.width).toBe(true);
      await context.close();
    });
  }
}
