// SH-04: the bottom bar's gliding pill: it sits under the active tab, stretches across the gap while it moves, jumps when motion is reduced,
// hides when no tab is active, runs down the side rail on tablets, and stays put through a resize.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { cspViolations, seedRows, signInAs, watchProblems } from './helpers';

const now = new Date().toISOString();
const row = { amount: '42.50', category: 'food', payment: 'card', merchant: 'Lunch', note: null, created_at: now };
const BAR = 'nav[class*="tabbar"]';
const pill = (page: Page) => page.getByTestId('tab-indicator');
const activeTab = (page: Page) => page.locator(`${BAR} a[aria-current="page"]`);

async function openHome(page: Page) {
  const user = await signInAs(page);
  await seedRows(page, user.email, 'expenses', [row]);
  await page.goto('/app');
  await expect(page.getByTestId('split-card')).toBeVisible();
  await expect(pill(page)).not.toHaveAttribute('data-hidden', '');
}

/** The pill's centre against the active tab's centre, along the bar (across on a phone, down on a rail). */
async function offBy(page: Page, vertical = false): Promise<number> {
  const p = (await pill(page).boundingBox())!;
  const t = (await activeTab(page).boundingBox())!;
  return vertical ? Math.abs(p.y + p.height / 2 - (t.y + t.height / 2)) : Math.abs(p.x + p.width / 2 - (t.x + t.width / 2));
}

/** Clicks a tab and records the pill's size and place every frame for a second. */
async function glide(page: Page, label: string) {
  return page.evaluate(async (name) => {
    const bar = document.querySelector('nav[class*="tabbar"]') as HTMLElement;
    const el = document.querySelector('[data-testid="tab-indicator"]') as HTMLElement;
    const tab = Array.from(bar.querySelectorAll('a')).find((a) => a.textContent?.includes(name)) as HTMLElement;
    tab.click();
    const out: { x: number; y: number; w: number; h: number }[] = [];
    const end = performance.now() + 1000;
    while (performance.now() < end) {
      await new Promise((r) => requestAnimationFrame(r));
      const b = el.getBoundingClientRect();
      out.push({ x: b.x, y: b.y, w: b.width, h: b.height });
    }
    return out;
  }, label);
}

test.describe('the bottom bar indicator (SH-04)', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('on a phone the pill sits under the active tab, then stretches across the gap and settles under the new one', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await openHome(page);
    expect(await offBy(page)).toBeLessThanOrEqual(3);
    const frames = await glide(page, 'Plan'); // History is in between, and so is the + button
    const final = frames[frames.length - 1]!;
    expect(Math.max(...frames.map((f) => f.w)), 'the pill stretches while it moves').toBeGreaterThan(final.w + 30);
    await expect(activeTab(page)).toContainText('Plan');
    expect(await offBy(page)).toBeLessThanOrEqual(3);
    const bar = (await page.locator(BAR).boundingBox())!;
    for (const f of frames) {
      expect(f.x).toBeGreaterThanOrEqual(bar.x - 1);
      expect(f.x + f.w).toBeLessThanOrEqual(bar.x + bar.width + 1);
    }
  });

  test('changing tabs breaks no security rule: the pill moves with the browser animation API, not with inline styles in the page', async ({ page }) => {
    const problems = watchProblems(page);
    await page.setViewportSize({ width: 390, height: 800 });
    await openHome(page);
    for (const tab of ['History', 'Plan', 'Home']) {
      await page.locator(`${BAR} a:has-text("${tab}")`).click();
      await expect(activeTab(page)).toContainText(tab);
      await page.waitForTimeout(700);
    }
    expect(await cspViolations(page)).toEqual([]);
    expect(problems.filter((p) => !p.includes('Failed to load resource'))).toEqual([]);
  });

  test('with reduced motion the pill jumps straight to the new tab, with no stretching', async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 390, height: 800 } });
    const page = await context.newPage();
    await openHome(page);
    const frames = await glide(page, 'Plan');
    const final = frames[frames.length - 1]!;
    expect(Math.max(...frames.map((f) => f.w))).toBeLessThanOrEqual(final.w + 1);
    expect(await offBy(page)).toBeLessThanOrEqual(3);
    await context.close();
  });

  test('where no tab is active (the Split page on a phone) the pill hides, and comes back under the tab you choose', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await openHome(page);
    await page.getByTestId('split-card-link').click();
    await expect(page).toHaveURL(/\/app\/split$/);
    await expect(pill(page)).toHaveAttribute('data-hidden', '');
    await expect(pill(page)).toHaveCSS('opacity', '0');
    await page.locator(`${BAR} a:has-text("History")`).click();
    await expect(pill(page)).not.toHaveAttribute('data-hidden', '');
    await expect.poll(() => offBy(page)).toBeLessThanOrEqual(3);
  });

  test('on a tablet the same pill runs down the side rail', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await openHome(page);
    expect(await offBy(page, true)).toBeLessThanOrEqual(4);
    const before = (await pill(page).boundingBox())!;
    await page.locator(`${BAR} a:has-text("History")`).click();
    await expect(activeTab(page)).toContainText('History');
    await expect.poll(() => offBy(page, true)).toBeLessThanOrEqual(4);
    const after = (await pill(page).boundingBox())!;
    expect(after.y).toBeGreaterThan(before.y + 20);
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1);
  });

  test('turning the phone or shrinking the window keeps the pill under the active tab', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await openHome(page);
    await page.setViewportSize({ width: 320, height: 640 });
    await expect.poll(() => offBy(page)).toBeLessThanOrEqual(3);
    await page.setViewportSize({ width: 600, height: 400 });
    await expect.poll(() => offBy(page)).toBeLessThanOrEqual(3);
  });

  test('the bar passes the accessibility scan in light and dark, and the pill is hidden from screen readers', async ({ browser }) => {
    test.setTimeout(90_000);
    for (const scheme of ['light', 'dark'] as const) {
      const context = await browser.newContext({ colorScheme: scheme, viewport: { width: 390, height: 800 } });
      const page = await context.newPage();
      await openHome(page);
      await expect(pill(page)).toHaveAttribute('aria-hidden', 'true');
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
      expect(results.violations.map((v) => `${v.impact}: ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`), scheme).toEqual([]);
      await context.close();
    }
  });
});
