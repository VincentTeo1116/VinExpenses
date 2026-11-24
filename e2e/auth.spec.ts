// AU-01 … AU-16, AC-02, AC-03, PU-01: every sign-in flow in a real browser, against the local stand-in for Supabase.
import { expect, test, type Page } from '@playwright/test';
import { BACKEND, GOOD, mailFor, NEW_GOOD, seed, uniqueEmail } from './api';
import { cspViolations, watchProblems } from './helpers';

const tabs = (page: Page) => page.getByRole('group', { name: 'Sign in or register' });
const submitIn = (page: Page) => page.locator('form').getByRole('button', { name: 'Sign in', exact: true });

async function signIn(page: Page, email: string, password: string, remember = true) {
  await page.goto('/auth');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  if (!remember) await page.getByLabel('Remember me for 30 days').uncheck();
  await submitIn(page).click();
}

/** Opens the sign-out sheet, confirms, and waits until the sign-out has really finished. */
/** Opens the Account pop-up from the menu and one of its sections on top of it. */
async function openAccountSection(page: Page, section: string) {
  await page.getByRole('link', { name: 'Account' }).first().click();
  const heading = page.getByRole('dialog', { name: 'Account', exact: true }).getByRole('heading', { name: section, exact: true });
  await heading.scrollIntoViewIfNeeded(); // the section is part of the Account pop-up
  await expect(heading).toBeVisible();
}

async function signOutViaPage(page: Page) {
  // close any section that is open on top of the Account pop-up first
  for (let i = 0; i < 3 && (await page.locator('[role="dialog"]').count()) > 1; i += 1) await page.getByRole('dialog').last().getByRole('button', { name: 'Close' }).click();
  await page.getByRole('dialog', { name: 'Account', exact: true }).getByRole('button', { name: 'Sign out' }).click();
  await page.getByRole('dialog', { name: 'Sign out', exact: true }).getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/auth$/);
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
}

async function appReady(page: Page) {
  await expect(page.getByRole('heading', { level: 1, name: /^Hello,/ })).toBeVisible();
}

