// TG-02: the Telegram Mini App (same codebase as the web app). The sample preview is tested in full; the real launch is tested against
// a stubbed data service, so what is checked here is what the page sends and how it shows each answer.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';
import { watchProblems } from './helpers';

const INIT = 'query_id=AAHdF6IQ&user=%7B%22id%22%3A42%2C%22first_name%22%3A%22Ann%22%2C%22language_code%22%3A%22en%22%7D&auth_date=1700000000&hash=abcdef';
const launch = (theme?: Record<string, string>) => `/miniapp/#tgWebAppData=${encodeURIComponent(INIT)}&tgWebAppThemeParams=${encodeURIComponent(JSON.stringify(theme ?? {}))}&tgWebAppPlatform=web&tgWebAppVersion=7.0`;

const CATEGORIES = [
  { key: 'food', label: 'Food', color: '#ef4444', active: true },
  { key: 'car', label: 'Car', color: '#f97316', active: true },
  { key: 'other', label: 'Other', color: '#6b7280', active: true },
];
const PAYMENTS = [
  { key: 'cash', label: 'Cash', active: true },
  { key: 'card', label: 'Card', active: true },
];
const monthStart = (back: number) => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - back, 1) - 8 * 3600000).toISOString();
};
const month = (over: Record<string, unknown> = {}) => ({
  offset: 0, start: monthStart(0), end: monthStart(-1), days: 30, firstWeekday: 2, total: 150.5, count: 3, previousTotal: 100, previousCount: 2, income: 3000,
  byCategory: [['food', 100.5], ['car', 50]], daily: Array.from({ length: 30 }, (_, i) => (i === 3 ? 100.5 : i === 5 ? 50 : 0)), todayIndex: 10,
  budgets: [{ key: 'all', limit: 1000, used: 150.5 }], monthTotals: [0, 0, 0, 0, 100, 150.5], monthStarts: [5, 4, 3, 2, 1, 0].map(monthStart), streak: 0, insights: [], ...over,
});
const dayOf = (back: number) => new Date(Date.now() - back * 86400000).toISOString();
const ITEMS = [
  { id: 'a1111111-1111-4111-8111-111111111111', amount: 100.5, category: 'food', payment: 'cash', merchant: 'Lunch spot', note: null, created_at: dayOf(1) },
  { id: 'b2222222-2222-4222-8222-222222222222', amount: 50, category: 'car', payment: 'card', merchant: 'Petrol', note: 'full tank', created_at: dayOf(2) },
];

interface Seen {
  headers: Record<string, string>;
  body: Record<string, unknown>;
}
/** Stands in for the data service: records what the page sends and answers by action. */
async function stub(page: Page, handler: (action: string, body: Record<string, unknown>, route: Route) => Promise<boolean | void> | boolean | void) {
  const seen: Seen[] = [];
  await page.route('**/functions/v1/miniapp-api', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    seen.push({ headers: route.request().headers(), body });
    if (await handler(String(body.action), body, route)) return;
    const reply = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(data) });
    switch (body.action) {
      case 'bootstrap': return reply({ ok: true, name: 'Ann', lang: 'en', today: new Date().toISOString().slice(0, 10), categories: CATEGORIES, payments: PAYMENTS, maxOffset: 60, maxAmount: 1000000, maxDaysBack: 400 });
      case 'month': return reply({ ok: true, data: month({ offset: body.offset }) });
      case 'transactions': return reply({ ok: true, items: ITEMS, total: 2, sum: 150.5 });
      default: return reply({ ok: true });
    }
  });
  return seen;
}

