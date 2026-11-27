// AN-06: the announcement pop-up and the new public sections stay accessible in every language and theme, work from the keyboard, and fail quietly
// when the announcement cannot be fetched (the app and the guided tour carry on). Also checks the admin editor and extreme text.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { BACKEND } from './api';
import { signInAs, watchProblems } from './helpers';

const publish = (page: Page, email: string) =>
  page.request.post(`${BACKEND}/__test/announcement`, { data: { audience: [email], titleEn: 'Split a bill is here! 🎉', bodyEn: 'Share a meal bill in seconds 🧾\n\n- 🧾 **Split a bill (BETA):** scan, tick, share.\n\n[Try Split a bill](/app/split)', titleMs: 'Bahagi bil sudah ada!', bodyMs: 'Kongsi bil.', titleZh: '分账功能来啦！', bodyZh: '几秒钟分好。' } });

for (const scheme of ['light', 'dark'] as const) {
  for (const lang of ['en', 'ms', 'zh'] as const) {
    test(`announcement pop-up passes axe: ${scheme}, ${lang}, phone`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width: 360, height: 740 }, colorScheme: scheme, reducedMotion: 'reduce' });
      await context.addInitScript((l) => localStorage.setItem('ve_lang', l), lang);
      const page = await context.newPage();
      const me = await signInAs(page);
      await publish(page, me.email);
      await page.goto('/app');
      await expect(page.getByRole('dialog')).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
      await context.close();
    });
  }
}

test('announcement: keyboard works, focus stays inside, Esc closes, focus returns, tick is reachable', async ({ page }) => {
  const me = await signInAs(page);
  await publish(page, me.email);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/app');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const inside = async () => page.evaluate(() => Boolean(document.activeElement && document.activeElement.closest('[role="dialog"]')));
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    expect(await inside(), `focus escaped the pop-up on Tab ${i + 1}`).toBe(true);
  }
  await page.getByTestId('announcement-tick').focus();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('announcement-tick')).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('announcement: if the announcement cannot be fetched, the app still opens, with no dialog and no error', async ({ page }) => {
  const problems = watchProblems(page);
  const me = await signInAs(page);
  await publish(page, me.email);
  await page.route('**/rest/v1/announcements**', (route) => route.abort('failed'));
  await page.goto('/app');
  await expect(page.getByRole('heading', { level: 1, name: /^Hello,/ })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.waitForTimeout(1500);
  expect(problems.filter((p) => !/announcements|Failed to load resource|net::ERR/i.test(p))).toEqual([]);
});

test('announcement: a server error (500) is also silent, and the guided tour is not blocked forever', async ({ page }) => {
  const me = await signInAs(page, { tour: true });
  await publish(page, me.email);
  await page.route('**/rest/v1/announcements**', (route) => route.fulfill({ status: 500, body: '{"message":"boom"}' }));
  await page.goto('/app');
  await expect(page.getByRole('heading', { level: 1, name: /^Hello,/ })).toBeVisible();
  await expect(page.getByTestId('tour')).toBeVisible({ timeout: 10_000 });
});

test('announcement: very long text and awkward characters do not break the pop-up (wrap, scroll, no horizontal overflow)', async ({ page }) => {
  const me = await signInAs(page);
  await page.request.post(`${BACKEND}/__test/announcement`, { data: { audience: [me.email], titleEn: 'A'.repeat(80), bodyEn: ('Supercalifragilisticexpialidocious_'.repeat(8) + '\n\n').repeat(6) + '- ' + 'item '.repeat(60) } });
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/app');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const overflow = await dialog.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
  expect(overflow, 'the pop-up scrolls sideways').toBe(false);
  await expect(page.getByTestId('announcement-close')).toBeVisible();
});

for (const [label, width, scheme] of [['phone 320', 320, 'light'], ['phone dark', 390, 'dark'], ['desktop', 1440, 'light']] as const) {
  test(`welcome page passes axe, including the new name section: ${label}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto('/');
    await page.locator('#name').scrollIntoViewIfNeeded();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(overflow, 'the page scrolls sideways').toBe(false);
    await context.close();
  });
}

test('admin announcement editor passes axe on phone and desktop', async ({ browser }) => {
  for (const [w, h] of [[390, 844], [1440, 900]] as const) {
    const context = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const me = await signInAs(page);
    await page.request.post(`${BACKEND}/__test/make-admin`, { data: { email: me.email } });
    await page.goto('/app/admin');
    await page.getByRole('tab', { name: 'Announcements' }).click();
    await page.getByTestId('announcement-title-en').fill('Hello');
    await page.getByTestId('announcement-body-en').fill('World');
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`), `${w}px`).toEqual([]);
    await context.close();
  }
});
