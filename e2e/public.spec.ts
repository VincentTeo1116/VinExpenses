// PU-02: the welcome page, Privacy Policy and Terms of Use: served, readable, accessible, and linked from the sign-in page.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { HEIGHTS, WIDTHS } from './helpers';

const PAGES = [
  { path: '/', heading: 'Know where your money goes' },
  { path: '/welcome', heading: 'Know where your money goes' },
  { path: '/privacy', heading: 'Privacy Policy' },
  { path: '/terms', heading: 'Terms of Use' },
  { path: '/fd-calculator', heading: 'Fixed deposit calculator' },
  { path: '/loan-calculator', heading: 'Loan calculator' },
];

test('the public pages are served with the security headers and their own content', async ({ request, page }) => {
  for (const item of PAGES) {
    const response = await request.get(item.path);
    expect(response.status(), item.path).toBe(200);
    expect(response.headers()['content-security-policy'], item.path).toContain("default-src 'none'");
    expect(response.headers()['x-frame-options'], item.path).toBe('DENY');
    await page.goto(item.path);
    await expect(page.locator('h1').first()).toContainText(item.heading);
    await expect(page.getByRole('link', { name: 'Open the app' }).first()).toHaveAttribute('href', '/app');
  }
});

test('the sign-in page links to the terms and the privacy policy, and they open', async ({ page }) => {
  await page.goto('/auth');
  await page.getByRole('link', { name: 'Terms of Use' }).click();
  await expect(page).toHaveURL(/\/terms$/);
  await expect(page.locator('h1').first()).toContainText('Terms of Use');
  await page.goto('/auth');
  await page.getByRole('link', { name: 'Privacy Policy' }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.locator('h1').first()).toContainText('Privacy Policy');
});

test('the policy names no host or service the app does not use, and loads nothing from other sites', async ({ page }) => {
  const outside: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).hostname !== '127.0.0.1') outside.push(request.url());
  });
  for (const item of PAGES) await page.goto(item.path);
  expect(outside).toEqual([]);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the public pages pass the accessibility scan (${scheme})`, async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: scheme, viewport: { width: 390, height: 800 } });
    const page = await context.newPage();
    for (const item of PAGES) {
      await page.goto(item.path);
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
      expect(results.violations.map((v) => `${v.impact}: ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`), `${item.path} ${scheme}`).toEqual([]);
    }
    await context.close();
  });
}

for (const width of WIDTHS) {
  test(`the public pages do not scroll sideways at ${width}px`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height: HEIGHTS[width] ?? 800 } });
    const page = await context.newPage();
    for (const item of PAGES) {
      await page.goto(item.path);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `${item.path} at ${width}`).toBeLessThanOrEqual(0);
    }
    await page.screenshot({ path: `screenshots/public-${width}.png` });
    await context.close();
  });
}

test('search engines: the app and sign-in are sent with a no-index header, the public pages are not, and robots.txt agrees', async ({ request, page }) => {
  for (const path of ['/app', '/app/history', '/auth', '/email-action.html', '/email-action', '/miniapp/']) expect((await request.get(path)).headers()['x-robots-tag'], path).toMatch(/noindex/);
  for (const path of ['/', '/privacy', '/terms', '/fd-calculator', '/loan-calculator']) expect((await request.get(path)).headers()['x-robots-tag'], path).toBeUndefined();
  const robots = await (await request.get('/robots.txt')).text();
  expect(robots).toContain('Disallow: /app/');
  expect(robots).toContain('Allow: /privacy$');
  // the drawn page names itself as the address to list, and has a title and description of its own
  await page.goto('/privacy');
  await expect(page.locator('h1')).toContainText('Privacy Policy');
  expect(await page.locator('link[rel="canonical"]').getAttribute('href')).toMatch(/\/privacy$/);
  expect(await page.title()).toContain('Privacy Policy');
  expect(await page.locator('meta[name="robots"]').count()).toBe(0);
});

test('coming back from Google onto the front page goes on to sign-in (and so into the app), not the welcome page', async ({ page }) => {
  await page.goto('/?code=one-time-code-from-google');
  await expect(page).toHaveURL(/\/auth/);
  await expect(page.getByRole('heading', { level: 1 })).not.toContainText('Know where your money goes');
  // an ordinary visit to the front page is still the welcome page
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Know where your money goes');
});

test('the sitemap is plain, indented XML listing the public pages, and the browser can show it formatted (AN-02)', async ({ request, page }) => {
  const res = await request.get('/sitemap.xml');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('xml');
  // no page policy on this one data file: with it, the browser's own XML viewer cannot style itself and the sitemap looks like loose text
  expect(res.headers()['content-security-policy']).toBeUndefined();
  const xml = await res.text();
  expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www.sitemaps.org\/schemas\/sitemap\/0.9">\n {2}<url>\n {4}<loc>/);
  expect([...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => new URL(m[1] as string).pathname)).toEqual(['/', '/fd-calculator', '/loan-calculator', '/privacy', '/terms']);
  const problems: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
  await page.goto('/sitemap.xml');
  await expect(page.locator('#xml-viewer-style')).toHaveCount(1);
  expect(problems.filter((p) => /Content Security Policy/i.test(p))).toEqual([]);
});
