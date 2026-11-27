import { describe, expect, it } from 'vitest';
import { scoreBill, summarise } from './accuracy';
import type { SplitBill, SplitLine } from './types';

const line = (id: string, gross: number, discount = 0): SplitLine => ({ id, qty: 1, name: id, unitCents: null, grossCents: gross, discountCents: discount, discountPercent: null, taxable: true });
const bill = (lines: SplitLine[], extra: Partial<SplitBill> = {}): SplitBill => ({ lines, billDiscountCents: 0, subtotalCents: null, servicePercent: null, serviceCents: null, sstPercent: null, sstCents: null, roundingCents: null, totalCents: null, ...extra });

describe('SP-15 scoring a reading against the printed figures', () => {
  const truth = { items: [1200, 300], subtotal: 1500, total: 1500 };
  it('a perfect reading scores 100% and counts as perfect', () => {
    const s = scoreBill(bill([line('a', 1200), line('b', 300)], { subtotalCents: 1500, totalCents: 1500 }), truth);
    expect(s).toMatchObject({ hit: 4, want: 4, extra: 0, accuracy: 1, perfect: true });
  });
  it('a missed item and a wrong total each cost a field', () => {
    const s = scoreBill(bill([line('a', 1200)], { subtotalCents: 1500, totalCents: 1800 }), truth);
    expect(s.hit).toBe(2);
    expect(s.want).toBe(4);
    expect(s.fields.filter((f) => !f.ok).map((f) => f.field).sort()).toEqual(['item', 'total']);
    expect(s.perfect).toBe(false);
  });
  it('a total that was not read at all counts as wrong', () => {
    expect(scoreBill(bill([line('a', 1200), line('b', 300)], { subtotalCents: 1500 }), truth).fields.find((f) => f.field === 'total')).toMatchObject({ ok: false, found: null });
  });
  it('an invented line costs as much as a missed one', () => {
    const s = scoreBill(bill([line('a', 1200), line('b', 300), line('c', 777)], { subtotalCents: 1500, totalCents: 1500 }), truth);
    expect(s.extra).toBe(1);
    expect(s.accuracy).toBeCloseTo(4 / 5, 5);
    expect(s.perfect).toBe(false);
  });
  it('two items of the same price need two matching lines', () => {
    const s = scoreBill(bill([line('a', 500)]), { items: [500, 500] });
    expect(s.hit).toBe(1);
    expect(s.want).toBe(2);
  });
  it('an item discount is applied before matching, and free (zero) lines are ignored', () => {
    const s = scoreBill(bill([line('a', 9900, 6000), line('bag', 0)]), { items: [3900, 0] });
    expect(s).toMatchObject({ hit: 1, want: 1, extra: 0, perfect: true });
  });
  it('fields missing from the truth are not scored', () => {
    expect(scoreBill(bill([line('a', 100)], { sstCents: 6 }), { items: [100] }).want).toBe(1);
  });
  it('summarise pools every field across receipts', () => {
    const good = scoreBill(bill([line('a', 100)], { totalCents: 100 }), { items: [100], total: 100 });
    const bad = scoreBill(bill([]), { items: [100], total: 100 });
    expect(summarise([good, bad])).toEqual({ accuracy: 0.5, perfect: 1, receipts: 2 });
    expect(summarise([])).toEqual({ accuracy: 1, perfect: 0, receipts: 0 });
  });
});
