// SP-09: the boxes on the page and the receipt maths behind them.
import { describe, expect, it } from 'vitest';
import { audit } from './audit';
import { billFromDraft, blankDraft, draftFromBill, explain, numberText, sen } from './draft';
import { parseReceipt } from './parse';
import { readReceipt } from './read';

describe('text boxes to money', () => {
  it('reads ringgit text as sen, and empty or unreadable as "not there", never 0', () => {
    expect(sen('12.5')).toBe(1250);
    expect(sen('0.01')).toBe(1);
    expect(sen('-0.01')).toBe(-1);
    expect(sen('')).toBeNull();
    expect(sen('.')).toBeNull();
    expect(sen('-')).toBeNull();
  });
  it('a number box keeps digits and one dot, and a minus only where a minus makes sense', () => {
    expect(numberText('12abc.5.7')).toBe('12.57');
    expect(numberText('-5.00')).toBe('5.00');
    expect(numberText('-0.01', true)).toBe('-0.01');
    expect(numberText('1-0', true)).toBe('10');
  });
  it('a receipt makes boxes and the boxes make the same receipt back', () => {
    const bill = parseReceipt('Nasi 12.00\n Disc 30% -3.60\nTeh 3.50\nSubtotal 11.90\nService charge 10% 1.19\nSST 6% 0.71\nRounding 0.00\nTotal 13.80').bill;
    const back = billFromDraft(draftFromBill(bill));
    expect(back.lines.map((l) => [l.qty, l.grossCents, l.discountCents])).toEqual([[1, 1200, 360], [1, 350, 0]]);
    expect(back).toMatchObject({ subtotalCents: 1190, servicePercent: 10, serviceCents: 119, sstPercent: 6, sstCents: 71, totalCents: 1380, roundingCents: 0 });
  });
  it('an empty page is a receipt with nothing on it', () => {
    expect(billFromDraft(blankDraft())).toMatchObject({ lines: [], totalCents: null, subtotalCents: null, serviceCents: null });
  });
  it('a quantity of 0 or text counts as 1, and a negative amount counts as 0', () => {
    const draft = blankDraft();
    draft.lines.push({ id: 'a', mine: true, qty: '0', name: '', gross: '-5', discount: '', unit: '', addon: '' });
    expect(billFromDraft(draft).lines[0]).toMatchObject({ qty: 1, grossCents: 0, name: '—' });
  });
});

describe('plain words for a failed check', () => {
  const fmt = (c: number) => `RM ${(c / 100).toFixed(2)}`;
  it('says which two figures disagree, and which items to look at', () => {
    const bill = parseReceipt('Nasi 12.50\nTeh 3.50\nRoti canai 2 x 2.50 5.60\nSubtotal 21.00\nService charge 10% 2.10\nSST 6% 1.26\nTotal 24.36').bill;
    const said = explain(audit(bill), bill, fmt);
    expect(said.map((s) => s.id)).toEqual(expect.arrayContaining(['lineMath', 'subtotal']));
    expect(said.find((s) => s.id === 'lineMath')).toMatchObject({ key: 'split.check.lineMath', params: { items: 'Roti canai' } });
    expect(said.find((s) => s.id === 'subtotal')?.params).toMatchObject({ expected: 'RM 21.00', found: 'RM 21.60' });
  });
  it('says nothing about a receipt that reconciles', () => {
    const bill = parseReceipt('Tea 3.00\nSubtotal 3.00\nTotal 3.00').bill;
    expect(explain(audit(bill), bill, fmt)).toEqual([]);
  });
});

describe('reading a scan both ways', () => {
  const words = (rows: string[][]) => rows.flatMap((row, r) => row.map((text, i) => ({ text, x0: i === 0 ? 50 : 600, x1: i === 0 ? 50 + text.length * 12 : 600 + text.length * 12, y0: 100 + r * 40, y1: 120 + r * 40 })));
  it('uses the word positions when they give the better reading', () => {
    const result = readReceipt('garbled text with no rows', words([['Nasi', '12.00'], ['Teh', '3.00'], ['Subtotal', '15.00'], ['Total', '15.00']]));
    expect(result.from).toBe('positions');
    expect(result.audit.status).toBe('verified');
  });
  it('falls back to the reader\'s own lines when there are no usable positions', () => {
    const result = readReceipt('Nasi 12.00\nTeh 3.00\nSubtotal 15.00\nTotal 15.00', []);
    expect(result.from).toBe('text');
    expect(result.audit.status).toBe('verified');
  });
  it('keeps the reading that reconciles when the other does not', () => {
    const result = readReceipt('Nasi 12.00\nTeh 3.00\nSubtotal 15.00\nTotal 15.00', words([['Nasi', '12.00'], ['Teh', '9.00'], ['Subtotal', '15.00'], ['Total', '15.00']]));
    expect(result.from).toBe('text');
  });
});
