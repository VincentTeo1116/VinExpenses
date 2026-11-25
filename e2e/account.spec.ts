// AC-04 … AC-07, AC-09: Telegram, the monthly report, reminder settings, deleting the account, and the Telegram nudge in the reminder pop-up.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { BACKEND } from './api';
import { accountView, dbRows, openAccount, openSection, seedRows, signInAs, ymdDaysFromNow } from './helpers';

const setTelegram = (page: Page, email: string, linked: boolean) => page.request.post(`${BACKEND}/__test/telegram`, { data: { email, linked } });
const verifyEmail = (page: Page, email: string) => page.request.post(`${BACKEND}/__test/verify-report-email`, { data: { email } });

test.describe('Telegram (AC-04)', () => {
  test('connect gives a one-time link; once linked it shows connected; disconnect puts it back', async ({ page }) => {
    const user = await signInAs(page);
    await openAccount(page, 'Telegram');
    await expect(page.getByTestId('tg-status')).toHaveText('Not connected.');
    await page.getByRole('button', { name: 'Connect Telegram' }).click();
    const open = page.getByRole('link', { name: 'Open Telegram to finish' });
    await expect(open).toBeVisible();
    expect(await open.getAttribute('href')).toMatch(/^https:\/\/t\.me\/[A-Za-z0-9_]{5,32}\?start=[A-Z2-9]{10}$/);
    expect(await open.getAttribute('rel')).toContain('noopener');
    await setTelegram(page, user.email, true); // what pressing Start in Telegram does
    await page.getByRole('button', { name: 'Check again' }).click();
    await expect(page.getByTestId('tg-status')).toContainText('Connected.');
    await page.getByRole('button', { name: 'Disconnect' }).click();
    await expect(page.getByText('Telegram disconnected')).toBeVisible();
    await expect(page.getByTestId('tg-status')).toHaveText('Not connected.');
  });

  test('a link that is not a genuine t.me link is never offered', async ({ page }) => {
    await signInAs(page);
    await page.route('**/functions/v1/telegram-link', async (route) => {
      const body = route.request().postDataJSON() as { action: string };
      if (body.action === 'create') return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ link: 'https://evil.example/?start=ABCDEFGHJK' }) });
      return route.fallback();
    });
    await openAccount(page, 'Telegram');
    await page.getByRole('button', { name: 'Connect Telegram' }).click();
    await expect(page.getByText('The server sent a link the app does not trust')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open Telegram to finish' })).toHaveCount(0);
  });
});