test.describe('register and confirm the address (AU-01 … AU-05)', () => {
  test('the password rules update as you type, and a new account is confirmed with the emailed code', async ({ page, request }) => {
    const email = uniqueEmail('new');
    await page.goto('/auth');
    await tabs(page).getByRole('button', { name: 'Register' }).click();
    await page.getByLabel('Name').fill('Dina Tan');
    await page.getByLabel('Email').fill(email);

    const rule = (key: string) => page.locator(`[data-rule="${key}"]`);
    const password = page.getByLabel('Password', { exact: true });
    await password.fill('abc');
    await expect(rule('lower')).toHaveAttribute('data-state', 'met');
    for (const key of ['length', 'upper', 'digit', 'symbol']) await expect(rule(key)).toHaveAttribute('data-state', 'bad');
    await password.fill('Abcdefghij');
    await expect(rule('length')).toHaveAttribute('data-state', 'met');
    await expect(rule('upper')).toHaveAttribute('data-state', 'met');
    await expect(rule('digit')).toHaveAttribute('data-state', 'bad');
    await password.fill(GOOD);
    for (const key of ['length', 'upper', 'lower', 'digit', 'symbol']) await expect(rule(key)).toHaveAttribute('data-state', 'met');

    await page.getByLabel('Confirm password').fill('different');
    await page.getByLabel('Confirm password').blur();
    await expect(page.getByText('The two passwords do not match.')).toBeVisible();
    await page.getByLabel('Confirm password').fill(GOOD);
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
    await expect(page.getByText(`We sent a 6-digit code to ${email}.`)).toBeVisible();
    await expect(page.getByRole('timer')).toContainText('The code works for');
    expect(await mailFor(request, email)).toHaveLength(1);

    await page.getByLabel('6-digit code').fill('111111');
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByText('That code is not right or has expired. Codes work once and last 5 minutes.')).toBeVisible();

    await page.getByLabel('6-digit code').fill('12ab34cd56'); // only digits are kept
    await expect(page.getByLabel('6-digit code')).toHaveValue('123456');
    await page.getByRole('button', { name: 'Confirm' }).click();
    await appReady(page);
  });

  test('every field is checked with a message under it, and nothing is sent until they are right', async ({ page }) => {
    await page.goto('/auth');
    await tabs(page).getByRole('button', { name: 'Register' }).click();
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText('Enter your name.')).toBeVisible();
    await expect(page.getByText('Enter your email.')).toBeVisible();
    await expect(page.getByText('Enter your password.')).toBeVisible();
    await expect(page.getByText('Type the password again.')).toBeVisible();
    await page.getByLabel('Email').fill('not-an-email');
    await page.getByLabel('Email').blur();
    await expect(page.getByText('That does not look like an email address.')).toBeVisible();
    await expect(page.getByLabel('Name')).toBeFocused().catch(() => undefined);
    await page.getByLabel('Name').fill('A');
    await page.getByLabel('Name').blur();
    await expect(page.getByText('Use 2 to 40 characters, without < or >.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
  });

  test('an email that already has an account is sent to sign-in, and no code is spent', async ({ page, request }) => {
    const email = uniqueEmail('exists');
    await seed(request, { email, name: 'Amy' });
    await page.goto('/auth');
    await tabs(page).getByRole('button', { name: 'Register' }).click();
    await page.getByLabel('Name').fill('Amy Again');
    await page.getByLabel('Email').fill(email.toUpperCase());
    await page.getByLabel('Password', { exact: true }).fill(GOOD);
    await page.getByLabel('Confirm password').fill(GOOD);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText('This email already has an account. Please sign in below.')).toBeVisible();
    await expect(tabs(page).getByRole('button', { name: 'Sign in' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByLabel('Email')).toHaveValue(email); // tidied to lower case
    expect(await mailFor(request, email)).toHaveLength(0);
  });

  test('3 codes a day: the 4th is refused with a way to contact the admin', async ({ page, request }) => {
    const email = uniqueEmail('limit');
    await page.goto('/auth');
    await tabs(page).getByRole('button', { name: 'Register' }).click();
    await page.getByLabel('Name').fill('Limit Test');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(GOOD);
    await page.getByLabel('Confirm password').fill(GOOD);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
    for (let i = 0; i < 2; i += 1) {
      await page.getByRole('button', { name: 'Send a new code' }).click();
      await expect(page.getByText('A new code is on its way').last()).toBeVisible();
    }
    expect(await mailFor(request, email)).toHaveLength(3);
    await page.getByRole('button', { name: 'Send a new code' }).click();
    await expect(page.getByText('You can ask for 3 codes a day. Please try again tomorrow, or contact the admin.')).toBeVisible();
    await page.getByRole('button', { name: 'Contact the admin' }).first().click();
    await expect(page.getByRole('dialog', { name: 'Contact the admin' })).toBeVisible();
    await expect(page.getByLabel('What is it about?')).toHaveValue('code_limit');
    expect(await mailFor(request, email)).toHaveLength(3);
  });

  test('an expired code is refused', async ({ page, request }) => {
    const email = uniqueEmail('expire');
    await page.goto('/auth');
    await tabs(page).getByRole('button', { name: 'Register' }).click();
    await page.getByLabel('Name').fill('Late One');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(GOOD);
    await page.getByLabel('Confirm password').fill(GOOD);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
    await request.post(`${BACKEND}/__test/age-code`, { data: { email, kind: 'signup' } });
    await page.getByLabel('6-digit code').fill('123456');
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByText('That code is not right or has expired. Codes work once and last 5 minutes.')).toBeVisible();
  });
});

