// SP-12: the split page: read a receipt, tick what is yours, check the figures, and take the share to an expense. Every receipt here is invented.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { BACKEND } from './api';
import { dbRows, signInAs } from './helpers';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const GOOD = 'KEDAI SEDAP\nNasi lemak ayam 12.00\n Disc 30% -3.60\nTeh tarik 3.50\n2 x Roti canai 2.50 5.00\nSubtotal 16.90\nService charge 10% 1.69\nSST 6% 1.01\nTOTAL 19.60\nCash 20.00';
const MISREAD = 'Nasi lemak ayam 12.50\nTeh tarik 3.50\nRoti canai 2 x 2.50 5.60\nSubtotal 21.00\nService charge 10% 2.10\nSST 6% 1.26\nRounding -0.01\nTotal 24.35';

async function open(page: Page, ocrText: string) {
  const user = await signInAs(page);
  await page.request.post(`${BACKEND}/__test/ocr`, { data: { email: user.email, text: ocrText } });
  await page.goto('/app/split');
  await expect(page.getByRole('heading', { level: 1, name: 'Split a receipt' })).toBeVisible();
  return user;
}
const scan = async (page: Page) => page.getByTestId('split-file').setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: PNG });

test('a scanned receipt shows its lines with original prices and discounts, and says that every figure adds up', async ({ page }) => {
  await open(page, GOOD);
  await expect(page.getByText('No items yet')).toBeVisible();
  await scan(page);
  await expect(page.getByTestId('split-line')).toHaveCount(3);
  await expect(page.getByLabel('Original price (RM): Nasi lemak ayam')).toHaveValue('12.00');
  await expect(page.getByLabel('Discount (RM): Nasi lemak ayam')).toHaveValue('3.60');
  await expect(page.getByTestId('split-net').first()).toContainText('RM 8.40'); // after its own 30%
  await expect(page.getByLabel('Item 3')).toHaveValue('Roti canai');
  await expect(page.getByLabel('Qty: Roti canai')).toHaveValue('2');
  const status = page.getByTestId('split-status');
  await expect(status).toHaveAttribute('data-status', 'verified');
  await expect(status).toContainText('Checked: every figure adds up');
});

test('ticking an item gives its share of the service charge and SST, the rest goes to everyone else, and the total never changes', async ({ page }) => {
  const user = await open(page, GOOD);
  await scan(page);
  await expect(page.getByTestId('split-line')).toHaveCount(3);
  await expect(page.getByTestId('split-summary')).toContainText('Tick the items that are yours');
  await expect(page.getByTestId('split-use')).toBeDisabled();
  await page.getByLabel('Mine: Nasi lemak ayam').check();
  await expect(page.getByTestId('split-mine')).toHaveText('RM 9.74');
  await expect(page.getByTestId('split-others')).toHaveText('RM 9.86');
  await expect(page.getByTestId('split-whole')).toHaveText('RM 19.60');
  const summary = page.getByTestId('split-summary');
  await expect(summary).toContainText('Item discounts');
  await expect(summary).toContainText('Your part of the service charge');
  await expect(summary).toContainText('Your part of SST');
  await page.getByLabel('Mine: Teh tarik').check();
  await expect(page.getByTestId('split-mine')).toHaveText('RM 13.80'); // 8.40 + 3.50, with 11.90 of the 16.90 shared charges: 1.19 service and 0.71 SST
  await expect(page.getByTestId('split-others')).toHaveText('RM 5.80');
  await page.getByRole('button', { name: 'Tick all' }).click();
  await expect(page.getByTestId('split-mine')).toHaveText('RM 19.60');
  await expect(page.getByTestId('split-others')).toHaveText('RM 0.00');

  // take one item to an expense: the amount is my share, with a note saying where it came from
  await page.getByRole('button', { name: 'Clear' }).click();
  await page.getByLabel('Mine: Nasi lemak ayam').check();
  await page.getByTestId('split-use').click();
  await expect(page.getByLabel('Amount (RM)')).toHaveValue('9.74');
  await expect(page.getByLabel('Note (optional)')).toHaveValue('My share of a RM 19.60 receipt (1 of 3 items)');
  await page.getByRole('radio', { name: 'Food', exact: true }).check();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved').first()).toBeVisible();
  const rows = await dbRows(page, user.email, 'expenses');
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ amount: '9.74', category: 'food' });
});

