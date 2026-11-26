// The breadcrumb and the footer of the public pages: what they show, how they react (hover, press, keyboard), and that they fit every screen.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const PAGES = ['/', '/fd-calculator', '/loan-calculator', '/privacy', '/terms'];
const SIZES = [
  { width: 320, height: 640 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
];

test('the breadcrumb is a trail: home is a link, the current page is not', async ({ page }) => {
  await page.goto('/loan-calculator');
  const trail = page.getByRole('navigation', { name: 'Breadcrumb' });
  const home = trail.getByRole('link', { name: 'VinExpenses' });
  await expect(home).toHaveAttribute('href', '/');
  await expect(trail.getByText('Loan calculator')).toHaveAttribute('aria-current', 'page');
  await expect(trail.getByRole('link')).toHaveCount(1);
  await home.click();
  await expect(page).toHaveURL(/\/$/);
});

test('the breadcrumb reacts to the pointer and stays on one line on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/fd-calculator');
  const home = page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link');
  const before = await home.evaluate((el) => getComputedStyle(el).borderColor);
  await home.hover();
  await expect.poll(() => home.evaluate((el) => getComputedStyle(el).borderColor)).not.toBe(before);
  const box = await home.boundingBox();
  expect(box?.height ?? 0, 'a tap target').toBeGreaterThanOrEqual(44);
  const heights = await page.getByRole('navigation', { name: 'Breadcrumb' }).locator('li').evaluateAll((items) => items.map((el) => Math.round(el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2)));
  expect(Math.max(...heights) - Math.min(...heights), 'every step on the same line').toBeLessThanOrEqual(2);
});

test('the footer groups its links, marks the page you are on, and reacts to hover, press and the keyboard', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'no-preference' }); // the suite runs with reduced motion on; this test wants the movement
  const page = await context.newPage();
  await page.goto('/fd-calculator');
  const footer = page.getByRole('navigation', { name: 'Footer' });
  for (const name of ['About', 'Open the app', 'FD calculator', 'Loan calculator', 'Privacy Policy', 'Terms of Use', 'Contact']) await expect(footer.getByRole('link', { name })).toBeVisible();
  await expect(footer.getByRole('link', { name: 'Contact' })).toHaveAttribute('href', /^mailto:/);
  const current = footer.getByRole('link', { name: 'FD calculator' });
  await expect(current).toHaveAttribute('aria-current', 'page');
  await expect(footer.locator('[aria-current="page"]')).toHaveCount(1);

  const other = footer.getByRole('link', { name: 'Privacy Policy' });
  const colour = await other.evaluate((el) => getComputedStyle(el).color);
  await other.hover();
  await expect.poll(() => other.evaluate((el) => getComputedStyle(el).color)).not.toBe(colour); // hover
  await expect.poll(() => other.evaluate((el) => getComputedStyle(el).transform)).not.toBe('none'); // it moves a little
  await page.mouse.move(0, 0);
  await other.focus();
  await page.keyboard.press('Tab');
  await expect(footer.getByRole('link', { name: 'Terms of Use' })).toBeFocused(); // reachable in order by keyboard
  // the focused link looks highlighted, like a hovered one (the colour of a link nobody is pointing at is `colour`)
  await expect.poll(() => footer.getByRole('link', { name: 'Terms of Use' }).evaluate((el) => getComputedStyle(el).color)).not.toBe(colour);

  await footer.getByRole('link', { name: 'Terms of Use' }).click();
  await expect(page).toHaveURL(/\/terms$/);
  await expect(page.getByRole('navigation', { name: 'Footer' }).getByRole('link', { name: 'Terms of Use' })).toHaveAttribute('aria-current', 'page');
  await context.close();
});

test('the footer links are big enough to tap on a phone and nothing is cut off', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/');
  const heights = await page.getByRole('navigation', { name: 'Footer' }).getByRole('link').evaluateAll((links) => links.map((el) => Math.round(el.getBoundingClientRect().height)));
  expect(Math.min(...heights)).toBeGreaterThanOrEqual(44);
  await page.getByRole('contentinfo').scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await expect(page.getByTestId('author-credit').last()).toBeVisible();
});

for (const size of SIZES) {
  test(`public pages fit a ${size.width}px screen: no sideways scroll, footer inside the screen`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: size });
    const page = await context.newPage();
    for (const path of PAGES) {
      await page.goto(path);
      await expect(page.locator('h1').first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `${path} at ${size.width}`).toBeLessThanOrEqual(0);
      const footer = await page.getByRole('contentinfo').boundingBox();
      expect((footer?.x ?? 0) + (footer?.width ?? 0), `${path} footer at ${size.width}`).toBeLessThanOrEqual(size.width + 1);
    }
    await context.close();
  });
}

for (const scheme of ['light', 'dark'] as const) {
  test(`the breadcrumb and footer pass the accessibility scan (${scheme}) on a phone and a computer`, async ({ browser }) => {
    for (const size of [SIZES[1] as (typeof SIZES)[number], SIZES[4] as (typeof SIZES)[number]]) {
      const context = await browser.newContext({ viewport: size, colorScheme: scheme });
      const page = await context.newPage();
      for (const path of ['/fd-calculator', '/loan-calculator', '/terms']) {
        await page.goto(path);
        await expect(page.getByRole('contentinfo')).toBeVisible();
        const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
        expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`), `${path} ${scheme} ${size.width}`).toEqual([]);
      }
      await context.close();
    }
  });
}

test('with reduced motion the footer links do not slide', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto('/privacy');
  const link = page.getByRole('navigation', { name: 'Footer' }).getByRole('link', { name: 'Terms of Use' });
  await link.hover();
  expect(await link.evaluate((el) => getComputedStyle(el).transform)).toBe('none');
  await context.close();
});

test('the welcome page shows "coming soon" badges for both stores, and they are not links', async ({ page }) => {
  await page.goto('/');
  const badges = page.getByTestId('store-badges');
  await expect(badges).toHaveCount(2); // one near the top, one at the end
  for (const group of await badges.all()) {
    await expect(group.getByText('Google Play')).toBeVisible();
    await expect(group.getByText('App Store')).toBeVisible();
    await expect(group.getByText('Coming soon')).toHaveCount(2);
    await expect(group.getByRole('link')).toHaveCount(0);
  }
});

for (const width of [1024, 1280, 1440, 1920]) {
  test(`on a ${width}px screen the store badges end on the same line as the demo picture`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const image = await page.locator('img[alt^="The VinExpenses home screen"]').first().boundingBox();
    const badges = await page.getByTestId('store-badges').first().boundingBox();
    expect(Math.abs((badges?.y ?? 0) + (badges?.height ?? 0) - ((image?.y ?? 0) + (image?.height ?? 0))), 'bottom edges, in px (the picture floats a few px)').toBeLessThanOrEqual(12);
  });
}

test('on a phone the two store badges sit side by side inside the screen', async ({ page }) => {
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/');
    await expect(page.getByTestId('store-badges').first().getByRole('listitem')).toHaveCount(2);
    const [a, b] = await page.getByTestId('store-badges').first().getByRole('listitem').all();
    const first = await a?.boundingBox();
    const second = await b?.boundingBox();
    expect(Math.abs((first?.y ?? 0) - (second?.y ?? 99)), `one row at ${width}`).toBeLessThanOrEqual(1);
    expect((second?.x ?? 0) + (second?.width ?? 0), `inside the screen at ${width}`).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  }
});
