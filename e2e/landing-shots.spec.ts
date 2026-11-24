// Makes the pictures on the welcome page from the real app, with made-up sample data (never anyone's real records).
// Run on purpose:  SHOTS=1 npx playwright test e2e/landing-shots.spec.ts   (skipped otherwise). Output: public/landing/*.webp
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { isoDaysAgo, seedRows, signInAs, ymdDaysFromNow } from './helpers';

const OUT = path.join(__dirname, '..', 'public', 'landing');
test.skip(!process.env.SHOTS, 'only when making new pictures (SHOTS=1)');

async function save(page: Page, name: string, options: { clip?: { x: number; y: number; width: number; height: number } } = {}) {
  const png = await page.screenshot({ type: 'png', ...options });
  // turn the picture into a small webp using the browser itself (no image tool needed)
  const webp = await page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext('2d')?.drawImage(image, 0, 0);
    return canvas.toDataURL('image/webp', 0.86).split(',')[1] ?? '';
  }, png.toString('base64'));
  fs.writeFileSync(path.join(OUT, name), Buffer.from(webp, 'base64'));
}

async function sampleData(page: Page) {
  const user = await signInAs(page, { name: 'Aisyah' });
  const rows: Record<string, unknown>[] = [];
  const spend: [string, string, string, number][] = [
    ['food', 'Nasi lemak Wanjo', '9.50', 0], ['beverages', 'Tealive', '12.90', 0], ['car', 'Petronas', '60.00', 1], ['food', 'Village Park', '24.00', 1],
    ['shopping', 'Mydin', '86.40', 2], ['utilities', 'Unifi', '129.00', 3], ['food', 'Kopitiam Ah Heng', '15.50', 3], ['travel', 'Grab', '18.20', 4],
    ['entertain', 'GSC Cinemas', '42.00', 5], ['food', 'Sushi Zanmai', '78.00', 6], ['beverages', 'Starbucks', '17.50', 7], ['car', 'Touch n Go', '50.00', 8],
    ['shopping', 'Uniqlo', '149.90', 9], ['food', 'McDonald\'s', '22.40', 10], ['health', 'Watsons', '34.60', 11], ['utilities', 'TNB', '186.30', 12],
  ];
  for (const [category, merchant, amount, ago] of spend) rows.push({ amount, category, payment: 'card', merchant, note: null, created_at: isoDaysAgo(ago) });
  await seedRows(page, user.email, 'expenses', rows);
  await seedRows(page, user.email, 'incomes', [{ amount: '4800.00', source: 'Salary', created_at: isoDaysAgo(2) }]);
  await seedRows(page, user.email, 'budgets', [{ category: 'all', amount: '1800.00' }, { category: 'food', amount: '400.00' }]);
  await seedRows(page, user.email, 'recurring_expenses', [
    { name: 'Rent', amount: '1200.00', category: 'utilities', payment: 'bank', frequency: 'monthly', start_date: ymdDaysFromNow(5), next_due: ymdDaysFromNow(5) },
    { name: 'Netflix', amount: '55.00', category: 'entertain', payment: 'card', frequency: 'monthly', start_date: ymdDaysFromNow(9), next_due: ymdDaysFromNow(9) },
  ]);
  await seedRows(page, user.email, 'fixed_deposits', [{ name: 'Maybank 12-month FD', bank: 'Maybank', principal: 20000, rate: 3.85, start_date: ymdDaysFromNow(-120), tenure_value: 12, tenure_unit: 'months', maturity_date: ymdDaysFromNow(245), payout: 'maturity', tax_rate: 0, day_basis: 365, reminders_on: true, reminder_days: [7, 1, 0], status: 'open', interest_recorded: false }]);
  await page.request.post('http://127.0.0.1:54321/__test/telegram', { data: { email: user.email, linked: true } });
  return user;
}

async function context(browser: Browser, width: number, height: number, scheme: 'light' | 'dark', scale = 1) {
  return browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, colorScheme: scheme, reducedMotion: 'reduce' });
}

test('make the welcome page pictures', async ({ browser }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(OUT, { recursive: true });
  for (const scheme of ['light', 'dark'] as const) {
    const page = await (await context(browser, 1280, 800, scheme)).newPage();
    await sampleData(page);
    await page.goto('/app');
    await expect(page.getByTestId('spent')).toBeVisible();
    await page.waitForTimeout(800);
    await save(page, `dashboard-${scheme}.webp`);
    if (scheme === 'light') {
      await page.goto('/app/plan');
      await page.getByRole('tab', { name: 'Deposits' }).click();
      await page.getByLabel('Deposit amount (RM)').fill('50000');
      await page.getByLabel('Interest rate (% a year)').fill('3.85');
      await page.getByLabel('Interest is paid').selectOption('monthly');
      await expect(page.getByTestId('fd-result')).toBeVisible();
      await page.waitForTimeout(500);
      await save(page, 'plan-desktop.webp');
    }
  }
  // the loan calculator on a phone
  const phone = await (await context(browser, 390, 844, 'light', 2)).newPage();
  await sampleData(phone);
  await phone.goto('/app/plan');
  await phone.getByRole('tab', { name: 'Loans' }).click();
  await phone.getByLabel('Loan amount (RM)').fill('250000');
  await phone.getByLabel('Interest rate (% a year)').fill('4.2');
  await phone.getByLabel('Loan term', { exact: true }).fill('25');
  await expect(phone.getByTestId('ln-result')).toBeVisible();
  await phone.getByRole('heading', { name: 'Result' }).evaluate((el) => window.scrollBy(0, el.getBoundingClientRect().top - 70));
  await phone.waitForTimeout(500);
  await save(phone, 'plan-phone.webp');
  // the Telegram Mini App sample preview on a phone
  const mini = await (await context(browser, 390, 844, 'light', 2)).newPage();
  await mini.goto('/miniapp/?demo=1');
  await expect(mini.getByTestId('mini-total')).toBeVisible();
  await mini.waitForTimeout(600);
  await save(mini, 'miniapp-phone.webp');
});