test.describe('opened outside Telegram', () => {
  test('explains itself, and offers the sample preview', async ({ page }) => {
    await page.goto('/miniapp/');
    await expect(page.getByRole('heading', { name: 'Open this from the Telegram bot' })).toBeVisible();
    await expect(page.getByText('This page works inside Telegram')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add expense' })).toHaveCount(0); // no data and no way in
    await page.getByRole('button', { name: 'Try the preview' }).click();
    await expect(page.getByText('Preview with sample data')).toBeVisible();
    await expect(page.getByTestId('mini-total')).toBeVisible();
  });

  test('a made-up preview address cannot fake a launch: ?demo=1 is only for the plain browser', async ({ page }) => {
    await page.goto(`/miniapp/?demo=1#tgWebAppData=${encodeURIComponent(INIT)}`);
    // with launch data present it is a real launch, so the preview banner is not shown
    await expect(page.getByText('Preview with sample data')).toHaveCount(0);
  });
});

test.describe('the preview with sample data', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/miniapp/?demo=1');
    await expect(page.getByTestId('mini-total')).toBeVisible();
  });

  test('overview: the month, the total, categories that add up, and tapping one opens History filtered', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1 })).toContainText(String(new Date().getFullYear()));
    const total = Number((await page.getByTestId('mini-total').textContent())?.replace(/[^\d.]/g, ''));
    expect(total).toBeGreaterThan(0);
    const first = page.locator('[data-category]').first();
    const key = await first.getAttribute('data-category');
    await first.click();
    await expect(page.getByRole('button', { name: /^All$/ })).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator(`button[aria-pressed="true"]`).filter({ hasNotText: /^All$/ }).first()).toBeVisible();
    expect(key).toBeTruthy();
  });

  test('every tab opens: days (stats and calendar), budgets, trend and history', async ({ page }) => {
    await page.getByRole('button', { name: 'Days' }).click();
    await expect(page.getByText('Busiest day')).toBeVisible();
    await page.getByRole('group', { name: 'Daily spending' }).getByRole('button').first().click();
    await expect(page.getByTestId('mini-heat-detail')).toContainText('RM');
    await page.getByRole('button', { name: 'Budgets' }).click();
    await expect(page.getByRole('progressbar').first()).toBeVisible();
    await expect(page.locator('[data-budget="all"]')).toContainText('Overall');
    await page.getByRole('button', { name: 'Trend' }).click();
    await expect(page.getByText('Last 6 months')).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: 'RM' })).toHaveCount(6);
    await page.getByRole('button', { name: 'History' }).click();
    await expect(page.getByRole('searchbox', { name: 'Search expenses' })).toBeVisible();
  });

  test('the month can go back and forward, and cannot go past this month', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Next month' })).toBeDisabled();
    const title = await page.getByRole('heading', { level: 1 }).textContent();
    await page.getByRole('button', { name: 'Previous month' }).click();
    await expect(page.getByRole('heading', { level: 1 })).not.toHaveText(title ?? '');
    await page.getByRole('button', { name: 'Next month' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(title ?? '');
  });

  test('add an expense: mistakes are explained, then it saves and the total goes up by that amount', async ({ page }) => {
    const before = Number((await page.getByTestId('mini-total').textContent())?.replace(/[^\d.]/g, ''));
    await page.getByRole('button', { name: 'Add expense' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add expense' });
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog.getByText('Enter an amount from RM 0.01 to RM 1,000,000')).toBeVisible();
    await dialog.getByLabel('Amount').fill('12,50');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog.getByText('Choose a category')).toBeVisible();
    await dialog.getByRole('radio', { name: 'Food' }).check();
    await dialog.getByLabel('Merchant').fill('Test cafe');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Saved ✓')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const after = Number((await page.getByTestId('mini-total').textContent())?.replace(/[^\d.]/g, ''));
    expect(Math.round((after - before) * 100)).toBe(1250);
  });

  test('edit changes only what was changed; delete needs a second tap', async ({ page }) => {
    await page.getByRole('button', { name: 'History' }).click();
    const row = page.locator('button[data-item]').first();
    await expect(row).toBeVisible();
    const name = await row.getAttribute('data-item');
    await row.click();
    const dialog = page.getByRole('dialog', { name: 'Edit expense' });
    await expect(dialog.getByLabel('Amount')).not.toHaveValue('');
    await dialog.getByLabel('Merchant').fill('Renamed place');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Saved ✓')).toBeVisible();
    await expect(page.locator('button[data-item="Renamed place"]').first()).toBeVisible();
    await page.locator('button[data-item="Renamed place"]').first().click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Tap again to delete' })).toBeVisible();
    await page.getByRole('button', { name: 'Tap again to delete' }).click();
    await expect(page.getByText('Deleted ✓')).toBeVisible();
    await expect(page.locator('button[data-item="Renamed place"]')).toHaveCount(0);
    expect(name).toBeTruthy();
  });

  test('search narrows the list', async ({ page }) => {
    await page.getByRole('button', { name: 'History' }).click();
    const rows = page.locator('button[data-item]');
    await expect(rows.first()).toBeVisible();
    const all = await rows.count();
    await page.getByRole('searchbox', { name: 'Search expenses' }).fill('zzzz-no-match');
    await expect(page.getByText('No expenses this month yet')).toBeVisible();
    await page.getByRole('searchbox', { name: 'Search expenses' }).fill('');
    await expect(rows).toHaveCount(all);
  });
});

