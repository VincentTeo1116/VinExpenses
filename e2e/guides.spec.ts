// The public guide pages (fixed deposit and loan calculators): the text is in the HTML before any script runs, the calculators agree with the
// app's maths, and the pages are listed for search engines.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('the HTML itself carries the title, address and readable text (search engines and link previews do not need to run the app)', async ({ request }) => {
  for (const [path, title, text] of [
    ['/fd-calculator', 'Fixed Deposit Calculator Malaysia', 'simple interest'],
    ['/loan-calculator', 'Loan Calculator Malaysia', 'reducing balance'],
  ] as const) {
    const html = await (await request.get(path)).text();
    expect(html, path).toContain(`<title>${title}`);
    expect(html, path).toMatch(new RegExp(`<link rel="canonical" href="[^"]*${path}"`));
    expect(html, path).toContain('<h1>');
    expect(html, path).toContain(text);
    expect(html, path).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>[^<]/i);
  }
});

test('the fixed deposit calculator gives the worked example from the page, and tells a bad entry from a good one', async ({ page }) => {
  await page.goto('/fd-calculator');
  await expect(page.locator('h1')).toContainText('Fixed deposit calculator');
  await page.getByLabel('Amount (RM)').fill('10,000');
  await page.getByLabel('Interest rate a year (%)').fill('3.5');
  await page.getByLabel('Tenure', { exact: true }).fill('365');
  await page.getByLabel('Tenure unit').selectOption('days');
  await expect(page.getByTestId('fd-interest')).toHaveText('RM 350.00');
  await expect(page.getByTestId('fd-total')).toHaveText('RM 10,350.00');
  await page.getByLabel('Interest is paid').selectOption('quarterly');
  await expect(page.getByText(/\d+ payments/)).toBeVisible();
  await page.getByLabel('Amount (RM)').fill('');
  await expect(page.getByTestId('fd-total')).toHaveText('–');
  await expect(page.getByText('Enter an amount, a rate and a tenure')).toBeVisible();
});

test('the loan calculator shows the monthly payment, and flat costs more than reducing balance', async ({ page }) => {
  await page.goto('/loan-calculator');
  await page.getByLabel('Loan amount (RM)').fill('100000');
  await page.getByLabel('Interest rate a year (%)').fill('4');
  await page.getByLabel('Years to repay').fill('5');
  const reducing = (await page.getByTestId('loan-payment').textContent()) ?? '';
  await page.getByLabel('The rate is').selectOption('flat');
  const flat = (await page.getByTestId('loan-payment').textContent()) ?? '';
  const value = (text: string) => Number(text.replace(/[^0-9.]/g, ''));
  expect(value(reducing)).toBeGreaterThan(0);
  expect(value(flat)).toBeGreaterThan(value(reducing));
});

test('the guides link to each other, from the footer too, and the sitemap lists them', async ({ page, request }) => {
  await page.goto('/fd-calculator');
  await page.getByRole('navigation', { name: 'More calculators' }).getByRole('link', { name: /Loan calculator/ }).click();
  await expect(page).toHaveURL(/\/loan-calculator$/);
  await page.getByRole('navigation', { name: 'Footer' }).getByRole('link', { name: 'FD calculator' }).click();
  await expect(page).toHaveURL(/\/fd-calculator$/);
  const sitemap = await (await request.get('/sitemap.xml')).text();
  expect(sitemap).toContain('/fd-calculator</loc>');
  expect(sitemap).toContain('/loan-calculator</loc>');
  expect(await (await request.get('/robots.txt')).text()).toContain('Allow: /fd-calculator$');
});

for (const path of ['/fd-calculator', '/loan-calculator']) {
  test(`${path} has no accessibility violations and does not scroll sideways on a phone`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto(path);
    await expect(page.locator('h1')).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });
}

test('the welcome page leads to both calculators, and the figures on the cards match the calculators', async ({ page }) => {
  await page.goto('/');
  const section = page.locator('#calculators');
  await expect(section.getByRole('heading', { name: 'Free calculators, no sign-up' })).toBeVisible();
  await page.goto('/loan-calculator');
  const payment = (await page.getByTestId('loan-payment').textContent()) ?? '';
  await page.goto('/');
  await expect(page.locator('#calculators')).toContainText(payment); // the sample on the card is what the calculator shows for the same loan
  await page.locator('#calculators').getByRole('link', { name: /Fixed deposit calculator/ }).click();
  await expect(page).toHaveURL(/\/fd-calculator$/);
  await page.goBack();
  await page.getByRole('link', { name: /full loan calculator/ }).click();
  await expect(page).toHaveURL(/\/loan-calculator$/);
});

test('every public page credits the author with a safe link to the portfolio', async ({ page }) => {
  for (const path of ['/', '/privacy', '/terms', '/fd-calculator', '/loan-calculator']) {
    await page.goto(path);
    const link = page.getByTestId('author-credit').first().getByRole('link');
    await expect(link, path).toHaveAttribute('href', 'https://vincent16.vercel.app');
    await expect(link, path).toHaveAttribute('target', '_blank');
    await expect(link, path).toHaveAttribute('rel', /noopener/);
    await expect(link, path).toHaveAttribute('rel', /noreferrer/);
  }
  await page.goto('/privacy');
  await expect(page.getByTestId('author-credit')).toHaveCount(2); // under the title and in the footer
});

test('the quick-pick buttons fill the fields', async ({ page }) => {
  await page.goto('/fd-calculator');
  await page.getByRole('group', { name: 'Quick amounts' }).getByRole('button', { name: 'RM 50,000' }).click();
  await page.getByRole('group', { name: 'Quick tenures' }).getByRole('button', { name: '6 months' }).click();
  await expect(page.getByLabel('Amount (RM)')).toHaveValue('50000');
  await expect(page.getByLabel('Tenure', { exact: true })).toHaveValue('6');
  await expect(page.getByRole('button', { name: '6 months' })).toHaveAttribute('aria-pressed', 'true');
});