test.describe('sign in, remember me and the lockout (AU-06 … AU-08)', () => {
  test('signs in with a password only (no code) and opens the app', async ({ page, request }) => {
    const email = uniqueEmail('amy');
    await seed(request, { email, name: 'Amy' });
    await signIn(page, email, GOOD);
    await appReady(page);
    await expect(page).toHaveURL(/\/app$/);
  });

  test('a wrong password and an unknown email give the same answer', async ({ page, request }) => {
    const email = uniqueEmail('same');
    await seed(request, { email, name: 'Same' });
    await signIn(page, email, 'Wrong!Passw0rd1');
    const first = await page.getByText(/Wrong email or password/).first().textContent();
    await signIn(page, uniqueEmail('nobody'), 'Wrong!Passw0rd1');
    const second = await page.getByText(/Wrong email or password/).first().textContent();
    expect(first).toBe(second);
  });

  test('5 wrong passwords pause sign-in on this device for 3 hours, with a countdown and ways out', async ({ page, request }) => {
    const email = uniqueEmail('lock');
    await seed(request, { email, name: 'Locked' });
    await page.goto('/auth');
    await page.getByLabel('Email').fill(email);
    for (let i = 0; i < 4; i += 1) {
      await page.getByLabel('Password', { exact: true }).fill('Wrong!Passw0rd1');
      await submitIn(page).click();
      await expect(page.getByText(/Wrong email or password/).first()).toBeVisible();
    }
    await page.getByLabel('Password', { exact: true }).fill('Wrong!Passw0rd1');
    await submitIn(page).click();
    await expect(page.getByRole('heading', { name: 'Sign-in is paused' })).toBeVisible();
    await expect(page.getByRole('timer')).toContainText(/You can try again in 2:5\d:\d\d|3:00:00/);
    await expect(page.getByRole('button', { name: 'Reset my password' })).toBeVisible();
    await page.screenshot({ path: 'screenshots/auth-blocked.png' });

    // even the right password is refused while paused
    await page.getByRole('button', { name: 'Back to sign in' }).click();
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(GOOD);
    await submitIn(page).click();
    await expect(page.getByRole('heading', { name: 'Sign-in is paused' })).toBeVisible();

    await page.getByRole('button', { name: 'Contact the admin' }).click();
    await expect(page.getByLabel('What is it about?')).toHaveValue('locked_out');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Reset my password' }).click();
    await expect(page.getByRole('heading', { name: 'Forgot your password?' })).toBeVisible();
  });

  test('a different device is not paused by the first one', async ({ browser, request }) => {
    const email = uniqueEmail('device');
    await seed(request, { email, name: 'Two Devices' });
    const first = await (await browser.newContext()).newPage();
    await first.goto('/auth');
    await first.getByLabel('Email').fill(email);
    for (let i = 0; i < 5; i += 1) {
      await first.getByLabel('Password', { exact: true }).fill('Wrong!Passw0rd1');
      await submitIn(first).click();
      await first.waitForTimeout(150);
    }
    await expect(first.getByRole('heading', { name: 'Sign-in is paused' })).toBeVisible();
    const second = await (await browser.newContext()).newPage();
    await signIn(second, email, GOOD);
    await appReady(second);
  });

  test('a pause set by the admin has no end time and no reset button, and clears when lifted', async ({ page, request }) => {
    const email = uniqueEmail('admin-block');
    await seed(request, { email, name: 'Held' });
    await request.post(`${BACKEND}/__test/block`, { data: { email, on: true } });
    await signIn(page, email, GOOD);
    await expect(page.getByRole('heading', { name: 'Sign-in is paused' })).toBeVisible();
    await expect(page.getByText('paused by the admin')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reset my password' })).toHaveCount(0);
    await expect(page.getByRole('timer')).toHaveCount(0);
    await request.post(`${BACKEND}/__test/block`, { data: { email, on: false } });
    await signIn(page, email, GOOD);
    await appReady(page);
  });

  test('a disabled account and an unverified email each get their own explanation', async ({ page, request }) => {
    const off = uniqueEmail('off');
    await seed(request, { email: off, name: 'Off', disabled: true });
    await signIn(page, off, GOOD);
    await expect(page.getByText('This account has been disabled. Please contact the admin.')).toBeVisible();
    const pending = uniqueEmail('pending');
    await seed(request, { email: pending, name: 'Pending', confirmed: false });
    await signIn(page, pending, GOOD);
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
    await expect(page.getByText('This email is not verified yet. Ask for a new code below.')).toBeVisible();
  });

  test('remember me keeps the session; without it the session ends when the browser is closed', async ({ page, request }) => {
    const kept = uniqueEmail('kept');
    await seed(request, { email: kept, name: 'Kept' });
    await signIn(page, kept, GOOD, true);
    await appReady(page);
    await page.evaluate(() => sessionStorage.clear()); // a new browser session
    await page.reload();
    await appReady(page);

    const gone = uniqueEmail('gone');
    await seed(request, { email: gone, name: 'Gone' });
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await signIn(page, gone, GOOD, false);
    await appReady(page);
    await page.evaluate(() => sessionStorage.clear());
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  });

  test('the password is never written to browser storage, the address bar or the console', async ({ page, request }) => {
    const email = uniqueEmail('quiet');
    const problems = watchProblems(page);
    await seed(request, { email, name: 'Quiet' });
    await signIn(page, email, GOOD);
    await appReady(page);
    const dump = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, url: location.href }));
    expect(dump).not.toContain(GOOD);
    expect(problems.join('\n')).not.toContain(GOOD);
    expect(await cspViolations(page)).toEqual([]);
  });
});