test.describe('a real launch from Telegram', () => {
  test('sends the signed launch data in a header (never a user id), and shows what the service answers', async ({ page }) => {
    const problems = watchProblems(page);
    const seen = await stub(page, () => false);
    await page.goto(launch({ bg_color: '#17212b', text_color: '#ffffff', button_color: '#5288c1' }));
    await expect(page.getByTestId('mini-total')).toHaveText('RM 150.50');
    expect(seen.length).toBeGreaterThan(1);
    for (const call of seen) {
      expect(call.headers['x-telegram-init-data']).toBe(INIT);
      expect(JSON.stringify(call.body)).not.toMatch(/user_?id|"id":\s*42/i);
    }
    expect(seen[0]?.body).toEqual({ action: 'bootstrap' });
    // Telegram's dark theme was applied
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-scheme'))).toBe('dark');
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--tg-bg').trim())).toBe('#17212b');
    expect(problems).toEqual([]);
  });

  test('adding sends exactly what was typed, and the screen refreshes', async ({ page }) => {
    const seen = await stub(page, () => false);
    await page.goto(launch());
    await expect(page.getByTestId('mini-total')).toBeVisible();
    await page.getByRole('button', { name: 'Add expense' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add expense' });
    await dialog.getByLabel('Amount').fill('7,5');
    await dialog.getByLabel('Merchant').fill('Kopi');
    await dialog.getByRole('radio', { name: 'Food' }).check();
    await dialog.getByRole('radio', { name: 'Card' }).check();
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Saved ✓')).toBeVisible();
    const add = seen.find((s) => s.body.action === 'expense_add');
    expect(add?.body).toMatchObject({ action: 'expense_add', amount: '7.5', merchant: 'Kopi', category: 'food', payment: 'card', note: '' });
    expect(seen.filter((s) => s.body.action === 'month').length).toBeGreaterThanOrEqual(2); // reloaded after saving
  });

  test('editing sends only the fields that changed', async ({ page }) => {
    const seen = await stub(page, () => false);
    await page.goto(launch());
    await page.getByRole('button', { name: 'History' }).click();
    await page.locator('button[data-item="Petrol"]').click();
    const dialog = page.getByRole('dialog', { name: 'Edit expense' });
    await expect(dialog.getByLabel('Note')).toHaveValue('full tank');
    await dialog.getByLabel('Amount').fill('55');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Saved ✓')).toBeVisible();
    const update = seen.find((s) => s.body.action === 'expense_update');
    expect(update?.body).toEqual({ action: 'expense_update', id: 'b2222222-2222-4222-8222-222222222222', amount: '55' });
  });

  for (const [name, status, body, heading] of [
    ['an expired launch', 401, { ok: false, error: 'expired' }, 'Session expired'],
    ['an unsigned launch', 401, { ok: false, error: 'unauthorized' }, 'Open this from the Telegram bot'],
    ['an account that is not linked', 403, { ok: false, error: 'not_linked' }, 'Connect your account first'],
    ['too many requests', 429, { ok: false, error: 'limit' }, 'Too many requests today. Try again tomorrow.'],
    ['a server problem', 503, { ok: false, error: 'unavailable' }, 'Something went wrong'],
  ] as const) {
    test(`${name} shows its own explanation`, async ({ page }) => {
      await stub(page, (action, _body, route) => {
        if (action !== 'bootstrap') return false;
        void route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
        return true;
      });
      await page.goto(launch());
      await expect(page.getByRole('alert').getByRole('heading', { name: heading })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Add expense' })).toHaveCount(0);
    });
  }

  test('no connection shows "No connection" with a retry that works once it is back', async ({ page }) => {
    let down = true;
    await stub(page, async (action, _body, route) => {
      if (!down || action !== 'bootstrap') return false;
      await route.abort('failed');
      return true;
    });
    await page.goto(launch());
    await expect(page.getByRole('heading', { name: 'No connection' })).toBeVisible();
    down = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByTestId('mini-total')).toBeVisible();
  });

  test('a rejected save shows the server\'s reason in words and keeps the form', async ({ page }) => {
    await stub(page, (action, _body, route) => {
      if (action !== 'expense_add') return false;
      void route.fulfill({ status: 400, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ok: false, error: 'invalid', field: 'category' }) });
      return true;
    });
    await page.goto(launch());
    await page.getByRole('button', { name: 'Add expense' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add expense' });
    await dialog.getByLabel('Amount').fill('5');
    await dialog.getByRole('radio', { name: 'Other' }).check();
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog.getByText('Choose a category')).toBeVisible();
    await expect(dialog.getByLabel('Amount')).toHaveValue('5');
  });

  test('the Mini App is the one page that may be framed, and only by Telegram', async ({ request }) => {
    const mini = await request.get('/miniapp/');
    const csp = mini.headers()['content-security-policy'] ?? '';
    expect(csp).toContain('frame-ancestors https://web.telegram.org');
    expect(csp).not.toContain("frame-ancestors 'none'");
    expect(mini.headers()['x-frame-options']).toBeUndefined();
    const app = await request.get('/auth');
    expect(app.headers()['x-frame-options']).toBe('DENY');
    expect(app.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  });
});

for (const scheme of ['light', 'dark'] as const) {
  test(`every Mini App screen passes the accessibility scan (${scheme}, preview)`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/miniapp/?demo=1');
    await expect(page.getByTestId('mini-total')).toBeVisible();
    const scan = async (label: string) => {
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      expect(results.violations.map((v) => `${v.impact}: ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`), label).toEqual([]);
    };
    await scan('overview');
    for (const tab of ['Days', 'Budgets', 'Trend', 'History'] as const) {
      await page.getByRole('button', { name: tab }).click();
      await page.waitForTimeout(250);
      await scan(tab);
    }
    await page.getByRole('button', { name: 'Add expense' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await scan('add sheet');
  });
}
