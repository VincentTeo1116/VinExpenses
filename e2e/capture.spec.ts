// CP-05: payments detected by the Android app are reviewed here; a stand-in for the Android plugin is injected, so a browser can test the screens.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { dbRows, signInAs, watchProblems } from './helpers';

const AT = Date.now() - 3 * 60 * 60 * 1000;
const ITEMS = [
  { id: 'a1', app: 'demo', appLabel: 'Demo Wallet', amount: 12.5, currency: 'MYR', merchant: 'Kopitiam Ah Seng', date: '2026-11-25', postedAt: AT, confidence: 'high' },
  { id: 'b2', app: 'demo', appLabel: 'Demo Wallet', amount: 30, currency: 'MYR', merchant: '', date: '2026-11-25', postedAt: AT - 60 * 60 * 1000, confidence: 'low' },
];

/** A stand-in for the Android plugin: hands the queued items over once, like the real one empties its queue. */
async function androidApp(page: Page, items: unknown[] = ITEMS, enabled = true) {
  await page.addInitScript(
    ({ items: queued, enabled: on }) => {
      const w = window as unknown as Record<string, unknown>;
      if (!sessionStorage.getItem('__q')) sessionStorage.setItem('__q', JSON.stringify(queued));
      w.__opened = 0;
      w.__on = on;
      w.Capacitor = {
        Plugins: {
          NotificationCapture: {
            status: async () => ({ enabled: w.__on }),
            pull: async () => {
              const out = JSON.parse(sessionStorage.getItem('__q') ?? '[]');
              sessionStorage.setItem('__q', '[]');
              return { items: out };
            },
            openSettings: async () => {
              w.__opened = (w.__opened as number) + 1;
            },
          },
        },
      };
    },
    { items, enabled },
  );
}

test('in a normal browser nothing changes: no banner, no card, nothing stored, no errors, no new requests', async ({ page }) => {
  const problems = watchProblems(page);
  const hosts = new Set<string>();
  page.on('request', (request) => hosts.add(new URL(request.url()).host));
  await signInAs(page);
  await page.goto('/app');
  await expect(page.getByRole('heading', { level: 1, name: /^Hello,/ })).toBeVisible();
  await expect(page.getByTestId('capture-banner')).toHaveCount(0);
  await page.goto('/app/account');
  await expect(page.getByTestId('capture-settings')).toHaveCount(0);
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('ve_capture')))).toEqual([]);
  expect(await page.evaluate(() => 'Capacitor' in window)).toBe(false);
  expect([...hosts].sort()).toEqual(['127.0.0.1:4173', '127.0.0.1:54321']); // only this site and the stand-in backend
  expect(problems).toEqual([]);
});

test('detected payments show as a banner, and adding one saves it and clears it from the list', async ({ page }) => {
  const user = await signInAs(page);
  await androidApp(page);
  await page.goto('/app');
  const banner = page.getByTestId('capture-banner');
  await expect(banner).toContainText('2 detected payments to review');
  await banner.getByRole('button', { name: 'Review' }).click();
  const list = page.getByRole('dialog', { name: 'Detected payments' });
  await expect(list.getByTestId('capture-item')).toHaveCount(2);
  await expect(list).toContainText('Nothing is saved until you add it');
  await expect(list).toContainText('Shop not read');
  await list.getByTestId('capture-item').first().getByRole('button', { name: 'Add' }).click();

  await expect(page.getByLabel('Amount (RM)')).toHaveValue('12.50');
  await expect(page.getByLabel('Where (optional)')).toHaveValue('Kopitiam Ah Seng');
  await expect(page.getByLabel('Date')).toHaveValue('2026-11-25');
  await page.getByRole('radio', { name: 'Food', exact: true }).check();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved').first()).toBeVisible();

  const rows = await dbRows(page, user.email, 'expenses');
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ amount: '12.50', merchant: 'Kopitiam Ah Seng', category: 'food' });
  await expect(banner).toContainText('1 detected payments to review'); // the added one is gone, the other waits
});

test('dismissing leaves nothing behind, and the list survives a reload without coming back from the phone twice', async ({ page }) => {
  await signInAs(page);
  await androidApp(page);
  await page.goto('/app');
  await page.getByTestId('capture-banner').getByRole('button', { name: 'Review' }).click();
  const list = page.getByRole('dialog', { name: 'Detected payments' });
  await list.getByTestId('capture-item').first().getByRole('button', { name: 'Dismiss' }).click();
  await expect(list.getByTestId('capture-item')).toHaveCount(1);
  await page.reload(); // the phone's queue was already emptied, so only the saved list can show what is left
  await expect(page.getByTestId('capture-banner')).toContainText('1 detected payments to review');
});

test('the wallet and the bank announcing one payment make a single entry', async ({ page }) => {
  await signInAs(page);
  await androidApp(page, [ITEMS[0], { ...ITEMS[0], id: 'zz', app: 'bank', appLabel: 'Demo Bank', postedAt: AT + 90_000 }]);
  await page.goto('/app');
  await expect(page.getByTestId('capture-banner')).toContainText('1 detected payments to review');
});

test('Account explains the feature, shows whether it is on, and opens the Android settings', async ({ page }) => {
  await signInAs(page);
  await androidApp(page, [], false);
  await page.goto('/app/account');
  const card = page.getByTestId('capture-settings');
  await expect(card).toContainText('the notification text is never stored or sent');
  await expect(card).toContainText('Off: allow notification access');
  await card.getByRole('button', { name: 'Open notification access settings' }).click();
  expect(await page.evaluate(() => (window as unknown as { __opened: number }).__opened)).toBe(1);
  await page.evaluate(() => ((window as unknown as { __on: boolean }).__on = true));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(card).toContainText('On: payment notifications can be read');
});

test('the banner and the list are translated and pass the accessibility scan', async ({ page }) => {
  await signInAs(page);
  await androidApp(page);
  await page.addInitScript(() => localStorage.setItem('ve_lang', 'ms'));
  await page.goto('/app');
  await expect(page.getByTestId('capture-banner')).toContainText('2 bayaran dikesan untuk disemak');
  await page.getByTestId('capture-banner').getByRole('button', { name: 'Semak' }).click();
  await expect(page.getByRole('dialog', { name: 'Bayaran dikesan' })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
});
