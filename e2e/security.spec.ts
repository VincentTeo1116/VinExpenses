// SEC-01..04 in a real browser: headers, policy violations, framing, and what the page contains.
import { expect, test } from '@playwright/test';
import { cspViolations, signInAs, watchProblems } from './helpers';

test('every page is sent with the full set of security headers', async ({ request }) => {
  for (const path of ['/app', '/auth', '/this-does-not-exist']) {
    const response = await request.get(path);
    const h = response.headers();
    expect(h['content-security-policy'], path).toContain("default-src 'none'");
    expect(h['content-security-policy'], path).toContain("frame-ancestors 'none'");
    expect(h['x-content-type-options'], path).toBe('nosniff');
    expect(h['x-frame-options'], path).toBe('DENY');
    expect(h['referrer-policy'], path).toBe('strict-origin-when-cross-origin');
    expect(h['strict-transport-security'], path).toContain('max-age=');
    expect(h['permissions-policy'], path).toContain('microphone=()');
    expect(h['cross-origin-opener-policy'], path).toBe('same-origin');
  }
});

test('the signed-in app runs with no policy violation, no console error and no inline code or styles', async ({ page }) => {
  const problems = watchProblems(page);
  await signInAs(page);
  await page.goto('/app');
  await expect(page.getByRole('heading', { level: 1, name: /^Hello,/ })).toBeVisible();
  await page.getByRole('button', { name: 'Add a transaction' }).first().click();
  await page.keyboard.press('Escape');
  await page.goto('/app/account');
  await page.getByLabel('Language').selectOption('zh');
  await expect(page.getByRole('dialog', { name: '账户' })).toBeVisible();

  expect(await cspViolations(page)).toEqual([]);
  expect(problems.filter((p) => !/Failed to load resource|net::ERR/.test(p))).toEqual([]);
  const inline = await page.evaluate(() => ({
    scripts: [...document.scripts].filter((s) => !s.src).length,
    styleAttributes: document.querySelectorAll('[style]').length,
    styleTags: document.querySelectorAll('style').length,
    handlers: [...document.querySelectorAll('*')].filter((el) => [...el.attributes].some((a) => /^on/i.test(a.name))).length,
  }));
  expect(inline).toEqual({ scripts: 0, styleAttributes: 0, styleTags: 0, handlers: 0 });
});

test('no private key or secret name is anywhere in the files the browser downloads', async ({ request }) => {
  const html = await (await request.get('/app')).text();
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1] as string);
  expect(assets.length).toBeGreaterThan(0);
  for (const asset of assets) {
    const body = await (await request.get(asset)).text();
    expect(body, asset).not.toMatch(/service_role|sbp_[A-Za-z0-9]{12,}|SMTP_PASS|TURNSTILE_SECRET|TELEGRAM_BOT_TOKEN|MONTHLY_REPORT_CRON_SECRET/);
  }
});

test('the app refuses to show itself inside another website', async ({ page }) => {
  await signInAs(page);
  await page.goto('/auth');
  await page.setContent('<iframe id="f" src="http://127.0.0.1:4173/app" width="600" height="400"></iframe>');
  await page.waitForTimeout(800);
  const frame = page.frames().find((f) => f !== page.mainFrame());
  const text = frame ? await frame.evaluate(() => document.body?.innerText ?? '').catch(() => '') : '';
  // either the browser blocked the frame (headers) or the page shows nothing of the app (script guard)
  expect(text).not.toMatch(/Home|History|Plan|Account/);
});

test('an old emailed link in the address bar is never read as a sign-in', async ({ page }) => {
  await page.goto('/auth#access_token=stolen.fake.token&refresh_token=x&type=recovery');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }));
  expect(stored).not.toContain('stolen.fake.token');
});

test('the app only talks to this computer in tests: nothing goes to any other address', async ({ page }) => {
  const outside: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.hostname !== '127.0.0.1') outside.push(request.url());
  });
  await signInAs(page);
  await page.goto('/app');
  await expect(page.getByRole('heading', { level: 1, name: /^Hello,/ })).toBeVisible();
  expect(outside).toEqual([]);
});