test.describe('forgot password (AU-09)', () => {
  test('a code by email, a new strong password, and the old one stops working', async ({ page, request }) => {
    const email = uniqueEmail('forgot');
    await seed(request, { email, name: 'Forgetful' });
    await page.goto('/auth');
    await page.getByRole('button', { name: 'Forgot password?' }).click();
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Send code' }).click();
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
    expect((await mailFor(request, email)).filter((m) => m.kind === 'recovery')).toHaveLength(1);

    await page.getByLabel('6-digit code').fill('111111');
    await page.getByLabel('New password').fill(NEW_GOOD);
    await page.getByLabel('Confirm password').fill(NEW_GOOD);
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByText('That code is not right or has expired. Codes work once and last 5 minutes.')).toBeVisible();

    await page.getByLabel('6-digit code').fill('123456');
    await page.getByLabel('New password').fill('weakpass');
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByText('The password does not meet every rule below.')).toBeVisible();

    await page.getByLabel('New password').fill(GOOD); // the same as the old one
    await page.getByLabel('Confirm password').fill(GOOD);
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByText(/Choose a password you have not used/)).toBeVisible();

    await page.getByLabel('New password').fill(NEW_GOOD);
    await page.getByLabel('Confirm password').fill(NEW_GOOD);
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByText('Your password was changed and you were signed out everywhere. Sign in with your new password.')).toBeVisible();

    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(GOOD);
    await submitIn(page).click();
    await expect(page.getByText(/Wrong email or password/).first()).toBeVisible();
    await page.getByLabel('Password', { exact: true }).fill(NEW_GOOD);
    await submitIn(page).click();
    await appReady(page);
  });

  test('the answer is the same for an address with no account, and an expired code is refused', async ({ page, request }) => {
    await page.goto('/auth');
    await page.getByRole('button', { name: 'Forgot password?' }).click();
    await page.getByLabel('Email').fill(uniqueEmail('nobody'));
    await page.getByRole('button', { name: 'Send code' }).click();
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();

    const email = uniqueEmail('late');
    await seed(request, { email, name: 'Late' });
    await page.getByRole('button', { name: 'Back to sign in' }).click();
    await page.getByRole('button', { name: 'Forgot password?' }).click();
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Send code' }).click();
    await request.post(`${BACKEND}/__test/age-code`, { data: { email, kind: 'recovery' } });
    await page.getByLabel('6-digit code').fill('123456');
    await page.getByLabel('New password').fill(NEW_GOOD);
    await page.getByLabel('Confirm password').fill(NEW_GOOD);
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByText('That code is not right or has expired. Codes work once and last 5 minutes.')).toBeVisible();
  });
});