test('a misread amount makes the badge say "check", points at the line, and one tap on the clear fix makes everything add up', async ({ page }) => {
  await open(page, MISREAD);
  await scan(page);
  const status = page.getByTestId('split-status');
  await expect(status).toHaveAttribute('data-status', 'check');
  await expect(status).toContainText('Quantity times price does not match the amount for: Roti canai');
  await expect(status).toContainText('The items add up to RM 21.60, but the receipt says RM 21.00');
  await expect(page.getByTestId('split-line').nth(2)).toHaveClass(/bad/);
  await expect(page.getByTestId('split-fix')).toContainText('Did you mean RM 5.00 for Roti canai? It is RM 5.60 now.');
  await page.getByRole('button', { name: 'Use RM 5.00' }).click();
  await expect(page.getByLabel('Original price (RM): Roti canai')).toHaveValue('5.00');
  await expect(status).toHaveAttribute('data-status', 'verified');
  await expect(page.getByTestId('split-fix')).toHaveCount(0);
});

test('typing a receipt in: a number pad only, an item with 30% off, and the charges worked out on what is left', async ({ page }) => {
  await open(page, '');
  await page.getByTestId('split-type').click();
  const price = page.getByLabel('Original price (RM): 1');
  await price.fill('abc100.0x0');
  await expect(price).toHaveValue('100.00');
  await page.getByLabel('Item 1').fill('Jacket');
  await page.getByLabel('Discount (RM): Jacket').fill('30');
  await page.getByLabel('Mine: Jacket').check();
  await expect(page.getByTestId('split-net').first()).toContainText('RM 70.00');
  await expect(page.getByTestId('split-mine')).toHaveText('RM 70.00');
  await page.getByLabel('Service charge rate (%)').fill('10');
  await page.getByLabel('SST rate (%)').fill('6');
  await expect(page.getByTestId('split-mine')).toHaveText('RM 81.20'); // 70.00 + 7.00 + 4.20
  await page.getByRole('button', { name: 'Add an item' }).click();
  await page.getByLabel('Item 2').fill('Socks');
  await page.getByLabel('Original price (RM): Socks').fill('10');
  await expect(page.getByTestId('split-whole')).toHaveText('RM 92.80'); // 80.00 + 8.00 service + 4.80 SST
  await expect(page.getByTestId('split-mine')).toHaveText('RM 81.20'); // Socks is not mine
  await expect(page.getByTestId('split-others')).toHaveText('RM 11.60'); // 10.00 + 1.00 + 0.60
  await page.getByRole('button', { name: 'Remove Socks' }).click();
  await expect(page.getByTestId('split-line')).toHaveCount(1);
  await page.getByLabel('Total on the receipt (RM)', { exact: true }).fill('81.20');
  await expect(page.getByTestId('split-status')).toHaveAttribute('data-status', 'verified');
});

test('a receipt with no items says so, and lets you add them yourself', async ({ page }) => {
  await open(page, 'hello this is not a receipt');
  await scan(page);
  await expect(page.getByText('No items were found on this receipt')).toBeVisible();
  await page.getByTestId('split-type').click();
  await expect(page.getByTestId('split-line')).toHaveCount(1);
});

test('the Add sheet has a "Need to split the bill?" link, and a receipt scanned there is picked up without a second upload', async ({ page }) => {
  await open(page, GOOD);
  await page.goto('/app');
  await expect(page.getByRole('heading', { level: 1, name: /^Hello,/ })).toBeVisible();
  await page.getByRole('button', { name: 'Add a transaction' }).first().click();
  await page.getByTestId('receipt-file').setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByLabel('Amount (RM)')).toHaveValue('19.60', { timeout: 15_000 });
  await page.getByTestId('split-link').click();
  await expect(page).toHaveURL(/\/app\/split$/);
  await page.getByTestId('split-last').click();
  await expect(page.getByTestId('split-line')).toHaveCount(3);
  await expect(page.getByTestId('split-status')).toHaveAttribute('data-status', 'verified');
});

test('the page speaks Malay and Chinese', async ({ page }) => {
  await signInAs(page);
  await page.addInitScript(() => localStorage.setItem('ve_lang', 'ms'));
  await page.goto('/app/split');
  await expect(page.getByRole('heading', { level: 1, name: 'Bahagi resit' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Imbas atau muat naik resit' })).toBeVisible();
  await page.addInitScript(() => localStorage.setItem('ve_lang', 'zh'));
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: '分摊收据' })).toBeVisible();
  await expect(page.getByRole('button', { name: '手动输入收据' })).toBeVisible();
});

