// AC-08, AD-01 … AD-07: the admin area. Visible only to the administrator, the server decides every action, and it never shows money.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { BACKEND } from './api';
import { isoDaysAgo, seedRows, signInAs } from './helpers';

const makeAdmin = (page: Page, email: string) => page.request.post(`${BACKEND}/__test/make-admin`, { data: { email } });
const person = (page: Page, name: string) => page.request.post(`${BACKEND}/__test/seed`, { data: { email: `${name}.${Date.now().toString(36)}${Math.floor(Math.random() * 1e5)}@example.com`, name } }).then((r) => r.json() as Promise<{ id: string; email: string }>);

async function openAdmin(page: Page) {
  await page.goto('/app/admin');
  await expect(page.getByRole('heading', { level: 1, name: 'Admin' })).toBeVisible();
}
const userCard = (page: Page, email: string) => page.locator(`[data-user="${email}"]`);

test.describe('who can see it (AC-08, AD-01)', () => {
  test('an ordinary person has no entry, and typing the address shows only a refusal', async ({ page }) => {
    await signInAs(page);
    await page.goto('/app');
    await expect(page.getByRole('heading', { level: 1, name: /^Hello,/ })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Admin' })).toHaveCount(0);
    await page.goto('/app/admin');
    await expect(page.getByText('This area is for administrators only.')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Accounts' })).toHaveCount(0);
  });

  test('the administrator sees the entry in the menu and in Account', async ({ page }) => {
    const me = await signInAs(page);
    await makeAdmin(page, me.email);
    await page.goto('/app/account');
    const account = page.getByRole('dialog', { name: 'Account', exact: true });
    await expect(account.getByRole('heading', { name: 'Administrator' })).toBeVisible();
    await account.getByRole('button', { name: 'Open the admin area' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Admin' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Accounts' })).toBeVisible();
  });

  test('the server refuses an ordinary person even when the screen is bypassed', async ({ page }) => {
    const me = await signInAs(page);
    const stored = JSON.parse(me.session) as { access_token: string };
    const reply = await page.request.post(`${BACKEND}/functions/v1/admin`, { headers: { authorization: `Bearer ${stored.access_token}`, origin: 'http://127.0.0.1:4173' }, data: { action: 'list' } });
    expect(reply.status()).toBe(403);
  });
});

test.describe('accounts (AD-02, AD-03)', () => {
  test('lists accounts with their facts, searches and filters, and never shows a money amount', async ({ page }) => {
    const me = await signInAs(page, { name: 'Boss' });
    await makeAdmin(page, me.email);
    const ann = await person(page, 'ann');
    const bob = await person(page, 'bob');
    // Ann has spending; the admin may see the DATE of it, and nothing else about it
    await seedRows(page, ann.email, 'expenses', [{ amount: '98765.43', category: 'food', payment: 'card', merchant: 'SECRET-MERCHANT-XYZ', note: 'secret note', created_at: isoDaysAgo(3) }]);
    const bodies: string[] = [];
    page.on('response', async (response) => {
      if (response.url().includes('/functions/v1/admin')) bodies.push(await response.text().catch(() => ''));
    });
    await openAdmin(page);
    await expect(userCard(page, ann.email)).toContainText(/[23] days ago/);
    await expect(userCard(page, bob.email)).toContainText('No expenses yet');
    await expect(userCard(page, ann.email)).toContainText('Telegram');
    await page.getByLabel('Search by name or email').fill('bob');
    await expect(userCard(page, ann.email)).toHaveCount(0);
    await expect(userCard(page, bob.email)).toBeVisible();
    await page.getByLabel('Search by name or email').fill('');
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) {
      expect(body).not.toContain('98765');
      expect(body).not.toContain('SECRET-MERCHANT');
      expect(body).not.toContain('secret note');
    }
    await expect(page.locator('body')).not.toContainText('SECRET-MERCHANT');
  });

  test('block and unblock sign-in: a confirm sheet first, then the status changes and the action is logged', async ({ page }) => {
    const me = await signInAs(page);
    await makeAdmin(page, me.email);
    const ann = await person(page, 'ann');
    await openAdmin(page);
    await userCard(page, ann.email).getByRole('button', { name: /^Manage/ }).click();
    const sheet = page.getByRole('dialog', { name: /^Manage/ });
    await sheet.getByRole('button', { name: 'Block sign-in' }).click();
    const confirm = page.getByRole('dialog', { name: 'Block sign-in?' });
    await expect(confirm).toContainText(`${ann.email} will not be able to sign in`);
    await confirm.getByRole('button', { name: 'Block', exact: true }).click();
    await expect(page.getByText('Sign-in is blocked for this account until you unblock it.')).toBeVisible();
    await expect(userCard(page, ann.email)).toContainText('Sign-in blocked');
    await expect(userCard(page, ann.email)).toContainText('Blocked by an admin');
    await userCard(page, ann.email).getByRole('button', { name: /^Manage/ }).click();
    await page.getByRole('dialog', { name: /^Manage/ }).getByRole('button', { name: 'Unblock sign-in' }).click();
    await page.getByRole('dialog', { name: 'Unblock sign-in?' }).getByRole('button', { name: 'Unblock', exact: true }).click();
    await expect(userCard(page, ann.email)).not.toContainText('Sign-in blocked');
    await page.getByRole('tab', { name: 'System' }).click();
    await expect(page.getByRole('list', { name: 'Recent admin actions' })).toContainText('Blocked sign-in');
    await expect(page.getByRole('list', { name: 'Recent admin actions' })).toContainText('Unblocked sign-in');
  });

  test('cancelling the confirm sheet does nothing', async ({ page }) => {
    const me = await signInAs(page);
    await makeAdmin(page, me.email);
    const ann = await person(page, 'ann');
    await openAdmin(page);
    await userCard(page, ann.email).getByRole('button', { name: /^Manage/ }).click();
    await page.getByRole('dialog', { name: /^Manage/ }).getByRole('button', { name: 'Disable account' }).click();
    await page.getByRole('dialog', { name: 'Disable this account?' }).getByRole('button', { name: 'Cancel' }).click();
    await expect(userCard(page, ann.email)).toContainText('Active');
  });

  test('disable and enable; the admin themselves cannot be disabled or blocked from the list', async ({ page }) => {
    const me = await signInAs(page, { name: 'Boss' });
    await makeAdmin(page, me.email);
    const ann = await person(page, 'ann');
    await openAdmin(page);
    await userCard(page, ann.email).getByRole('button', { name: /^Manage/ }).click();
    await page.getByRole('dialog', { name: /^Manage/ }).getByRole('button', { name: 'Disable account' }).click();
    await page.getByRole('dialog', { name: 'Disable this account?' }).getByRole('button', { name: 'Disable', exact: true }).click();
    await expect(userCard(page, ann.email)).toContainText('Disabled');
    await userCard(page, ann.email).getByRole('button', { name: /^Manage/ }).click();
    await page.getByRole('dialog', { name: /^Manage/ }).getByRole('button', { name: 'Enable account' }).click();
    await page.getByRole('dialog', { name: 'Enable this account?' }).getByRole('button', { name: 'Enable', exact: true }).click();
    await expect(userCard(page, ann.email)).toContainText('Active');
    // yourself: no block, no disable
    await userCard(page, me.email).getByRole('button', { name: /^Manage/ }).click();
    const own = page.getByRole('dialog', { name: /^Manage/ });
    await expect(own.getByRole('button', { name: 'Send password-reset code' })).toBeVisible();
    await expect(own.getByRole('button', { name: 'Block sign-in' })).toHaveCount(0);
    await expect(own.getByRole('button', { name: 'Disable account' })).toHaveCount(0);
  });

  test('reset authenticator, send a reset code, and resend a report by choosing a month', async ({ page }) => {
    const me = await signInAs(page);
    await makeAdmin(page, me.email);
    const ann = await person(page, 'ann');
    await page.request.post(`${BACKEND}/__test/telegram`, { data: { email: ann.email, linked: true } });
    await openAdmin(page);
    await userCard(page, ann.email).getByRole('button', { name: /^Manage/ }).click();
    await page.getByRole('dialog', { name: /^Manage/ }).getByRole('button', { name: 'Send password-reset code' }).click();
    await page.getByRole('dialog', { name: 'Send a reset code?' }).getByRole('button', { name: 'Send code' }).click();
    await expect(page.getByText(`A password-reset code was emailed to ${ann.email}.`)).toBeVisible();
    const mail = (await (await page.request.get(`${BACKEND}/__test/mail?email=${encodeURIComponent(ann.email)}`)).json()) as { kind?: string }[];
    expect(mail.some((m) => m.kind === 'admin-reset')).toBe(true);

    await userCard(page, ann.email).getByRole('button', { name: /^Manage/ }).click();
    await page.getByRole('dialog', { name: /^Manage/ }).getByRole('button', { name: 'Resend a monthly report' }).click();
    const picker = page.getByRole('dialog', { name: 'Resend which month?' });
    await expect(picker).toContainText('You will not see its contents');
    await picker.getByRole('button', { name: 'Send report' }).click();
    await expect(page.getByText(/report was sent to this person by telegram/)).toBeVisible();
  });

  test('a message from the server is shown in words when an action cannot be done', async ({ page }) => {
    const me = await signInAs(page);
    await makeAdmin(page, me.email);
    const ann = await person(page, 'ann'); // no Telegram link and no confirmed email
    await openAdmin(page);
    await userCard(page, ann.email).getByRole('button', { name: /^Manage/ }).click();
    await page.getByRole('dialog', { name: /^Manage/ }).getByRole('button', { name: 'Resend a monthly report' }).click();
    await page.getByRole('dialog', { name: 'Resend which month?' }).getByRole('button', { name: 'Send report' }).click();
    await expect(page.getByText(/nowhere to send it/)).toBeVisible();
  });
});

