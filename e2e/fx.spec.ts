// FX-01: a receipt in another currency is converted at the receipt day's rate, kept in the Note, and flagged to be checked.
import { expect, test, type Page } from '@playwright/test';
import { BACKEND } from './api';
import { signInAs } from './helpers';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function setup(page: Page, ocrText: string, fx: { rate?: number; mode?: 'ok' | 'down' | 'fallback' } = {}) {
  const user = await signInAs(page);
  await page.request.post(`${BACKEND}/__test/ocr`, { data: { email: user.email, text: ocrText } });
  await page.request.post(`${BACKEND}/__test/fx`, { data: { email: user.email, rate: fx.rate ?? 4, mode: fx.mode ?? 'ok' } });
  await page.goto('/app');
  await expect(page.getByRole('heading', { level: 1, name: /^Hello,/ })).toBeVisible();
  await page.getByRole('button', { name: 'Add a transaction' }).first().click();
  await page.getByTestId('receipt-file').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: PNG });
  return user;
}
const lastLookup = async (page: Page, email: string) => (await (await page.request.get(`${BACKEND}/__test/fx-last?email=${encodeURIComponent(email)}`)).json()) as { currency?: string; date?: string };

test.describe('receipts in another currency (FX-01)', () => {
  test('a USD receipt becomes ringgit at the rate of the receipt\'s own day, with the original in the Note and a check-it alert', async ({ page }) => {
    const user = await setup(page, 'SOME CAFE\nDate: 12/10/2026\nTOTAL USD 25.00\n', { rate: 4.2 });
    await expect(page.getByLabel('Amount (RM)')).toHaveValue('105.00', { timeout: 15_000 });
    await expect(page.getByLabel('Date')).toHaveValue('2026-10-12');
    await expect(page.getByLabel('Note (optional)')).toHaveValue('Original: USD 25.00 at 4.2000 (rate of 2026-10-12)');
    await expect(page.getByTestId('fx-alert')).toContainText('USD 25.00');
    await expect(page.getByTestId('fx-alert')).toContainText('check the amount against what you really paid in MYR');
    expect(await lastLookup(page, user.email)).toEqual({ currency: 'USD', date: '2026-10-12' }); // the receipt's day, not today
  });

  test('when the receipt day has no rate, today\'s rate is used and the alert says so', async ({ page }) => {
    await setup(page, 'SOME CAFE\nDate: 12/10/2026\nTOTAL USD 25.00\n', { rate: 4, mode: 'fallback' });
    await expect(page.getByLabel('Amount (RM)')).toHaveValue('100.00', { timeout: 15_000 });
    await expect(page.getByTestId('fx-alert')).toContainText('latest rate was used');
  });

  test('with no usable rate nothing is guessed: the amount stays empty and the person is asked for the ringgit amount', async ({ page }) => {
    await setup(page, 'SOME CAFE\nDate: 12/10/2026\nTOTAL USD 25.00\n', { mode: 'down' });
    await expect(page.getByTestId('fx-alert')).toContainText('enter the ringgit amount you really paid', { ignoreCase: true, timeout: 15_000 });
    await expect(page.getByLabel('Amount (RM)')).toHaveValue('');
  });

  test('a receipt with both ringgit and another currency uses the ringgit total and warns about the other', async ({ page }) => {
    const user = await setup(page, 'SOME CAFE\nDate: 12/10/2026\nSubtotal RM 90.00\nTOTAL RM 100.00\nUSD 22.50\n');
    await expect(page.getByLabel('Amount (RM)')).toHaveValue('100.00', { timeout: 15_000 });
    await expect(page.getByTestId('fx-alert')).toContainText('USD');
    expect(await lastLookup(page, user.email)).toEqual({}); // no conversion was needed
  });

  test('a bare dollar sign is never guessed: no lookup, the person is asked', async ({ page }) => {
    const user = await setup(page, 'SOME CAFE\nTOTAL $25.00\n');
    await expect(page.getByTestId('fx-alert')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel('Amount (RM)')).toHaveValue('');
    expect(await lastLookup(page, user.email)).toEqual({});
  });
});

