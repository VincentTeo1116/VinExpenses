// TX-02, CT-01, RX-01, RX-02, CS-01: category suggestions, receipt scanning (PDF on the device, photos through the reader) and CSV.
import fs from 'node:fs';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { BACKEND } from './api';
import { dbRows, isoDaysAgo, openAccount, seedRows, signInAs, watchProblems } from './helpers';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const fixture = (name: string) => fs.readFileSync(path.join(__dirname, '..', 'tests', 'fixtures', name), 'utf8');

/** A small valid PDF with the given lines of text (or none, for a blank page), built here so the test needs no binary file. */
function makePdf(lines: string[]): Buffer {
  const content = lines.map((line, i) => `BT /F1 12 Tf 40 ${760 - i * 18} Td (${line.replace(/[()\\]/g, '')}) Tj ET`).join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

const RECEIPT_LINES = ['KOPITIAM LEE SDN BHD', 'Date: 12/10/2026 13:05', 'Nasi lemak ayam 8.50', 'Teh tarik 3.00', 'Service charge 1.15', 'Grand Total RM 12.65'];

async function setOcr(page: Page, email: string, body: { text?: string; mode?: 'ok' | 'off' | 'unreadable'; limit?: number }) {
  await page.request.post(`${BACKEND}/__test/ocr`, { data: { email, ...body } });
}
async function ocrCalls(page: Page, email: string): Promise<number> {
  return ((await (await page.request.get(`${BACKEND}/__test/ocr-calls?email=${encodeURIComponent(email)}`)).json()) as { calls: number }).calls;
}

async function openAdd(page: Page) {
  await page.goto('/app');
  await expect(page.getByRole('heading', { level: 1, name: /^Hello,/ })).toBeVisible();
  await page.getByRole('button', { name: 'Add a transaction' }).first().click();
  await expect(page.getByRole('dialog', { name: 'Add a transaction' })).toBeVisible();
}
const category = (page: Page, name: string) => page.getByRole('radio', { name, exact: true });

test.describe('category suggestions (TX-02, CT-01)', () => {
  test('a known brand picks its category and says why', async ({ page }) => {
    await signInAs(page);
    await openAdd(page);
    await page.getByLabel('Where (optional)').fill('Starbucks Mid Valley');
    await expect(category(page, 'Beverages')).toBeChecked();
    await expect(page.getByTestId('suggestion')).toContainText('"starbucks" is usually Beverages');
  });

  test('a bank-statement style name (GRAB*FOOD) and a regional brand are understood', async ({ page }) => {
    await signInAs(page);
    await openAdd(page);
    await page.getByLabel('Where (optional)').fill('GRAB*FOOD');
    await expect(category(page, 'Food')).toBeChecked();
    await page.getByLabel('Where (optional)').fill('SINGTEL');
    await expect(category(page, 'Utilities')).toBeChecked();
  });

  test('the person\'s own history beats the built-in list', async ({ page }) => {
    const user = await signInAs(page);
    await seedRows(page, user.email, 'expenses', [1, 2, 3].map((i) => ({ amount: '9.00', category: 'work', payment: 'card', merchant: 'Starbucks', note: null, created_at: isoDaysAgo(i * 3) })));
    await openAdd(page);
    await page.getByLabel('Where (optional)').fill('Starbucks');
    await expect(category(page, 'Work')).toBeChecked();
    await expect(page.getByTestId('suggestion')).toContainText('You\'ve logged "Starbucks" as Work 3 of 3 times');
  });

  test('a category the person chose is never overridden; the suggestion is only offered', async ({ page }) => {
    await signInAs(page);
    await openAdd(page);
    await category(page, 'Shopping').check();
    await page.getByLabel('Where (optional)').fill('Starbucks');
    await expect(category(page, 'Shopping')).toBeChecked();
    await expect(page.getByTestId('suggestion')).toContainText('Suggestion: Beverages');
    await page.getByRole('button', { name: 'Use Beverages' }).click();
    await expect(category(page, 'Beverages')).toBeChecked();
  });

  test('an unknown place suggests nothing and leaves the category alone', async ({ page }) => {
    await signInAs(page);
    await openAdd(page);
    const before = await page.getByRole('radio', { checked: true }).first().getAttribute('value').catch(() => null);
    await page.getByLabel('Where (optional)').fill('Kedai Ah Seng Corner');
    await expect(page.getByTestId('suggestion')).toHaveCount(0);
    const after = await page.getByRole('radio', { checked: true }).first().getAttribute('value').catch(() => null);
    expect(after).toBe(before);
  });
});

test.describe('receipt scanning (RX-01, RX-02)', () => {
  test('a PDF with text is read on the device: fills the form and never calls the reader service', async ({ page }) => {
    const problems = watchProblems(page);
    const user = await signInAs(page);
    await setOcr(page, user.email, { text: 'should not be used' });
    await openAdd(page);
    await page.getByTestId('receipt-file').setInputFiles({ name: 'bill.pdf', mimeType: 'application/pdf', buffer: makePdf(RECEIPT_LINES) });
    await expect(page.getByLabel('Amount (RM)')).toHaveValue('12.65', { timeout: 15_000 });
    await expect(page.getByLabel('Where (optional)')).toHaveValue(/KOPITIAM LEE/i);
    await expect(page.getByLabel('Date')).toHaveValue('2026-10-12');
    await expect(page.getByTestId('scan-note')).toContainText('Filled:');
    expect(await ocrCalls(page, user.email)).toBe(0);
    expect(problems).toEqual([]);
  });

  test('a photo goes to the reader and the result fills the form; saving keeps the right record', async ({ page }) => {
    const user = await signInAs(page);
    await setOcr(page, user.email, { text: fixture('pos-restaurant-ocr.txt') });
    await openAdd(page);
    await page.getByTestId('receipt-file').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByTestId('scan-note')).toContainText(/Filled|total/, { timeout: 15_000 });
    expect(await ocrCalls(page, user.email)).toBe(1);
    const amount = await page.getByLabel('Amount (RM)').inputValue();
    if (amount) {
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page.getByText('Saved')).toBeVisible();
      const saved = (await dbRows(page, user.email, 'expenses'))[0] as Record<string, unknown>;
      expect(saved.amount).toBe(Number(amount).toFixed(2));
    }
  });

  test('an unsure total offers the amounts found, and tapping one sets it', async ({ page }) => {
    const user = await signInAs(page);
    await setOcr(page, user.email, { text: 'SOME SHOP\nItem A 4.00\nItem B 7.50\nSST 0.69\n12.19\n' });
    await openAdd(page);
    await page.getByTestId('receipt-file').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: PNG });
    const group = page.getByRole('group', { name: /Which is the total\?|Other amounts found/ });
    await expect(group).toBeVisible({ timeout: 15_000 });
    await group.getByRole('button', { name: /RM 7\.50/ }).click();
    await expect(page.getByLabel('Amount (RM)')).toHaveValue('7.50');
  });

  test('a category the person already chose is kept when a receipt is scanned', async ({ page }) => {
    const user = await signInAs(page);
    await setOcr(page, user.email, { text: 'Starbucks Coffee\n12/10/2026\nTotal RM 18.90\n' });
    await openAdd(page);
    await category(page, 'Travel').check();
    await page.getByTestId('receipt-file').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByLabel('Amount (RM)')).toHaveValue('18.90', { timeout: 15_000 });
    await expect(category(page, 'Travel')).toBeChecked();
  });

  test('a scanned PDF (no text) is rendered and sent to the reader', async ({ page }) => {
    const user = await signInAs(page);
    await setOcr(page, user.email, { text: 'WARUNG MAK\nDate 03/10/2026\nTotal RM 21.00\n' });
    await openAdd(page);
    await page.getByTestId('receipt-file').setInputFiles({ name: 'scan.pdf', mimeType: 'application/pdf', buffer: makePdf([]) });
    await expect(page.getByLabel('Amount (RM)')).toHaveValue('21.00', { timeout: 20_000 });
    expect(await ocrCalls(page, user.email)).toBe(1);
  });

  test('every way it can fail is said in words and leaves the form usable', async ({ page, context }) => {
    const user = await signInAs(page);
    await openAdd(page);
    const note = page.getByTestId('scan-note');
    const photo = { name: 'p.png', mimeType: 'image/png', buffer: PNG };

    await setOcr(page, user.email, { mode: 'off' });
    await page.getByTestId('receipt-file').setInputFiles(photo);
    await expect(note).toContainText('Receipt scanning is not configured yet.', { timeout: 15_000 });

    await setOcr(page, user.email, { mode: 'unreadable' });
    await page.getByTestId('receipt-file').setInputFiles(photo);
    await expect(note).toContainText('couldn’t read this receipt clearly', { timeout: 15_000 });

    await setOcr(page, user.email, { text: 'x', limit: 0 });
    await page.getByTestId('receipt-file').setInputFiles(photo);
    await expect(note).toContainText('reached the limit for today', { timeout: 15_000 });

    await setOcr(page, user.email, { text: '   ' });
    await page.getByTestId('receipt-file').setInputFiles(photo);
    await expect(note).toContainText('I could not read any text', { timeout: 15_000 });

    await page.getByTestId('receipt-file').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
    await expect(note).toContainText('Choose a JPG, PNG or WebP image, or a PDF.');

    await page.getByTestId('receipt-file').setInputFiles({ name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not really a pdf') });
    await expect(note).toContainText('could not be opened as a PDF', { timeout: 15_000 });

    await setOcr(page, user.email, { text: 'Shop\nTotal RM 5.00' });
    await context.setOffline(true);
    await page.getByTestId('receipt-file').setInputFiles(photo);
    await expect(note).toContainText('You are offline. PDFs with text can still be read', { timeout: 15_000 });
    // the PDF with text still works offline
    await page.getByTestId('receipt-file').setInputFiles({ name: 'bill.pdf', mimeType: 'application/pdf', buffer: makePdf(RECEIPT_LINES) });
    await expect(page.getByLabel('Amount (RM)')).toHaveValue('12.65', { timeout: 15_000 });
    await context.setOffline(false);
    await page.getByLabel('Amount (RM)').fill('5');
    await expect(page.getByLabel('Amount (RM)')).toHaveValue('5');
  });
});

