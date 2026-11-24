// PERF-01: the first download for each entry screen stays within the budget (JavaScript, compressed).
import { gzipSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';
import { signInAs } from './helpers';

const BUDGET_KB = 200;

async function gzippedJs(page: Page, path: string): Promise<{ kb: number; files: string[] }> {
  const sizes = new Map<string, number>();
  page.on('response', async (response) => {
    if (!/\.js(\?|$)/.test(response.url()) || !response.ok()) return;
    try {
      sizes.set(response.url(), gzipSync(await response.body()).length);
    } catch {
      /* a response that was cancelled is not part of the first download */
    }
  });
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  const total = [...sizes.values()].reduce((sum, n) => sum + n, 0);
  return { kb: total / 1024, files: [...sizes.keys()].map((url) => url.split('/').pop() ?? url) };
}

test(`the sign-in page downloads at most ${BUDGET_KB} KB of JavaScript (compressed)`, async ({ page }) => {
  const result = await gzippedJs(page, '/auth');
  console.log(`sign-in: ${result.kb.toFixed(1)} KB gzip in ${result.files.length} files`, result.files.join(' '));
  expect(result.kb).toBeLessThanOrEqual(BUDGET_KB);
});

test(`the signed-in app downloads at most ${BUDGET_KB} KB of JavaScript (compressed) for its first screen`, async ({ page }) => {
  await signInAs(page);
  const result = await gzippedJs(page, '/app');
  console.log(`app: ${result.kb.toFixed(1)} KB gzip in ${result.files.length} files`, result.files.join(' '));
  expect(result.kb).toBeLessThanOrEqual(BUDGET_KB);
});

test('built files are cached for a year and the page itself is never cached', async ({ request }) => {
  const html = await (await request.get('/auth')).text();
  const asset = /\/assets\/[^"]+\.js/.exec(html)?.[0];
  expect(asset).toBeTruthy();
  expect((await request.get(asset as string)).headers()['cache-control']).toContain('immutable');
  expect((await request.get('/index.html')).headers()['cache-control']).toBe('no-cache');
});