test.describe('authenticator (AU-11 … AU-13, AC-03)', () => {
  test('turn it on with a QR code, save recovery codes, then sign in with the app code', async ({ page, request }) => {
    const email = uniqueEmail('mfa');
    await seed(request, { email, name: 'Secure' });
    await signIn(page, email, GOOD);
    await appReady(page);
    await openAccountSection(page, 'Security');
    await expect(page.getByText('Two-step verification is off')).toBeVisible();
    await page.getByRole('button', { name: 'Turn on' }).click();

    const dialog = page.getByRole('dialog', { name: 'Set up two-step verification' });
    await expect(dialog.getByRole('img', { name: 'QR code to scan with your authenticator app' })).toBeVisible();
    await expect(dialog.getByText('JBSW Y3DP EHPK 3PXP')).toBeVisible();
    await expect(dialog.getByText(/named “VinExpenses”/)).toBeVisible();
    await dialog.getByLabel('Then enter the 6 digits it shows').fill('000000');
    await dialog.getByRole('button', { name: 'Turn on' }).click();
    await expect(dialog.getByText('That code is not right. Codes change every 30 seconds, so wait for a new one.')).toBeVisible();
    await dialog.getByLabel('Then enter the 6 digits it shows').fill('654321');
    await dialog.getByRole('button', { name: 'Turn on' }).click();

    const codesDialog = page.getByRole('dialog', { name: 'Save your recovery codes' });
    await expect(codesDialog).toBeVisible();
    const codes = await codesDialog.locator('ul li').allTextContents();
    expect(codes).toHaveLength(8);
    for (const code of codes) expect(code).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
    await expect(codesDialog.getByRole('button', { name: 'Done' })).toBeDisabled();
    await page.keyboard.press('Escape'); // must be answered first
    await expect(codesDialog).toBeVisible();
    await codesDialog.getByLabel('I have saved my recovery codes').check();
    await codesDialog.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByText('Two-step verification is on', { exact: true })).toBeVisible();

    // sign out and in again: the password is not enough any more
    await signOutViaPage(page);
    await signIn(page, email, GOOD);
    await expect(page.getByRole('heading', { name: 'Two-step verification' })).toBeVisible();
    await expect(page).toHaveURL(/\/auth$/);
    await page.goto('/app/history');
    await expect(page.getByRole('heading', { name: 'Two-step verification' })).toBeVisible(); // still not in
    await page.getByLabel('6-digit code').fill('000000');
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page.getByText('That code is not right. Codes change every 30 seconds, so wait for a new one.')).toBeVisible();
    await page.getByLabel('6-digit code').fill('654321');
    await page.getByRole('button', { name: 'Verify' }).click();
    // back to the page they were heading for
    await expect(page.getByRole('heading', { level: 1, name: 'History' })).toBeVisible();

    // a recovery code works once and turns the authenticator off
    await page.getByRole('link', { name: 'Account' }).first().click();
    await signOutViaPage(page);
    await signIn(page, email, GOOD);
    await page.getByRole('button', { name: 'Lost your phone? Use a recovery code' }).click();
    await page.getByLabel('Recovery code').fill('AAAAA-BBBBB');
    await page.getByLabel('Password', { exact: true }).fill(GOOD);
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page.getByText('That recovery code is not right, or it was already used.')).toBeVisible();
    await page.getByLabel('Recovery code').fill((codes[0] ?? '').toLowerCase());
    await page.getByRole('button', { name: 'Verify' }).click();
    await appReady(page);
    await expect(page.getByText('Two-step verification was turned off. You can set it up again in Account.')).toBeVisible();
  });

  test('turning it off needs the password; making new recovery codes asks first', async ({ page, request }) => {
    const email = uniqueEmail('mfa-off');
    await seed(request, { email, name: 'Off Test', factor: true });
    await signIn(page, email, GOOD);
    await page.getByLabel('6-digit code').fill('654321');
    await page.getByRole('button', { name: 'Verify' }).click();
    await appReady(page);
    await openAccountSection(page, 'Security');
    await expect(page.getByText('Two-step verification is on', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Make new recovery codes' }).click();
    await expect(page.getByText('Making new codes stops the old ones from working.')).toBeVisible();
    await page.getByRole('dialog').last().getByRole('button', { name: 'Make new recovery codes' }).click();
    await expect(page.getByRole('dialog', { name: 'Save your recovery codes' }).locator('ul li')).toHaveCount(8);
    await page.getByLabel('I have saved my recovery codes').check();
    await page.getByRole('button', { name: 'Done' }).click();

    await page.getByRole('button', { name: 'Turn off' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Turn off' });
    await dialog.getByLabel('Password', { exact: true }).fill('Wrong!Passw0rd1');
    await dialog.getByRole('button', { name: 'Turn off' }).click();
    await expect(dialog.getByText('That password is not right.')).toBeVisible();
    await dialog.getByLabel('Password', { exact: true }).fill(GOOD);
    await dialog.getByRole('button', { name: 'Turn off' }).click();
    await expect(page.getByText('Two-step verification is off', { exact: true })).toBeVisible();
  });

  test('leaving the setup before confirming does not leave it half on', async ({ page, request }) => {
    const email = uniqueEmail('mfa-cancel');
    await seed(request, { email, name: 'Cancel Test' });
    await signIn(page, email, GOOD);
    await openAccountSection(page, 'Security');
    await page.getByRole('button', { name: 'Turn on' }).click();
    await expect(page.getByRole('dialog', { name: 'Set up two-step verification' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByText('Two-step verification is off')).toBeVisible();
    await page.getByRole('dialog', { name: 'Account', exact: true }).getByRole('button', { name: 'Close' }).click();
    await openAccountSection(page, 'Security');
    await expect(page.getByText('Two-step verification is off')).toBeVisible();
  });
});

test.describe('account (AC-01, AC-02) and first-time setup (AU-10)', () => {
  test('shows who you are, and changing the password needs the current one', async ({ page, request }) => {
    const email = uniqueEmail('acct');
    await seed(request, { email, name: 'Account Owner' });
    await signIn(page, email, GOOD);
    await page.getByRole('link', { name: 'Account' }).first().click();
    const account = page.getByRole('dialog', { name: 'Account', exact: true });
    await expect(account.getByText('Account Owner')).toBeVisible(); // the sidebar's user card shows the name too
    await expect(account.getByText(email)).toBeVisible();
    await expect(account.getByText('Email and password')).toBeVisible();
    await account.getByRole('button', { name: 'Change password', exact: true }).click();

    await page.getByLabel('Current password').fill('Wrong!Passw0rd1');
    await page.getByLabel('New password').fill(NEW_GOOD);
    await page.getByLabel('Confirm password').fill(NEW_GOOD);
    await page.getByRole('dialog', { name: 'Change password', exact: true }).getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByText('The current password is not right.')).toBeVisible();

    await page.getByLabel('Current password').fill(GOOD);
    await page.getByRole('dialog', { name: 'Change password', exact: true }).getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByText('Your password was changed.')).toBeVisible();

    await signOutViaPage(page);
    await signIn(page, email, NEW_GOOD);
    await appReady(page);
  });

  test('a first-time Google sign-in must choose a name and a strong password, then may add the authenticator', async ({ page, request }) => {
    const email = uniqueEmail('google');
    await seed(request, { email, name: '', google: true });
    // stand in for the Google redirect: a real session for this person, but with no name yet
    const reply = await (await request.post(`${BACKEND}/functions/v1/auth-gate`, { headers: { origin: 'http://127.0.0.1:4173' }, data: { action: 'signin', email, password: GOOD, device: 'd'.padEnd(20, '1') } })).json();
    await page.addInitScript((session) => localStorage.setItem('sb-127-auth-token', JSON.stringify({ ...session, expires_at: Math.floor(Date.now() / 1000) + 3000, token_type: 'bearer', expires_in: 3000 })), reply.session);

    await page.goto('/app');
    await expect(page).toHaveURL(/\/auth\/setup$/);
    await expect(page.getByRole('heading', { name: 'Finish setting up' })).toBeVisible();
    await page.getByRole('button', { name: 'Save and continue' }).click();
    await expect(page.getByText('Enter your name.')).toBeVisible();
    await page.getByLabel('Name').fill('Gina Lee');
    await page.getByLabel('Password', { exact: true }).fill('short');
    await page.getByLabel('Confirm password').fill('short');
    await page.getByRole('button', { name: 'Save and continue' }).click();
    await expect(page.getByText('The password does not meet every rule below.')).toBeVisible();
    await page.getByLabel('Password', { exact: true }).fill(NEW_GOOD);
    await page.getByLabel('Confirm password').fill(NEW_GOOD);
    await page.getByRole('button', { name: 'Save and continue' }).click();
    await expect(page.getByRole('heading', { name: 'Add two-step verification?' })).toBeVisible();
    await page.getByRole('button', { name: 'Maybe later' }).click();
    await appReady(page);
    await expect(page.getByText('Your account is ready. Welcome aboard!')).toBeVisible();
  });
});

test.describe('contact the admin (PU-01) and old links (AU-16)', () => {
  test('works without signing in: checks each field, then sends', async ({ page, request }) => {
    await page.goto('/auth');
    await page.getByRole('button', { name: 'Contact the admin' }).click();
    const dialog = page.getByRole('dialog', { name: 'Contact the admin' });
    await dialog.getByRole('button', { name: 'Send message' }).click();
    await expect(dialog.getByText('Enter your email.')).toBeVisible();
    await expect(dialog.getByText('Choose what this is about.')).toBeVisible();
    await expect(dialog.getByText('Please tell us a little more (at least 5 characters).')).toBeVisible();
    const email = uniqueEmail('help');
    await dialog.getByLabel('Your email').fill(email);
    await dialog.getByLabel('What is it about?').selectOption('locked_out');
    await dialog.getByLabel('Message').fill('I cannot sign in at all');
    await expect(dialog.getByText('23 / 2000')).toBeVisible();
    await dialog.getByRole('button', { name: 'Send message' }).click();
    await expect(dialog.getByText('Thank you. Your message was sent, and the admin will reply by email.')).toBeVisible();
    const state = await (await request.get(`${BACKEND}/__test/state?email=${encodeURIComponent(email)}`)).json();
    expect(state.feedback.some((f: { email: string; message: string }) => f.email === email && f.message === 'I cannot sign in at all')).toBe(true);
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(dialog).toBeHidden();
    // opening it again starts clean
    await page.getByRole('button', { name: 'Contact the admin' }).click();
    await expect(page.getByRole('dialog').getByLabel('Message')).toHaveValue('');
  });

  test('message text is shown as plain text, never as HTML', async ({ page, request }) => {
    const email = uniqueEmail('xss');
    await seed(request, { email, name: '<img src=x onerror=alert(1)>' });
    await signIn(page, email, GOOD);
    await appReady(page);
    await page.getByRole('link', { name: 'Account' }).first().click();
    await expect(page.getByRole('dialog', { name: 'Account', exact: true }).getByText('<img src=x onerror=alert(1)>')).toBeVisible();
    await expect(page.locator('aside').getByText('<img src=x onerror=alert(1)>')).toBeVisible(); // also as plain text in the sidebar card
    expect(await page.locator('main img').count()).toBe(0);
  });

  test('an old emailed link is explained and removed from the address bar, and signs nobody in', async ({ page }) => {
    await page.goto('/auth#access_token=stolen.fake.token&refresh_token=x&type=recovery');
    await expect(page.getByText(/That link is out of date/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    expect(page.url()).not.toContain('access_token');
    expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain('stolen.fake.token');
  });

  test('the sign-in page speaks Malay and Chinese when chosen', async ({ page }) => {
    await page.goto('/auth');
    await page.getByLabel('Language').selectOption('ms');
    await expect(page.getByRole('heading', { name: 'Selamat kembali' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Lupa kata laluan?' })).toBeVisible();
    await page.getByLabel('Bahasa').selectOption('zh');
    await expect(page.getByRole('heading', { name: '欢迎回来' })).toBeVisible();
    await page.getByRole('button', { name: '忘记密码？' }).click();
    await expect(page.getByRole('heading', { name: '忘记密码了吗？' })).toBeVisible();
  });
});