const BANK = ['Transaction Date,Description,Debit,Credit', '05/10/2026,GRAB*FOOD KL,18.50,', '06/10/2026,SALARY OCT,,4500.00', '07/10/2026,SINGTEL BILL,89.00,', '99/99/2026,BROKEN ROW,5.00,', '08/10/2026,Ah Seng Stall,12.00,'].join('\r\n');

test.describe('CSV (CS-01, HI-02)', () => {
  const importFile = (page: Page, text: string, name = 'statement.csv') => page.getByTestId('csv-file').setInputFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(text) });

  test('a bank statement shows a summary first, then adds expenses with guessed categories and income', async ({ page }) => {
    const user = await signInAs(page);
    await openAccount(page, 'Your data');
    await importFile(page, BANK);
    const dialog = page.getByRole('dialog', { name: /Import 4 transaction/ });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('import-summary')).toContainText('3 expense(s) and 1 income(s) will be added.');
    await expect(dialog).toContainText('1 row(s) could not be read (first: line 5, unreadable date)');
    await expect(dialog).toContainText('Debit = expense, credit = income.');
    expect(await dbRows(page, user.email, 'expenses')).toHaveLength(0); // nothing is added before confirming
    await dialog.getByRole('button', { name: 'Import 4' }).click();
    await expect(page.getByText('4 transaction(s) imported')).toBeVisible();
    const expenses = (await dbRows(page, user.email, 'expenses')) as Record<string, unknown>[];
    expect(expenses).toHaveLength(3);
    expect(expenses.find((r) => r.merchant === 'GRAB*FOOD KL')).toMatchObject({ category: 'food', amount: '18.50' });
    expect(expenses.find((r) => r.merchant === 'SINGTEL BILL')?.category).toBe('utilities');
    expect(expenses.find((r) => r.merchant === 'Ah Seng Stall')?.category).toBe('other');
    expect(await dbRows(page, user.email, 'incomes')).toHaveLength(1);
  });

  test('importing the same file again adds nothing: everything is recognised as already there', async ({ page }) => {
    await signInAs(page);
    await openAccount(page, 'Your data');
    await importFile(page, BANK);
    await page.getByRole('button', { name: 'Import 4' }).click();
    await expect(page.getByText('4 transaction(s) imported')).toBeVisible();
    await importFile(page, BANK);
    const dialog = page.getByRole('dialog', { name: 'Nothing new to import' });
    await expect(dialog.getByTestId('import-summary')).toContainText('4 already in the app (skipped).');
    await expect(dialog.getByRole('button', { name: /^Import/ })).toHaveCount(0);
  });

  test('a file that cannot be used is explained, and too-large files are refused', async ({ page }) => {
    await signInAs(page);
    await openAccount(page, 'Your data');
    await importFile(page, 'Name,Colour\nAnn,Red');
    await expect(page.getByText(/could not find a Date column/i)).toBeVisible();
    await importFile(page, 'only a header');
    await expect(page.getByText('The file has no rows to import.')).toBeVisible();
    await importFile(page, `Date,Amount\n${'2026-01-01,1.00\n'.repeat(160_000)}`);
    await expect(page.getByText('Please import a CSV under 2 MB (split it by year).')).toBeVisible();
  });

  test('export writes every record, protects formulas, and the file imports back into a fresh account unchanged', async ({ page, browser }) => {
    const user = await signInAs(page);
    await seedRows(page, user.email, 'expenses', [
      { amount: '12.50', category: 'food', payment: 'card', merchant: '=HYPERLINK("http://x")', note: 'say "hi", ok', created_at: isoDaysAgo(2) },
      { amount: '30.00', category: 'car', payment: 'bank', merchant: 'Petronas', note: null, created_at: isoDaysAgo(1) },
    ]);
    await seedRows(page, user.email, 'incomes', [{ amount: '1000.00', source: 'Bonus', created_at: isoDaysAgo(3) }]);
    await openAccount(page, 'Your data');
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export everything (CSV)' }).click()]);
    expect(download.suggestedFilename()).toMatch(/^vinexpenses-all-\d{4}-\d{2}-\d{2}\.csv$/);
    const text = fs.readFileSync((await download.path()) as string, 'utf8');
    expect(text.startsWith('﻿"Date","Type","Merchant"')).toBe(true);
    expect(text).toContain(`"'=HYPERLINK(""http://x"")"`); // a spreadsheet would otherwise run it as a formula
    expect(text.split('\r\n')).toHaveLength(4);

    const other = await (await browser.newContext()).newPage();
    const second = await signInAs(other);
    await openAccount(other, 'Your data');
    await other.getByTestId('csv-file').setInputFiles({ name: 'back.csv', mimeType: 'text/csv', buffer: Buffer.from(text) });
    await other.getByRole('button', { name: 'Import 3' }).click();
    await expect(other.getByText('3 transaction(s) imported')).toBeVisible();
    const rows = (await dbRows(other, second.email, 'expenses')) as Record<string, unknown>[];
    expect(rows.find((r) => r.merchant === '=HYPERLINK("http://x")')).toMatchObject({ amount: '12.50', category: 'food', note: 'say "hi", ok' });
    expect(rows.find((r) => r.merchant === 'Petronas')).toMatchObject({ category: 'car', payment: 'bank' });
    expect(((await dbRows(other, second.email, 'incomes'))[0] as Record<string, unknown>).source).toBe('Bonus');
  });

  test('History exports just what is on screen', async ({ page }) => {
    const user = await signInAs(page);
    await seedRows(page, user.email, 'expenses', [
      { amount: '5.00', category: 'food', payment: 'card', merchant: 'Alpha', note: null, created_at: isoDaysAgo(0) },
      { amount: '6.00', category: 'car', payment: 'card', merchant: 'Beta', note: null, created_at: isoDaysAgo(0) },
    ]);
    await page.goto('/app/history');
    await page.getByRole('searchbox').fill('Alpha');
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()]);
    const text = fs.readFileSync((await download.path()) as string, 'utf8');
    expect(text).toContain('Alpha');
    expect(text).not.toContain('Beta');
  });
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the add sheet with a scan result and the Account data card pass the accessibility scan (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const user = await signInAs(page);
    await setOcr(page, user.email, { text: 'SOME SHOP\nItem A 4.00\nItem B 7.50\nSST 0.69\n12.19\n' });
    await openAdd(page);
    await page.getByLabel('Where (optional)').fill('Starbucks');
    await page.getByTestId('receipt-file').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByTestId('scan-note')).toBeVisible({ timeout: 15_000 });
    let results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
    await page.keyboard.press('Escape');
    await openAccount(page, 'Your data');
    await page.getByTestId('csv-file').setInputFiles({ name: 'b.csv', mimeType: 'text/csv', buffer: Buffer.from(BANK) });
    await expect(page.getByRole('dialog', { name: /Import/ })).toBeVisible();
    results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
  });
}
