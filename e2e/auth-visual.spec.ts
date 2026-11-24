// A11Y-01 and RESP-01 for every sign-in screen: each step is scanned with axe (light and dark) and checked at all six widths.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { BACKEND, GOOD, seed, uniqueEmail } from './api';
import { HEIGHTS, WIDTHS } from './helpers';

const tabs = (page: Page) => page.getByRole('group', { name: 'Sign in or register' });
const submitIn = (page: Page) => page.locator('form').getByRole('button', { name: 'Sign in', exact: true });

/** Walks to each screen of the sign-in flow and calls `check` on it. */
async function eachScreen(page: Page, request: Parameters<typeof seed>[0], check: (name: string) => Promise<void>) {
  const mfaUser = uniqueEmail('v-mfa');
  const blockedUser = uniqueEmail('v-block');
  const plain = uniqueEmail('v-plain');
  await seed(request, { email: mfaUser, name: 'Secure', factor: true });
  await seed(request, { email: blockedUser, name: 'Held' });
  await seed(request, { email: plain, name: 'Plain' });

  await page.goto('/auth');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await check('sign-in');

  await page.getByLabel('Email').fill('bad');
  await page.getByLabel('Password', { exact: true }).fill('x');
  await submitIn(page).click();
  await expect(page.getByText('That does not look like an email address.')).toBeVisible();
  await check('sign-in with an error');

  await tabs(page).getByRole('button', { name: 'Register' }).click();
  await page.getByLabel('Password', { exact: true }).fill('abc');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Enter your name.')).toBeVisible();
  await check('register with errors and rules');

  await page.getByLabel('Name').fill('Visual Test');
  await page.getByLabel('Email').fill(uniqueEmail('v-reg'));
  await page.getByLabel('Password', { exact: true }).fill(GOOD);
  await page.getByLabel('Confirm password').fill(GOOD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await check('verify code');

  await page.getByRole('button', { name: 'Use a different email' }).click();
  await tabs(page).getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('button', { name: 'Forgot password?' }).click();
  await expect(page.getByRole('heading', { name: 'Forgot your password?' })).toBeVisible();
  await check('forgot password');
  await page.getByLabel('Email').fill(plain);
  await page.getByRole('button', { name: 'Send code' }).click();
  await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
  await check('reset password');

  await page.getByRole('button', { name: 'Back to sign in' }).click();
  await page.getByRole('button', { name: 'Contact the admin' }).click();
  await expect(page.getByRole('dialog', { name: 'Contact the admin' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('dialog').getByText('Choose what this is about.')).toBeVisible();
  await check('contact form with errors');
  await page.keyboard.press('Escape');

  await page.getByLabel('Email').fill(blockedUser);
  for (let i = 0; i < 5; i += 1) {
    await page.getByLabel('Password', { exact: true }).fill('Wrong!Passw0rd1');
    await submitIn(page).click();
    await page.waitForTimeout(120);
  }
  await expect(page.getByRole('heading', { name: 'Sign-in is paused' })).toBeVisible();
  await check('sign-in paused');

  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto('/auth');
  await page.getByLabel('Email').fill(mfaUser);
  await page.getByLabel('Password', { exact: true }).fill(GOOD);
  await submitIn(page).click();
  await expect(page.getByRole('heading', { name: 'Two-step verification' })).toBeVisible();
  await check('authenticator code');
  await page.getByRole('button', { name: 'Lost your phone? Use a recovery code' }).click();
  await expect(page.getByLabel('Recovery code')).toBeVisible();
  await check('recovery code');
}

for (const scheme of ['light', 'dark'] as const) {
  for (const width of [375, 1440]) {
    test(`every sign-in screen has no accessibility violations (${scheme}, ${width}px)`, async ({ browser, request }) => {
      const context = await browser.newContext({ colorScheme: scheme, viewport: { width, height: HEIGHTS[width] ?? 800 }, reducedMotion: 'reduce' });
      const page = await context.newPage();
      await eachScreen(page, request, async (name) => {
        const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
        expect(results.violations.map((v) => `${v.impact}: ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`), `${name} (${scheme} ${width})`).toEqual([]);
        if (scheme === 'light') await page.screenshot({ path: `screenshots/auth-${width}-${name.replace(/\W+/g, '-')}.png` });
      });
      await context.close();
    });
  }
}

for (const width of WIDTHS) {
  test(`no sign-in screen scrolls sideways or clips a control at ${width}px`, async ({ browser, request }) => {
    const context = await browser.newContext({ viewport: { width, height: HEIGHTS[width] ?? 800 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await eachScreen(page, request, async (name) => {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${name} at ${width}px`).toBeLessThanOrEqual(0);
      const small = await page.evaluate(() =>
        [...document.querySelectorAll('button, a, input:not([type="hidden"]), select, textarea')]
          .filter((el) => (el as HTMLElement).offsetParent !== null && !(el.closest('[inert]')))
          .map((el) => ({ name: (el.getAttribute('aria-label') || el.textContent || (el as HTMLInputElement).placeholder || el.tagName).trim().slice(0, 30), h: el.getBoundingClientRect().height, type: (el as HTMLInputElement).type }))
          // inline text links inside a sentence are exempt from the 44px rule (WCAG 2.5.8 "inline" exception)
          .filter((item) => item.h > 0 && item.h < 44 && item.type !== 'checkbox'),
      );
      expect(small.filter((item) => !/Terms of Use|Privacy Policy|Contact the admin|Skip/.test(item.name)), `targets under 44px on ${name} at ${width}px`).toEqual([]);
    });
    await context.close();
  });
}

test('the mfa setup sheet, setup page and account screen pass accessibility checks in both themes', async ({ browser, request }) => {
  for (const scheme of ['light', 'dark'] as const) {
    const context = await browser.newContext({ colorScheme: scheme, viewport: { width: 390, height: 800 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const email = uniqueEmail('v-acct');
    await seed(request, { email, name: 'Account Visual' });
    await page.goto('/auth');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(GOOD);
    await submitIn(page).click();
    await expect(page.getByRole('heading', { level: 1, name: /^Hello,/ })).toBeVisible();
    await page.getByRole('link', { name: 'Account' }).first().click();
    await expect(page.getByRole('dialog', { name: 'Account', exact: true })).toBeVisible();
    const scan = async (label: string) => {
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
      expect(results.violations.map((v) => `${v.impact}: ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`), `${label} ${scheme}`).toEqual([]);
    };
    await scan('account');
    await page.screenshot({ path: `screenshots/account-${scheme}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Turn on' }).click();
    await expect(page.getByRole('img', { name: 'QR code to scan with your authenticator app' })).toBeVisible();
    await scan('mfa setup');
    await page.screenshot({ path: `screenshots/mfa-setup-${scheme}.png` });
    await page.getByLabel('Then enter the 6 digits it shows').fill('654321');
    await page.getByRole('dialog', { name: 'Set up two-step verification' }).getByRole('button', { name: 'Turn on' }).click();
    await expect(page.getByRole('dialog', { name: 'Save your recovery codes' })).toBeVisible();
    await scan('recovery codes');
    await page.screenshot({ path: `screenshots/recovery-codes-${scheme}.png` });
    await context.close();

    // the setup page for a first-time Google person
    const context2 = await browser.newContext({ colorScheme: scheme, viewport: { width: 390, height: 800 }, reducedMotion: 'reduce' });
    const page2 = await context2.newPage();
    const google = uniqueEmail('v-google');
    await seed(request, { email: google, name: '', google: true });
    const reply = await (await request.post(`${BACKEND}/functions/v1/auth-gate`, { headers: { origin: 'http://127.0.0.1:4173' }, data: { action: 'signin', email: google, password: GOOD, device: 'd'.padEnd(20, '2') } })).json();
    await page2.addInitScript((session) => localStorage.setItem('sb-127-auth-token', JSON.stringify({ ...session, expires_at: Math.floor(Date.now() / 1000) + 3000, token_type: 'bearer', expires_in: 3000 })), reply.session);
    await page2.goto('/app');
    await expect(page2.getByRole('heading', { name: 'Finish setting up' })).toBeVisible();
    const results = await new AxeBuilder({ page: page2 }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(results.violations.map((v) => `${v.impact}: ${v.id}`), `setup ${scheme}`).toEqual([]);
    await page2.screenshot({ path: `screenshots/setup-${scheme}.png` });
    await context2.close();
  }
});
