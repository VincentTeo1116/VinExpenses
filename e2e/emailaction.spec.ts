// PU-04: the page behind the links in our emails acts only after a button press, hides the token at once, and says what happened.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { watchProblems } from './helpers';

/** How many times THIS page asked the server to act (counted in the browser, so tests running side by side do not mix). */
function countCalls(page: Page): () => number {
  let n = 0;
  page.on('request', (request) => {
    if (request.url().includes('/functions/v1/email-action') && request.method() === 'POST') n += 1;
  });
  return () => n;
}
/** A new address with only a different # part would not reload the page, so go through a blank page first. */
async function open(page: Page, hash: string) {
  await page.goto('about:blank');
  await page.goto(`/email-action.html${hash}`);
}
const GOOD = 'good1234567890abcdef';

test('a confirm link shows a button, does nothing until it is pressed, then confirms', async ({ page }) => {
  const problems = watchProblems(page);
  const sent = countCalls(page);
  await open(page, `#a=confirm&t=${GOOD}`);
  await expect(page.getByRole('heading', { name: 'Confirm your email' })).toBeVisible();
  // the token is gone from the address bar and the history straight away
  expect(page.url()).not.toContain(GOOD);
  expect(await page.evaluate(() => location.hash)).toBe('');
  await page.waitForTimeout(400);
  expect(sent()).toBe(0); // nothing was sent yet
  await page.getByRole('button', { name: 'Confirm email address' }).click();
  await expect(page.getByRole('heading', { name: 'Email confirmed' })).toBeVisible();
  await expect(page.getByText('This address is confirmed')).toBeVisible();
  await expect(page.getByRole('button')).toHaveCount(0);
  expect(sent()).toBe(1);
  expect(problems).toEqual([]);
});

test('an unsubscribe link works the same way', async ({ page }) => {
  await page.goto(`/email-action.html#a=unsub&t=${GOOD}`);
  await expect(page.getByRole('heading', { name: 'Unsubscribe' })).toBeVisible();
  await page.getByRole('button', { name: 'Unsubscribe' }).click();
  await expect(page.getByRole('heading', { name: 'Unsubscribed' })).toBeVisible();
  await expect(page.getByText('No more ManaDuit reports')).toBeVisible();
});

test('a link that is incomplete or made up is refused without asking the server', async ({ page }) => {
  const sent = countCalls(page);
  for (const hash of ['', '#a=confirm', '#t=abcdefghij1234', '#a=delete-everything&t=abcdefghij1234', '#a=confirm&t=short', `#a=confirm&t=${'x'.repeat(701)}`, '#a=confirm&t=<script>alert(1)</script>']) {
    await open(page, hash);
    await expect(page.getByRole('heading', { name: 'Link not valid' })).toBeVisible();
    await expect(page.getByRole('button')).toHaveCount(0);
  }
  expect(sent()).toBe(0);
});

test('a link the server says is used up or expired explains it, and a server problem does too', async ({ page }) => {
  await open(page, '#a=confirm&t=expired1234567890abc');
  await page.getByRole('button', { name: 'Confirm email address' }).click();
  await expect(page.getByRole('heading', { name: 'Could not complete' })).toBeVisible();
  await expect(page.getByText('This link is invalid or has expired')).toBeVisible();
  await open(page, '#a=confirm&t=down1234567890abcdef');
  await page.getByRole('button', { name: 'Confirm email address' }).click();
  await expect(page.getByText('This service is not set up yet.')).toBeVisible();
});

test('if the connection drops the button comes back and says why', async ({ page, context }) => {
  await page.goto(`/email-action.html#a=confirm&t=${GOOD}`);
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Confirm email address' }).click();
  await expect(page.getByText('Could not reach the server')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm email address' })).toBeEnabled();
  await context.setOffline(false);
  await page.getByRole('button', { name: 'Confirm email address' }).click();
  await expect(page.getByRole('heading', { name: 'Email confirmed' })).toBeVisible();
});

test('it follows the language the person chose in the app', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ve_lang', 'ms'));
  await page.goto(`/email-action.html#a=confirm&t=${GOOD}`);
  await expect(page.getByRole('heading', { name: 'Sahkan emel anda' })).toBeVisible();
  await page.addInitScript(() => localStorage.setItem('ve_lang', 'zh'));
  await open(page, `#a=unsub&t=${GOOD}`);
  await expect(page.getByRole('heading', { name: '取消订阅' })).toBeVisible();
});

test('the token is only ever sent to the app\'s own server', async ({ page }) => {
  const hosts = new Set<string>();
  page.on('request', (request) => hosts.add(new URL(request.url()).host));
  await page.goto(`/email-action.html#a=confirm&t=${GOOD}`);
  await page.getByRole('button', { name: 'Confirm email address' }).click();
  await expect(page.getByRole('heading', { name: 'Email confirmed' })).toBeVisible();
  expect([...hosts].sort()).toEqual(['127.0.0.1:4173', '127.0.0.1:54321']);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the page passes the accessibility scan in every state (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const scan = async (label: string) => {
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`), label).toEqual([]);
    };
    await page.goto(`/email-action.html#a=confirm&t=${GOOD}`);
    await expect(page.getByRole('button', { name: 'Confirm email address' })).toBeVisible();
    await scan('ready');
    await page.getByRole('button', { name: 'Confirm email address' }).click();
    await expect(page.getByRole('heading', { name: 'Email confirmed' })).toBeVisible();
    await scan('confirmed');
    await open(page, '');
    await expect(page.getByRole('heading', { name: 'Link not valid' })).toBeVisible();
    await scan('not valid');
  });
}
