// AN-01 … AN-05: the "what's new" announcement: the administrator writes it with a preview and a publish confirmation, people see it on top of everything
// once per session until they tick "don't show again", new accounts see it before the guided tour, and Malay or Chinese fall back to English.
import { expect, test, type Page } from '@playwright/test';
import { BACKEND } from './api';
import { dbRows, signInAs } from './helpers';

const publish = (page: Page, email: string, extra: Record<string, unknown> = {}) =>
  page.request.post(`${BACKEND}/__test/announcement`, {
    data: { audience: [email], titleEn: 'Split a bill', bodyEn: 'Scan a receipt and **tick** what you had.\n\n- Shares SST\n- Shares service charge', ...extra },
  });
const makeAdmin = (page: Page, email: string) => page.request.post(`${BACKEND}/__test/make-admin`, { data: { email } });
const dialog = (page: Page) => page.getByRole('dialog');

test('a person sees the announcement above everything, and a refresh in the same session does not bring it back', async ({ page }) => {
  const me = await signInAs(page);
  await publish(page, me.email);
  await page.goto('/app');
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByText('Split a bill')).toBeVisible();
  await expect(dialog(page).locator('strong', { hasText: 'tick' })).toBeVisible();
  await expect(dialog(page).locator('li')).toHaveCount(2);
  const z = await dialog(page).evaluate((el) => {
    let node: HTMLElement | null = el as HTMLElement;
    let top = 0;
    while (node) {
      const value = Number(getComputedStyle(node).zIndex);
      if (Number.isFinite(value)) top = Math.max(top, value);
      node = node.parentElement;
    }
    return top;
  });
  expect(z).toBeGreaterThanOrEqual(5000);
  await page.getByTestId('announcement-close').click();
  await expect(dialog(page)).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: /^Hello,/ })).toBeVisible();
  await expect(dialog(page)).toHaveCount(0);
});

test('without ticking it returns in a new session; ticking stops it for good and is saved to the account', async ({ page, browser }) => {
  const me = await signInAs(page);
  await publish(page, me.email);
  await page.goto('/app');
  await page.getByTestId('announcement-close').click(); // closed without the tick
  const second = await browser.newContext({ storageState: await page.context().storageState() });
  const again = await second.newPage();
  await again.goto('/app');
  await expect(again.getByRole('dialog')).toBeVisible();
  await again.getByTestId('announcement-tick').check();
  await again.getByTestId('announcement-close').click();
  await expect.poll(async () => (await dbRows(page, me.email, 'announcement_reads')).length).toBe(1);
  await second.close();
  // a different device: nothing stored there, so only the saved account copy can stop it
  const third = await browser.newContext();
  await third.addInitScript(
    ({ value }) => {
      localStorage.setItem('sb-127-auth-token', value);
      localStorage.setItem('et_tour_seen', '1');
    },
    { value: me.session },
  );
  const fresh = await third.newPage();
  await fresh.goto('/app');
  await expect(fresh.getByRole('heading', { level: 1, name: /^Hello,/ })).toBeVisible();
  await expect(fresh.getByRole('dialog')).toHaveCount(0);
  await third.close();
});

test('a new account sees the announcement first and the guided tour after it is closed', async ({ page }) => {
  const me = await signInAs(page, { tour: true });
  await publish(page, me.email);
  await page.goto('/app');
  await expect(dialog(page)).toBeVisible();
  await page.waitForTimeout(2500);
  await expect(page.getByTestId('tour')).toHaveCount(0);
  await page.getByTestId('announcement-close').click();
  await expect(page.getByTestId('tour')).toBeVisible({ timeout: 10_000 });
});

test('English text with markup is shown as plain text, never turned into elements', async ({ page }) => {
  const me = await signInAs(page);
  await publish(page, me.email, { bodyEn: 'Hello <b>x</b> <img src=x onerror=alert(1)>' });
  await page.goto('/app');
  await expect(dialog(page).getByText('Hello <b>x</b>')).toBeVisible();
  await expect(dialog(page).locator('img')).toHaveCount(0);
});

test('the administrator writes, previews, is warned about missing languages, confirms and publishes; the person then sees it', async ({ page, browser }) => {
  const me = await signInAs(page);
  await makeAdmin(page, me.email);
  await page.goto('/app/admin');
  await page.getByRole('tab', { name: 'Announcements' }).click();
  const publishButton = page.getByTestId('announcement-publish');
  await expect(publishButton).toBeDisabled();
  await page.getByTestId('announcement-title-en').fill('Dark mode is better');
  await page.getByTestId('announcement-body-en').fill('We made **dark mode** softer.');
  await expect(publishButton).toBeEnabled();
  await expect(page.getByTestId('announcement-preview').getByText('Dark mode is better')).toBeVisible();
  await expect(page.getByTestId('announcement-preview').locator('strong')).toHaveText('dark mode');
  const warnings = page.getByTestId('announcement-warnings');
  await expect(warnings).toContainText('Malay is empty');
  await expect(warnings).toContainText('Chinese is empty');
  await page.getByTestId('announcement-preview-ms').click();
  await expect(page.getByText('There is no Malay version')).toBeVisible();
  await publishButton.click();
  await expect(page.getByText('These will show English: Malay, Chinese.')).toBeVisible();
  await page.getByTestId('announcement-publish-yes').click();
  await expect(page.getByTestId('announcement-status')).toContainText('Dark mode is better');
  const other = await browser.newContext({ storageState: await page.context().storageState() });
  const view = await other.newPage();
  await view.goto('/app');
  await expect(view.getByRole('dialog').getByText('Dark mode is better')).toBeVisible();
  await other.close();
  await page.getByTestId('announcement-retire').click();
  await page.getByTestId('announcement-retire-yes').click();
  await expect(page.getByText('No announcement is live.')).toBeVisible();
});

test('an ordinary person cannot write an announcement, even by calling the server directly', async ({ page }) => {
  const me = await signInAs(page);
  const token = (JSON.parse(me.session) as { access_token: string }).access_token;
  const res = await page.request.post(`${BACKEND}/functions/v1/admin`, {
    headers: { authorization: `Bearer ${token}`, origin: 'http://127.0.0.1:4173' },
    data: { action: 'announcement_publish', titleEn: 'x', bodyEn: 'y' },
  });
  expect(res.status()).toBe(403);
});