test.describe('messages (AD-04) and system (AD-05)', () => {
  test('feedback shows as plain text (never as HTML), and can be resolved and reopened', async ({ page }) => {
    const me = await signInAs(page);
    await makeAdmin(page, me.email);
    await page.request.post(`${BACKEND}/functions/v1/feedback`, { data: { email: 'lost@example.com', topic: 'locked_out', message: '<img src=x onerror="window.__pwned=1"><b>help</b> me' } });
    await openAdmin(page);
    await page.getByRole('tab', { name: 'Messages' }).click();
    const item = page.getByRole('listitem').filter({ hasText: 'lost@example.com' });
    await expect(item).toContainText('<img src=x onerror="window.__pwned=1"><b>help</b> me');
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
    expect(await item.locator('img, b').count()).toBe(0);
    await item.getByRole('button', { name: 'Mark resolved' }).click();
    await expect(page.getByRole('listitem').filter({ hasText: 'lost@example.com' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Resolved', exact: true }).click();
    await expect(page.getByRole('listitem').filter({ hasText: 'lost@example.com' })).toBeVisible();
    await page.getByRole('button', { name: 'Reopen' }).click();
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await expect(page.getByRole('listitem').filter({ hasText: 'lost@example.com' })).toBeVisible();
  });

  test('the system tab shows health checks, can send a test email, and lists admin actions', async ({ page }) => {
    const me = await signInAs(page);
    await makeAdmin(page, me.email);
    await openAdmin(page);
    await page.getByRole('tab', { name: 'System' }).click();
    const checks = page.getByRole('list', { name: 'Health checks' });
    await expect(checks).toContainText('Email (Gmail SMTP): OK');
    await expect(checks).toContainText('Scheduled jobs secret: needs attention');
    await page.getByRole('button', { name: 'Send a test email' }).click();
    await expect(page.getByText(`Test email delivered to ${me.email}`)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Recent admin actions' })).toBeVisible();
  });
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the admin screens pass the accessibility scan (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const me = await signInAs(page, { name: 'Boss' });
    await makeAdmin(page, me.email);
    const ann = await person(page, 'ann');
    await page.request.post(`${BACKEND}/functions/v1/feedback`, { data: { email: 'x@example.com', topic: 'bug', message: 'Something broke on my phone' } });
    await openAdmin(page);
    await userCard(page, ann.email).getByRole('button', { name: /^Manage/ }).click();
    await expect(page.getByRole('dialog', { name: /^Manage/ })).toBeVisible();
    let results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`), 'actions sheet').toEqual([]);
    await page.keyboard.press('Escape');
    for (const tab of ['Messages', 'System'] as const) {
      await page.getByRole('tab', { name: tab }).click();
      await page.waitForTimeout(300);
      results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`), tab).toEqual([]);
    }
  });
}