for (const [scheme, width] of [['light', 390], ['dark', 390], ['light', 1280]] as const) {
  test(`with a receipt on it the page passes the accessibility scan (${scheme}, ${width}px) and fits a 320px phone`, async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: scheme, viewport: { width, height: 800 } });
    const page = await context.newPage();
    await open(page, GOOD);
    await scan(page);
    await page.getByLabel('Mine: Teh tarik').check();
    await expect(page.getByTestId('split-mine')).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(results.violations.map((v) => `${v.impact}: ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
    await page.setViewportSize({ width: 320, height: 640 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await context.close();
  });
}

// ---- the photo beside the table

/** A 600 x 800 white picture (a real size, so marks on it can be placed). */
async function bigPicture(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 800;
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 600, 800);
    return canvas.toDataURL('image/png').split(',')[1] as string;
  });
  return Buffer.from(base64, 'base64');
}

/** Word positions for a receipt's rows: the words from the left, the last amount on the right. */
function wordsFor(text: string) {
  const words: { t: string; x: number; y: number; w: number; h: number }[] = [];
  text.split('\n').forEach((row, i) => {
    const tokens = row.trim().split(/\s+/).filter(Boolean);
    let x = 40;
    tokens.forEach((token, k) => {
      const isAmount = k === tokens.length - 1 && /^-?\d+\.\d{2}$/.test(token);
      const w = token.length * 14;
      words.push({ t: token, x: isAmount ? 440 : x, y: 60 + i * 40, w, h: 24 });
      if (!isAmount) x += w + 12;
    });
  });
  return words;
}

async function openWithPhoto(page: Page, text: string, withWords = true) {
  const user = await signInAs(page);
  await page.request.post(`${BACKEND}/__test/ocr`, { data: { email: user.email, text, words: withWords ? wordsFor(text) : [] } });
  await page.goto('/app/split');
  await expect(page.getByRole('heading', { level: 1, name: 'Split a receipt' })).toBeVisible();
  await page.getByTestId('split-file').setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: await bigPicture(page) });
  await expect(page.getByTestId('split-line').first()).toBeVisible();
  return user;
}

test.describe('the photo beside the table', () => {
  test('on a wide screen the photo is on the left and the table on the right, side by side', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openWithPhoto(page, GOOD);
    const photo = await page.getByTestId('split-photo').boundingBox();
    const line = await page.getByTestId('split-line').first().boundingBox();
    expect(photo && line && photo.x + photo.width <= line.x + 1, 'photo left of the table').toBe(true);
    await expect(page.getByTestId('split-photo-toggle')).toBeHidden(); // the hide button is for phones
  });

  test('choosing a row marks where it sits on the photo, and the mark follows the row you choose', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openWithPhoto(page, GOOD);
    await expect(page.getByTestId('split-mark-active')).toHaveCount(0);
    await page.getByLabel('Item 2').focus();
    const first = page.getByTestId('split-mark-active');
    await expect(first).toHaveCount(1);
    await expect(first).toHaveAttribute('data-line', 'l2');
    await page.getByLabel('Item 3').focus();
    await expect(page.getByTestId('split-mark-active')).toHaveAttribute('data-line', 'l3');
    await expect(page.getByTestId('split-line').nth(2)).toHaveAttribute('data-active', 'true');
  });

  test('a row that does not add up is outlined on the photo too, and the outline goes when it is fixed', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openWithPhoto(page, MISREAD);
    await expect(page.getByTestId('split-status')).toHaveAttribute('data-status', 'check');
    const bad = page.getByTestId('split-mark-bad');
    await expect(bad).toHaveCount(1);
    await expect(bad).toHaveAttribute('data-line', 'l3');
    await page.getByRole('button', { name: 'Use RM 5.00' }).click();
    await expect(page.getByTestId('split-mark-bad')).toHaveCount(0);
  });

  test('zooming the photo makes it bigger and Fit brings it back', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openWithPhoto(page, GOOD);
    const fitted = (await page.getByTestId('split-photo').boundingBox())?.width ?? 0;
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await expect.poll(async () => (await page.getByTestId('split-photo').boundingBox())?.width ?? 0).toBeGreaterThan(fitted * 1.8);
    await page.getByRole('button', { name: 'Fit' }).click();
    await expect.poll(async () => Math.round((await page.getByTestId('split-photo').boundingBox())?.width ?? 0)).toBe(Math.round(fitted));
  });

  test('on a phone the photo is a card above the table: hide it, show it, or enlarge it', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await openWithPhoto(page, GOOD);
    const toggle = page.getByTestId('split-photo-toggle');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const photo = await page.getByTestId('split-photo').boundingBox();
    const line = await page.getByTestId('split-line').first().boundingBox();
    expect(photo && line && photo.y + photo.height <= line.y + 1, 'photo above the table').toBe(true);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('split-photo')).toBeHidden();
    await toggle.click();
    await expect(page.getByTestId('split-photo')).toBeVisible();
    await page.getByTestId('split-photo-enlarge').click();
    const dialog = page.getByRole('dialog', { name: 'Receipt photo' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('split-photo')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('a reading with no word positions still shows the photo, and says why rows are not marked', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openWithPhoto(page, GOOD, false);
    await expect(page.getByTestId('split-photo')).toBeVisible();
    await expect(page.getByText('This reading has no word positions')).toBeVisible();
    await page.getByLabel('Item 2').focus();
    await expect(page.getByTestId('split-mark-active')).toHaveCount(0);
  });

  test('a typed receipt has no photo card, and the table uses the full width', async ({ page }) => {
    await signInAs(page);
    await page.goto('/app/split');
    await page.getByTestId('split-type').click();
    await expect(page.getByTestId('split-line')).toHaveCount(1);
    await expect(page.getByTestId('split-photo-card')).toHaveCount(0);
  });

  test('the photo and its marks pass the accessibility scan on a computer and a phone, light and dark', async ({ browser }) => {
    test.setTimeout(120_000);
    for (const [scheme, width] of [['light', 1280], ['dark', 1280], ['light', 390], ['dark', 390]] as const) {
      const context = await browser.newContext({ colorScheme: scheme, viewport: { width, height: 900 } });
      const page = await context.newPage();
      await openWithPhoto(page, MISREAD);
      await page.getByLabel('Item 1').focus();
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
      expect(results.violations.map((v) => `${v.impact}: ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`), `${scheme} ${width}`).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `no sideways scroll ${width}`).toBeLessThanOrEqual(0);
      await context.close();
    }
  });
});

test.describe('reading again on this device', () => {
  test('the button is not offered when the bill already checks out', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openWithPhoto(page, GOOD);
    await expect(page.getByTestId('split-status')).toHaveAttribute('data-status', 'verified');
    await expect(page.getByTestId('split-again')).toHaveCount(0);
  });

  test('when the bill does not check out the button reads the photo on the device and leaves the rows alone if nothing is better', async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    await openWithPhoto(page, MISREAD);
    await expect(page.getByTestId('split-status')).toHaveAttribute('data-status', 'check');
    const before = await page.getByTestId('split-line').count();
    await page.getByTestId('split-again').click();
    await expect(page.getByTestId('split-again-result')).toBeVisible({ timeout: 150_000 });
    await expect(page.getByTestId('split-again-result')).toContainText('not better'); // a blank picture has nothing more to read
    await expect(page.getByTestId('split-line')).toHaveCount(before);
    await expect(page.getByTestId('split-status')).toHaveAttribute('data-status', 'check');
    await expect(page.getByTestId('split-again')).toBeEnabled();
  });
});

const DATED = GOOD.replace('KEDAI SEDAP\n', 'KEDAI SEDAP\nDate: 25/11/2026 13:05\n');

test.describe('the four areas on the photo', () => {
  test('the shop, date, items and total each get a labelled box, and the legend hides and shows them', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openWithPhoto(page, DATED);
    for (const key of ['merchant', 'date', 'items', 'total']) await expect(page.getByTestId('split-region-' + key), key).toHaveCount(1);
    await expect(page.getByTestId('split-region-total')).toContainText('Total');
    await expect(page.getByTestId('split-area-total')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('split-area-total').click();
    await expect(page.getByTestId('split-area-total')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('split-region-total')).toHaveCount(0);
    await expect(page.getByTestId('split-region-items')).toHaveCount(1);
    await page.getByTestId('split-area-total').click();
    await expect(page.getByTestId('split-region-total')).toHaveCount(1);
  });

  test('a reading with no word positions shows no areas and no legend', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openWithPhoto(page, GOOD, false);
    await expect(page.getByTestId('split-region-items')).toHaveCount(0);
    await expect(page.getByTestId('split-area-items')).toHaveCount(0);
  });
});
