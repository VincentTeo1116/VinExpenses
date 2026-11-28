// AC-07: Account > Appearance (Auto, Light, Dark). Auto follows the device exactly as before; Light and Dark force one inside the signed-in app,
// are remembered per device and account, combine with every colour theme, stay out of the public pages, and pass the accessibility check.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { signInAs } from './helpers';

const bg = (page: Page) => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
const LIGHT_BG = '#f5f6fa';
const DARK_BG = '#0e1116';

async function openAccount(page: Page) {
  await signInAs(page);
  await page.goto('/app/account');
  await expect(page.getByRole('radiogroup', { name: 'Appearance' })).toBeVisible();
}

test('Auto is the default and follows the device; Dark and Light override it, and the choice is remembered', async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: 'light', viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await openAccount(page);
  const group = page.getByRole('radiogroup', { name: 'Appearance' });
  await expect(group.getByRole('radio', { name: 'Auto' })).toHaveAttribute('aria-checked', 'true');
  expect(await bg(page)).toBe(LIGHT_BG);

  await group.getByRole('radio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-mode', 'dark');
  expect(await bg(page)).toBe(DARK_BG); // dark although the device is light

  await page.reload();
  await expect(page.getByRole('radiogroup', { name: 'Appearance' }).getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');
  expect(await bg(page)).toBe(DARK_BG);

  await page.getByRole('radiogroup', { name: 'Appearance' }).getByRole('radio', { name: 'Auto' }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-mode', /.+/);
  expect(await bg(page)).toBe(LIGHT_BG);
  await context.close();
});

test('Light stays light on a device set to dark, and Auto follows that dark device', async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: 'dark', viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await openAccount(page);
  const group = page.getByRole('radiogroup', { name: 'Appearance' });
  expect(await bg(page)).toBe(DARK_BG); // Auto on a dark device
  await group.getByRole('radio', { name: 'Light' }).click();
  expect(await bg(page)).toBe(LIGHT_BG);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('light');
  await context.close();
});

test('a forced dark palette also carries the chosen colour theme', async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: 'light', viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await openAccount(page);
  await page.getByRole('radio', { name: 'Pink' }).click();
  await page.getByRole('radiogroup', { name: 'Appearance' }).getByRole('radio', { name: 'Dark' }).click();
  expect(await bg(page)).toBe('#130f13'); // the dark pink surface, not the blue one
  await context.close();
});

test('the choice stays inside the app: the public pages go back to following the device', async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: 'light', viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await openAccount(page);
  await page.getByRole('radiogroup', { name: 'Appearance' }).getByRole('radio', { name: 'Dark' }).click();
  await page.goto('/privacy');
  await expect(page.locator('html')).not.toHaveAttribute('data-mode', /.+/);
  expect(await bg(page)).toBe(LIGHT_BG);
  await context.close();
});

test('arrow keys move the choice, and it can be set from the keyboard alone', async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: 'light', viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await openAccount(page);
  const group = page.getByRole('radiogroup', { name: 'Appearance' });
  await group.getByRole('radio', { name: 'Auto' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(group.getByRole('radio', { name: 'Light' })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(group.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');
  await expect(group.getByRole('radio', { name: 'Dark' })).toBeFocused();
  await context.close();
});

test('it speaks Malay and Chinese', async ({ browser }) => {
  for (const [lang, legend, dark] of [['ms', 'Paparan', 'Gelap'], ['zh', '外观', '深色']] as const) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addInitScript((l) => localStorage.setItem('ve_lang', l), lang);
    const page = await context.newPage();
    await signInAs(page);
    await page.goto('/app/account');
    await expect(page.getByRole('radiogroup', { name: legend }).getByRole('radio', { name: dark })).toBeVisible();
    await context.close();
  }
});

for (const scheme of ['light', 'dark'] as const) {
  for (const mode of ['Light', 'Dark'] as const) {
    test(`the account page passes axe with ${mode} forced on a ${scheme} device, on a phone`, async ({ browser }) => {
      const context = await browser.newContext({ colorScheme: scheme, viewport: { width: 360, height: 740 }, reducedMotion: 'reduce' });
      const page = await context.newPage();
      await openAccount(page);
      await page.getByRole('radiogroup', { name: 'Appearance' }).getByRole('radio', { name: mode }).click();
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
      await context.close();
    });
  }
}