test('the photo marks the total, the shop and the date, each in its own colour', async ({ page }) => {
  const user = await signInAs(page);
  const words = [
    { t: 'LACHER', x: 0, y: 0, w: 1, h: 1 }, { t: 'PATISSERIE', x: 0, y: 0, w: 1, h: 1 },
    { t: 'Date:', x: 0, y: 0, w: 1, h: 1 }, { t: '26/08/2026', x: 0, y: 0, w: 1, h: 1 },
    { t: 'TOTAL', x: 0, y: 0, w: 1, h: 1 }, { t: '12.00', x: 0, y: 0, w: 1, h: 1 },
  ];
  await page.request.post(`${BACKEND}/__test/ocr`, { data: { email: user.email, text: 'LACHER PATISSERIE\nDate: 26/08/2026\nTOTAL RM 12.00\n', words } });
  await page.goto('/app');
  await expect(page.getByRole('heading', { level: 1, name: /^Hello,/ })).toBeVisible();
  await page.getByRole('button', { name: 'Add a transaction' }).first().click();
  await page.getByTestId('receipt-file').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByLabel('Amount (RM)')).toHaveValue('12.00', { timeout: 15_000 });
  await expect(page.getByTestId('receipt-mark')).toHaveCount(3);
  const legend = page.getByTestId('receipt-preview');
  await expect(legend).toContainText('Total');
  await expect(legend).toContainText('Shop');
  await expect(legend).toContainText('Date');
});

test.describe('backup reader on the device (OCR-02)', () => {
  test.setTimeout(180_000);
  async function receiptPhoto(page: Page): Promise<Buffer> {
    const dataUrl = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 900;
      c.height = 520;
      const g = c.getContext('2d') as CanvasRenderingContext2D;
      g.fillStyle = '#fff';
      g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = '#000';
      g.font = 'bold 54px Arial';
      g.fillText('KEDAI MAKAN ABC', 40, 90);
      g.font = '44px Arial';
      g.fillText('Date: 12/10/2026', 40, 200);
      g.fillText('Nasi lemak 8.50', 40, 290);
      g.font = 'bold 56px Arial';
      g.fillText('TOTAL RM 12.50', 40, 420);
      return c.toDataURL('image/png');
    });
    return Buffer.from(dataUrl.split(',')[1] as string, 'base64');
  }

  test('when the online reader is down, the photo is read on the device and still fills the form', async ({ page }) => {
    const user = await signInAs(page);
    await page.request.post(`${BACKEND}/__test/ocr`, { data: { email: user.email, text: '', mode: 'off' } }); // the online reader answers "not available"
    await page.goto('/app');
    await expect(page.getByRole('heading', { level: 1, name: /^Hello,/ })).toBeVisible();
    await page.getByRole('button', { name: 'Add a transaction' }).first().click();
    const photo = await receiptPhoto(page);
    await page.getByTestId('receipt-file').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: photo });
    await expect(page.getByLabel('Amount (RM)')).toHaveValue('12.50', { timeout: 150_000 });
    await expect(page.getByLabel('Date')).toHaveValue('2026-10-12');
    await expect(page.getByTestId('receipt-preview')).toBeVisible();
  });

  test('a photo that is not readable at all still ends with a clear message, never a spinner', async ({ page }) => {
    const user = await signInAs(page);
    await page.request.post(`${BACKEND}/__test/ocr`, { data: { email: user.email, text: '', mode: 'off' } });
    await page.goto('/app');
    await expect(page.getByRole('heading', { level: 1, name: /^Hello,/ })).toBeVisible();
    await page.getByRole('button', { name: 'Add a transaction' }).first().click();
    await page.getByTestId('receipt-file').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: PNG }); // a 1-pixel picture
    await expect(page.getByTestId('scan-note')).not.toContainText('Reading', { timeout: 150_000 });
    await expect(page.getByLabel('Amount (RM)')).toHaveValue('');
  });
});