test.describe('Telegram nudge (AC-09): in the reminder pop-up, only for people with a deposit or loan', () => {
  // a loan whose payment is due tomorrow, so the "Don't forget" pop-up opens on Home
  const loanDue = (page: Page, email: string) =>
    seedRows(page, email, 'loans', [{ name: 'Car loan', lender: null, principal: 30000, rate: 3, method: 'reducing', term_months: 60, first_payment_date: ymdDaysFromNow(1), fees: 0, instalment: 540, reminders_on: true, reminder_days: [3, 0], status: 'open', paid_through: null }]);

  test('shown inside the reminder pop-up; Connect lands on Telegram in Account; "don\'t ask again" is kept after a reload', async ({ page }) => {
    const user = await signInAs(page);
    await loanDue(page, user.email);
    await page.goto('/app');
    const popup = page.getByRole('dialog', { name: "Don't forget" });
    await expect(popup).toBeVisible();
    await expect(popup.getByTestId('tg-prompt')).toBeVisible();
    await popup.getByRole('button', { name: 'Connect now' }).click();
    await expect(accountView(page)).toBeVisible();
    await expect(accountView(page).getByRole('heading', { name: 'Telegram', exact: true })).toBeInViewport(); // it lands on the Telegram section
    await page.goto('/app');
    await expect(popup.getByTestId('tg-prompt')).toBeVisible();
    await popup.getByRole('button', { name: 'Don\'t ask again' }).click();
    await expect(page.getByTestId('tg-prompt')).toHaveCount(0);
    await page.reload();
    await expect(popup).toBeVisible(); // the loan is still due
    await expect(page.getByTestId('tg-prompt')).toHaveCount(0);
  });

  test('without a deposit or loan it never appears on Home (Telegram is in Account)', async ({ page }) => {
    await signInAs(page);
    await page.goto('/app');
    await expect(page.getByRole('heading', { level: 1, name: /^Hello,/ })).toBeVisible();
    await page.waitForTimeout(600);
    await expect(page.getByTestId('tg-prompt')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('never shown to someone who is already connected', async ({ page }) => {
    const user = await signInAs(page);
    await setTelegram(page, user.email, true);
    await loanDue(page, user.email);
    await page.goto('/app');
    await expect(page.getByRole('dialog', { name: "Don't forget" })).toBeVisible();
    await page.waitForTimeout(500);
    await expect(page.getByTestId('tg-prompt')).toHaveCount(0);
  });
});

test.describe('monthly report (AC-05)', () => {
  test('turn it on with an email, save, confirm the address, and the status says confirmed', async ({ page }) => {
    const user = await signInAs(page);
    await openAccount(page, 'Monthly report');
    await page.getByLabel('Send me a monthly report').check();
    await page.getByLabel('Report email address').fill('reports@example.com');
    await page.getByRole('button', { name: 'Save report settings' }).click();
    await expect(page.getByText('Report settings saved')).toBeVisible();
    const row = (await dbRows(page, user.email, 'monthly_report_preferences'))[0] as Record<string, unknown>;
    expect(row).toMatchObject({ enabled: true, channel: 'auto', recipient_email: 'reports@example.com' });
    await expect(page.getByTestId('report-verified')).toContainText('Not confirmed yet');
    await page.getByRole('button', { name: 'Send confirmation email' }).click();
    await expect(page.getByText(/Confirmation email sent/)).toBeVisible();
    await verifyEmail(page, user.email);
    await page.reload();
    await openSection(page, 'Monthly report');
    await expect(page.getByTestId('report-verified')).toContainText('Confirmed: reports can be sent to this address.');
    await expect(page.getByRole('button', { name: 'Send confirmation email' })).toHaveCount(0);
  });

  test('an email is needed when it is on, and a bad address is explained', async ({ page }) => {
    await signInAs(page);
    await openAccount(page, 'Monthly report');
    await page.getByLabel('Send me a monthly report').check();
    await page.getByLabel('Report email address').fill('not an email');
    await page.getByRole('button', { name: 'Save report settings' }).click();
    await expect(page.getByText('Enter a valid email address so we can send your report.')).toBeVisible();
  });

  test('the channel text follows Telegram: connected means reports go there, with email as the backup', async ({ page }) => {
    const user = await signInAs(page);
    await setTelegram(page, user.email, true);
    await openAccount(page, 'Monthly report');
    await expect(page.getByText(/Telegram is connected, so reports go there/)).toBeVisible();
    await expect(page.getByLabel('Backup email address (only if Telegram fails)')).toBeVisible();
    await page.getByRole('button', { name: 'Email', exact: true }).click();
    await expect(page.getByText('Reports go to your email address.')).toBeVisible();
  });

  test('a failed report can be sent again twice, then points to the admin; the status says it is on its way', async ({ page }) => {
    const user = await signInAs(page);
    await setTelegram(page, user.email, true);
    await seedRows(page, user.email, 'monthly_report_preferences', [{ enabled: true, channel: 'auto', recipient_email: user.email, last_status: 'failed', last_channel: 'telegram', last_month: '2026-10-01', resend_count: 0 }]);
    await openAccount(page, 'Monthly report');
    await expect(page.getByTestId('report-last')).toContainText('could not be sent');
    await page.getByRole('button', { name: 'Send it again (2 left)' }).click();
    await expect(page.getByText('Your report is on its way', { exact: true })).toBeVisible();
    await expect(page.getByText(/Please allow about 15 minutes/)).toBeVisible();
    expect(((await dbRows(page, user.email, 'monthly_report_preferences'))[0] as Record<string, unknown>).resend_count).toBe(1);
    // reloading keeps the "on its way" note for 15 minutes (kept on this device)
    await page.reload();
    await openSection(page, 'Monthly report');
    await expect(page.getByText(/Please allow about 15 minutes/)).toBeVisible();
  });

  test('after two re-sends the button is gone and the admin is offered instead', async ({ page }) => {
    const user = await signInAs(page);
    await seedRows(page, user.email, 'monthly_report_preferences', [{ enabled: true, channel: 'auto', recipient_email: user.email, verified_email: user.email, last_status: 'failed', last_channel: 'email', last_month: '2026-10-01', resend_count: 2 }]);
    await openAccount(page, 'Monthly report');
    await expect(page.getByRole('button', { name: /Send it again/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Contact the admin' }).last().click();
    await expect(page.getByRole('dialog').last()).toBeVisible(); // the contact form, on top of the other pop-ups
  });
});

test.describe('reminder settings (AC-06)', () => {
  test('save the hour, the pop-up mode and hiding amounts; they come back after a reload', async ({ page }) => {
    const user = await signInAs(page);
    await openAccount(page, 'Reminder settings');
    await page.getByLabel('Send reminders at').selectOption('7');
    await page.getByLabel('Pop-up on the Home screen').selectOption('never');
    await page.getByLabel('Hide amounts in reminder messages').check();
    await page.getByRole('button', { name: 'Save reminder settings' }).click();
    await expect(page.getByText('Reminder settings saved')).toBeVisible();
    expect((await dbRows(page, user.email, 'user_preferences'))[0]).toMatchObject({ reminder_hour: 7, reminder_popup: 'never', reminder_hide_amounts: true });
    await page.reload();
    await openSection(page, 'Reminder settings');
    await expect(page.getByLabel('Send reminders at')).toHaveValue('7');
    await expect(page.getByLabel('Pop-up on the Home screen')).toHaveValue('never');
    await expect(page.getByLabel('Hide amounts in reminder messages')).toBeChecked();
  });
});

test.describe('delete account (AC-07)', () => {
  test('the button stays off until DELETE is typed; then the account and its data are gone and sign-in is refused', async ({ page }) => {
    const user = await signInAs(page);
    await seedRows(page, user.email, 'expenses', [{ amount: '5.00', category: 'food', payment: 'card', merchant: 'x', note: null, created_at: new Date().toISOString() }]);
    await openAccount(page, 'Delete my account');
    const button = page.getByRole('button', { name: 'Delete my account and data' });
    await expect(button).toBeDisabled();
    await page.getByLabel('Type DELETE to confirm').fill('delete');
    await expect(button).toBeDisabled();
    await page.getByLabel('Type DELETE to confirm').fill('DELETE');
    await expect(button).toBeEnabled();
    await button.click();
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible({ timeout: 15_000 });
    expect(await dbRows(page, user.email, 'expenses')).toHaveLength(0);
    const state = (await (await page.request.get(`${BACKEND}/__test/state?email=${encodeURIComponent(user.email)}`)).json()) as { user: unknown };
    expect(state.user).toBeNull();
  });

  test('offline it says to connect first and deletes nothing', async ({ page, context }) => {
    const user = await signInAs(page);
    await openAccount(page, 'Delete my account');
    await page.getByLabel('Type DELETE to confirm').fill('DELETE');
    await context.setOffline(true);
    await page.getByRole('button', { name: 'Delete my account and data' }).click();
    await expect(page.getByText('Connect to the internet before deleting your account.')).toBeVisible();
    await context.setOffline(false);
    const state = (await (await page.request.get(`${BACKEND}/__test/state?email=${encodeURIComponent(user.email)}`)).json()) as { user: unknown };
    expect(state.user).not.toBeNull();
  });
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the Account screen with every card passes the accessibility scan (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const user = await signInAs(page);
    await seedRows(page, user.email, 'monthly_report_preferences', [{ enabled: true, channel: 'auto', recipient_email: user.email, last_status: 'failed', last_channel: 'email', last_month: '2026-10-01', resend_count: 0 }]);
    const scan = async (label: string) => {
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`), label).toEqual([]);
    };
    await openAccount(page);
    await scan('the Account pop-up');
    // every section is in the pop-up; put two of them in their busier states first
    await page.getByRole('button', { name: 'Connect Telegram' }).click();
    await expect(page.getByRole('link', { name: 'Open Telegram to finish' })).toBeVisible();
    await scan('the Account pop-up with Telegram waiting');
    for (const section of ['Change password', 'Delete my account']) {
      await openSection(page, section);
      const inner = page.getByRole('dialog', { name: section, exact: true });
      if (section === 'Delete my account') await page.getByLabel('Type DELETE to confirm').fill('DEL');
      await scan(section);
      await inner.getByRole('button', { name: 'Close' }).click();
      await expect(inner).toHaveCount(0);
    }
  });
}
