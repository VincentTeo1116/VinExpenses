// SP-01 to SP-05: reading a receipt, auditing its arithmetic, and sharing it out. Every receipt below is invented (not any real shop's).
import { describe, expect, it } from 'vitest';
import { allocate } from './allocate';
import { audit } from './audit';
import { fitBill } from './compute';
import { fixAmountToken, parseReceipt } from './parse';
import { bestReading, readReceipt } from './read';
import { placedRows, rowsFromWords, type PlacedWord } from './rows';
import type { SplitBill } from './types';

const RESTAURANT = `KEDAI MAKAN SEDAP
Jalan Ampang, Kuala Lumpur
Date: 25/11/2026 13:05
Nasi lemak ayam 12.50
Teh tarik 3.50
Roti canai x2 5.00
Subtotal 21.00
Service charge 10% 2.10
SST 6% 1.26
Rounding -0.01
TOTAL RM 24.35
Total Qty: 4
Cash 30.00
Change 5.65`;

const ITEM_DISCOUNT = `Nasi lemak ayam 12.00
 Disc 30% -3.60
Teh tarik 3.50
2 x Roti canai 2.50 5.00
Subtotal 16.90
Service charge 10% 1.69
SST 6% 1.01
TOTAL 19.60`;

const RETAIL = `FASHION HOUSE
T-Shirt Basic 49.90
 Member Discount 30% -14.97
Jeans Slim Fit 89.90
Subtotal 124.83
Rounding 0.02
Total 124.85`;

const VOUCHER = `Nasi goreng 10.00
Mee goreng 8.00
Subtotal 18.00
Voucher -3.00
Service charge 10% 1.50
SST 6% 0.90
Total 17.40`;

const SST_ON_SERVICE = `Item A 20.00
Subtotal 20.00
Service charge 10% 2.00
SST 6% 1.32
Total 23.32`;

const SERVICE_ON_ORIGINAL = `Item A 20.00
Subtotal 20.00
Voucher -5.00
Service charge 10% 2.00
SST 6% 0.90
Total 17.90`;

const CHINESE = `小吃店
鸡饭 8.00
奶茶 3.00
小计 11.00
服务费 10% 1.10
销售税 6% 0.66
凑整 -0.01
合计 12.75`;

const MALAY = `Nasi ayam 9.00
Air sirap 2.50
Jumlah kecil 11.50
Caj perkhidmatan 10% 1.15
Cukai perkhidmatan 6% 0.69
Penggenapan 0.01
Jumlah 13.35`;

describe('reading the lines and the totals', () => {
  it('a restaurant bill: quantity, name, original price, then the totals block', () => {
    const { bill, ignored } = parseReceipt(RESTAURANT);
    expect(bill.lines.map((l) => [l.qty, l.name, l.grossCents])).toEqual([[1, 'Nasi lemak ayam', 1250], [1, 'Teh tarik', 350], [2, 'Roti canai', 500]]);
    expect(bill).toMatchObject({ subtotalCents: 2100, serviceCents: 210, servicePercent: 10, sstCents: 126, sstPercent: 6, roundingCents: -1, totalCents: 2435, billDiscountCents: 0 });
    expect(ignored.map((i) => i.why)).toEqual(expect.arrayContaining(['header', 'quantity', 'payment']));
  });
  it('an item with its own discount keeps its original price and the discount apart', () => {
    const { bill } = parseReceipt(ITEM_DISCOUNT);
    expect(bill.lines.map((l) => [l.name, l.grossCents, l.discountCents, l.discountPercent])).toEqual([['Nasi lemak ayam', 1200, 360, 30], ['Teh tarik', 350, 0, null], ['Roti canai', 500, 0, null]]);
    expect(bill.lines[2]).toMatchObject({ qty: 2, unitCents: 250 });
    expect(bill.billDiscountCents).toBe(0);
  });
  it('a member discount whose amount is exactly 30% of the item above is that item\'s discount, not the whole bill\'s', () => {
    const { bill } = parseReceipt(RETAIL);
    expect(bill.lines.map((l) => [l.name, l.grossCents, l.discountCents])).toEqual([['T-Shirt Basic', 4990, 1497], ['Jeans Slim Fit', 8990, 0]]);
    expect(bill.billDiscountCents).toBe(0);
    expect(bill.roundingCents).toBe(2); // an unsigned "0.02" is given the sign that makes the parts add up
  });
  it('a voucher after the subtotal is a discount on the whole bill', () => {
    expect(parseReceipt(VOUCHER).bill).toMatchObject({ billDiscountCents: 300, subtotalCents: 1800 });
  });
  it('Chinese and Malay labels', () => {
    const zh = parseReceipt(CHINESE).bill;
    expect(zh).toMatchObject({ subtotalCents: 1100, serviceCents: 110, sstCents: 66, roundingCents: -1, totalCents: 1275 });
    expect(zh.lines.map((l) => l.name)).toEqual(['鸡饭', '奶茶']);
    const ms = parseReceipt(MALAY).bill;
    expect(ms).toMatchObject({ subtotalCents: 1150, serviceCents: 115, sstCents: 69, roundingCents: 1, totalCents: 1335 });
    expect(ms.lines.map((l) => l.name)).toEqual(['Nasi ayam', 'Air sirap']);
  });
  it('quantity written four ways, and a name wrapped onto the row above its amount', () => {
    const { bill } = parseReceipt(`3 Teh ais 7.50\nRoti bakar x2 6.00\n2 @ Kuih 4.00\nIce lemon tea with extra\n 4.80\nTotal 22.30`);
    expect(bill.lines.map((l) => [l.qty, l.name, l.grossCents])).toEqual([[3, 'Teh ais', 750], [2, 'Roti bakar', 600], [2, 'Kuih', 400], [1, 'Ice lemon tea with extra', 480]]);
  });
  it('a modifier under an item joins that item, and the "you saved" line is not an item', () => {
    const { bill, ignored } = parseReceipt(`Latte 12.00\n+ oat milk\nSubtotal 12.00\nYou saved 3.00\nTotal 12.00`);
    expect(bill.lines).toHaveLength(1);
    expect(bill.lines[0]?.name).toBe('Latte + oat milk');
    expect(ignored.some((i) => i.why === 'saving')).toBe(true);
  });
  it('never takes a date, a phone number or a time for an amount', () => {
    const { bill } = parseReceipt(`Tel 03-2145 6677\n25.11.2026 13:05\nTea 3.00\nTotal 3.00`);
    expect(bill.lines.map((l) => l.name)).toEqual(['Tea']);
  });
});

describe('putting right a letter read as a digit', () => {
  it('3.5O is 3.50 and 1O.5O is 10.50, and the fix is reported', () => {
    expect(fixAmountToken('3.5O')).toEqual({ value: '3.50', changed: true });
    expect(fixAmountToken('1O.5O')).toEqual({ value: '10.50', changed: true });
    const { bill, repaired } = parseReceipt('Teh tarik 3.5O\nTotal 3.50');
    expect(bill.lines[0]?.grossCents).toBe(350);
    expect(repaired).toEqual([{ row: 'Teh tarik 3.5O', from: '3.5O', to: '3.50' }]);
  });
  it('leaves words, plain amounts and mostly-letter tokens alone', () => {
    for (const token of ['Roti', '12.50', 'SO.OO', 'Bill.25', 'RM24.35']) expect(fixAmountToken(token).changed, token).toBe(false);
  });
});

describe('the audit', () => {
  it('a good receipt is verified, and the shop\'s way of working it out is found', () => {
    const result = audit(parseReceipt(RESTAURANT).bill);
    expect(result.status).toBe('verified');
    expect(result.checks.every((c) => c.ok)).toBe(true);
    expect(result.fit.model).toEqual({ serviceBase: 'net', sstBase: 'net', rounding: 'five' });
    expect(result.suggestion).toBeNull();
  });
  it('every example receipt reconciles to the sen', () => {
    for (const text of [ITEM_DISCOUNT, RETAIL, VOUCHER, SST_ON_SERVICE, SERVICE_ON_ORIGINAL, CHINESE, MALAY]) expect(audit(parseReceipt(text).bill).status, text.slice(0, 20)).toBe('verified');
  });
  it('finds that this shop charges SST on the service charge too', () => {
    expect(audit(parseReceipt(SST_ON_SERVICE).bill).fit.model.sstBase).toBe('net+service');
  });
  it('finds that this shop charges service on the original prices, not after a voucher', () => {
    expect(audit(parseReceipt(SERVICE_ON_ORIGINAL).bill).fit.model.serviceBase).toBe('gross');
  });
  it('a misread amount is flagged with the lines to look at, and one clear fix is offered', () => {
    const bill = parseReceipt(`Nasi lemak ayam 12.50\nTeh tarik 3.50\nRoti canai 2 x 2.50 5.60\nSubtotal 21.00\nService charge 10% 2.10\nSST 6% 1.26\nTotal 24.36`).bill;
    const result = audit(bill);
    expect(result.status).toBe('check');
    expect(result.checks.find((c) => c.id === 'lineMath')?.lineIds).toEqual(['l3']);
    expect(result.suggestion).toEqual({ lineId: 'l3', kind: 'digit', from: 560, to: 500 });
  });
  it('when two different fixes would both work, none is offered (it will not guess)', () => {
    const bill = parseReceipt(`Nasi 11.00\nMee 11.00\nSubtotal 21.00\nService charge 10% 2.10\nSST 6% 1.26\nRounding -0.01\nTotal 24.35`).bill;
    expect(audit(bill).status).toBe('check');
    expect(audit(bill).suggestion).toBeNull();
  });
  it('an amount that is the price of one, not the line total, is offered as a fix for a quantity of two', () => {
    const bill = parseReceipt(`Nasi goreng 10.00\n2 Roti canai 2.50\nSubtotal 15.00\nService charge 10% 1.50\nSST 6% 0.90\nTotal 17.40`).bill;
    expect(audit(bill).suggestion).toEqual({ lineId: 'l2', kind: 'qty', from: 250, to: 500 });
  });
  it('without a printed total nothing can be verified, and it says so', () => {
    expect(audit(parseReceipt('Tea 3.00\nCoffee 4.00').bill).status).toBe('unverified');
  });
  it('a printed total that does not add up is a "check", even when every line is fine', () => {
    const bill = parseReceipt(`Tea 3.00\nCoffee 4.00\nSubtotal 7.00\nTotal 7.50`).bill;
    const result = audit(bill);
    expect(result.status).toBe('check');
    expect(result.checks.find((c) => c.id === 'total')).toMatchObject({ ok: false, expected: 750, found: 700 });
  });
});

describe('my share', () => {
  const bill = parseReceipt(ITEM_DISCOUNT).bill;
  const fit = (b: SplitBill) => fitBill(b)[0] as ReturnType<typeof fitBill>[number];

  it('ticking one discounted item: its own discount, and its part of the service charge and SST', () => {
    const { mine, others, whole } = allocate(bill, fit(bill), new Set(['l1']));
    expect(whole.totalCents).toBe(1960);
    expect(mine).toMatchObject({ grossCents: 1200, itemDiscountCents: 360, netCents: 840, serviceCents: 84, sstCents: 50, totalCents: 974 });
    expect(others.totalCents).toBe(986);
  });
  it('ticking everything gives the whole receipt, ticking nothing gives nothing', () => {
    const all = allocate(bill, fit(bill), new Set(bill.lines.map((l) => l.id)));
    expect(all.mine).toEqual(all.whole);
    expect(all.others.totalCents).toBe(0);
    expect(allocate(bill, fit(bill), new Set()).mine.totalCents).toBe(0);
  });
  it('a bill discount is shared by price, and the rounding follows the total', () => {
    const v = parseReceipt(VOUCHER).bill;
    const { mine, whole } = allocate(v, fit(v), new Set(['l1']));
    expect(whole).toMatchObject({ billDiscountCents: 300, serviceCents: 150, sstCents: 90, totalCents: 1740 });
    expect(mine).toMatchObject({ netCents: 1000, billDiscountCents: 167, serviceCents: 83, sstCents: 50 });
  });
  it('my share and the rest always add up to the receipt, to the sen, for any choice of items', () => {
    let seed = 12345;
    const next = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let round = 0; round < 300; round += 1) {
      const lines = Array.from({ length: 2 + Math.floor(next() * 7) }, (_, i) => {
        const gross = 100 + Math.floor(next() * 9000);
        return { id: `l${i}`, qty: 1, name: `Item ${i}`, unitCents: null, grossCents: gross, discountCents: next() < 0.4 ? Math.floor(gross * 0.3) : 0, discountPercent: null, taxable: next() < 0.85, raw: '' };
      });
      const b: SplitBill = { lines, billDiscountCents: next() < 0.3 ? 200 : 0, subtotalCents: null, servicePercent: next() < 0.7 ? 10 : null, serviceCents: null, sstPercent: next() < 0.7 ? 6 : null, sstCents: null, roundingCents: null, totalCents: null };
      const chosen = new Set(lines.filter(() => next() < 0.5).map((l) => l.id));
      const { mine, others, whole } = allocate(b, fit(b), chosen);
      for (const key of ['grossCents', 'itemDiscountCents', 'netCents', 'billDiscountCents', 'serviceCents', 'sstCents', 'roundingCents', 'totalCents'] as const) expect(mine[key] + others[key], `${key} in round ${round}`).toBe(whole[key]);
      expect(mine.totalCents).toBeGreaterThanOrEqual(0);
      expect(mine.totalCents).toBeLessThanOrEqual(whole.totalCents);
    }
  });
  it('an item the shop does not charge SST on carries none of it', () => {
    const b: SplitBill = { ...parseReceipt(`Rice 10.00\nBottled water 2.00\nSubtotal 12.00\nSST 6% 0.60\nTotal 12.60`).bill };
    b.lines[1] = { ...(b.lines[1] as SplitBill['lines'][number]), taxable: false };
    const f = fit(b);
    expect(f.derived.sstCents).toBe(60);
    const { mine } = allocate(b, f, new Set(['l2']));
    expect(mine).toMatchObject({ netCents: 200, sstCents: 0, totalCents: 200 });
  });
});

describe('rows from word positions', () => {
  const word = (text: string, x: number, row: number, tilt: number): PlacedWord => ({ text, x0: x, x1: x + text.length * 12, y0: 100 + row * 40 + x * tilt, y1: 120 + row * 40 + x * tilt });
  const page = (tilt: number) => [word('Nasi', 50, 0, tilt), word('lemak', 110, 0, tilt), word('12.50', 600, 0, tilt), word('Teh', 50, 1, tilt), word('tarik', 100, 1, tilt), word('3.50', 600, 1, tilt), word('TOTAL', 50, 2, tilt), word('16.00', 600, 2, tilt)];
  it('puts each price on the row of its item, with a wide gap between the columns', () => {
    expect(rowsFromWords(page(0))).toEqual(['Nasi lemak  12.50', 'Teh tarik  3.50', 'TOTAL  16.00']);
  });
  it('a tilted photo still gives the same rows (a price on the far right sits lower than its item on the left)', () => {
    expect(rowsFromWords(page(0.03))).toEqual(['Nasi lemak  12.50', 'Teh tarik  3.50', 'TOTAL  16.00']);
  });
  it('words in any order, and empty words, make no difference', () => {
    const shuffled = [...page(0)].reverse().concat([{ text: ' ', x0: 5, x1: 9, y0: 1, y1: 2 }]);
    expect(rowsFromWords(shuffled)).toEqual(['Nasi lemak  12.50', 'Teh tarik  3.50', 'TOTAL  16.00']);
    expect(rowsFromWords([])).toEqual([]);
  });
});

describe('receipts in the style of delivery apps and busy restaurants', () => {
  it('an item code after the quantity is dropped, "(16.90/ea)" is the price of one, and "+ extra egg 2.00" is an add-on inside the amount', () => {
    const { bill } = parseReceipt('1 301 Chicken rice 18.90\n (16.90/ea)\n + Extra egg + 2.00\nTotal 18.90');
    expect(bill.lines).toEqual([expect.objectContaining({ qty: 1, name: 'Chicken rice', grossCents: 1890, unitCents: 1690, addonCents: 200 })]);
    expect(audit(bill).status).toBe('verified');
  });
  it('an add-on that is really extra is found by the audit and offered as the one fix', () => {
    const { bill } = parseReceipt('1 Chicken rice 16.90\n + Extra egg + 2.00\nSubtotal 18.90\nTotal 18.90');
    const result = audit(bill);
    expect(result.status).toBe('check');
    expect(result.suggestion).toEqual({ lineId: 'l1', kind: 'addon', from: 1690, to: 1890 });
  });
  it('a discount row read as "=9.18" is still a discount, shared by price, with service charge worked out after it', () => {
    const { bill } = parseReceipt('Nasi 50.00\nMee 41.80\nSubtotal 91.80\nDisc 10% =9.18\nService Charge 10% 8.26\nSST 6% 4.96\nRounding 0.01\nTotal 95.85');
    expect(bill).toMatchObject({ billDiscountCents: 918, serviceCents: 826, sstCents: 496, roundingCents: 1, totalCents: 9585 });
    expect(audit(bill).status).toBe('verified');
  });
});

describe('where each line sits on the photo', () => {
  const word = (text: string, x: number, row: number): PlacedWord => ({ text, x0: x, x1: x + text.length * 12, y0: 100 + row * 40, y1: 120 + row * 40 });
  const page = [word('Nasi', 50, 0), word('12.00', 600, 0), word('Teh', 50, 1), word('3.00', 600, 1), word('Nasi', 50, 2), word('12.00', 600, 2), word('Subtotal', 50, 3), word('27.00', 600, 3), word('Total', 50, 4), word('27.00', 600, 4)];
  it('a row keeps the box that holds its words, in the photo\'s own pixels', () => {
    const rows = placedRows(page);
    expect(rows.map((r) => r.text)).toEqual(['Nasi  12.00', 'Teh  3.00', 'Nasi  12.00', 'Subtotal  27.00', 'Total  27.00']);
    expect(rows[1]?.box).toEqual({ x0: 50, y0: 140, x1: 600 + 4 * 12, y1: 160 });
  });
  it('each line is paired with its own row, even when two rows read exactly alike', () => {
    const reading = readReceipt('', page);
    expect(reading.from).toBe('positions');
    expect(reading.boxes.l1?.y0).toBe(100);
    expect(reading.boxes.l2?.y0).toBe(140);
    expect(reading.boxes.l3?.y0).toBe(180); // the second "Nasi 12.00", not the first
  });
  it('a reading from text alone has no boxes', () => {
    expect(readReceipt('Nasi 12.00\nTotal 12.00', []).boxes).toEqual({});
  });
});

describe('SP-07 the best of several readings of one photo', () => {
  const good = 'Nasi 12.00\nTeh 3.00\nSubtotal 15.00\nTotal 15.00';
  const bad = 'Nasi 12.00\nTeh 8.00\nSubtotal 15.00\nTotal 15.00'; // a misread 3 that no longer adds up
  it('keeps the reading that adds up, wherever it comes in the list', () => {
    expect(bestReading([{ text: bad, words: [] }, { text: good, words: [] }]).audit.status).toBe('verified');
    expect(bestReading([{ text: good, words: [] }, { text: bad, words: [] }]).audit.status).toBe('verified');
  });
  it('with one reading it returns that reading', () => {
    expect(bestReading([{ text: bad, words: [] }]).parsed.bill.lines.length).toBe(2);
  });
});

describe('SP-14 the four areas: shop, date, items, total', () => {
  const w = (text: string, x: number, row: number): PlacedWord => ({ text, x0: x, x1: x + text.length * 12, y0: 100 + row * 40, y1: 120 + row * 40 });
  const page = [
    w('KEDAI', 200, 0), w('MAKAN', 290, 0),
    w('Date:', 50, 1), w('25/11/2026', 130, 1),
    w('Nasi', 50, 2), w('12.00', 600, 2),
    w('Teh', 50, 3), w('3.00', 600, 3),
    w('Subtotal', 50, 4), w('15.00', 600, 4),
    w('Total', 50, 5), w('15.00', 600, 5),
    w('Cash', 50, 6), w('20.00', 600, 6),
  ];
  it('marks the shop row, the date row, one box round all the items and the total row', () => {
    const r = readReceipt('', page, { merchant: 'Kedai Makan' });
    expect(r.regions.merchant?.y0).toBe(100);
    expect(r.regions.date?.y0).toBe(140);
    expect(r.regions.items?.y0).toBe(180);
    expect(r.regions.items?.y1).toBe(240); // the bottom of the last item row (Teh), not the subtotal
    expect(r.regions.total?.y0).toBe(300); // the Total row, not Subtotal or Cash
  });
  it('without a known shop name it takes the first row of words that is not a date or an amount', () => {
    expect(readReceipt('', page).regions.merchant?.y0).toBe(100);
  });
  it('a reading from text alone has no areas', () => {
    expect(readReceipt('Nasi 12.00\nTotal 12.00').regions).toEqual({});
  });
});

describe('SP-05 dates, comma decimals and more subtotal wordings', () => {
  it('a date or a clock time in a header row is not an item', () => {
    const r = parseReceipt('Printed On: 2026.08.27 13:43:51\nReceipt Date: 2026.11.25 19:28.29\nNasi 12.00\nTotal 12.00');
    expect(r.bill.lines.map((l) => l.grossCents)).toEqual([1200]);
  });
  it('a decimal point read as a comma or split by a space is put right and reported', () => {
    const r = parseReceipt('Nasi 12.00\nSub Total (Ex) : 12. 00\nNet Total 12,00');
    expect(r.bill.subtotalCents).toBe(1200);
    expect(r.bill.totalCents).toBe(1200);
    expect(r.repaired.map((x) => x.to).sort()).toEqual(['12.00', '12.00']);
  });
  it('a thousands comma is left alone', () => {
    expect(parseReceipt('Set meal 1,250.00\nTotal 1,250.00').bill.totalCents).toBe(125000);
  });
  it('"Total Sales (Exc. Tax)" is the subtotal and a mangled "(Exe. Tax)" still is', () => {
    expect(parseReceipt('Nasi 12.00\nTotal Sales (Exc. Tax) RM 12.00\nSST (6%) RM 0.72\nTOTAL RM 12.72').bill.subtotalCents).toBe(1200);
    expect(parseReceipt('Nasi 12.00\nles (Exe. Tax) RM 12.00\nTOTAL RM 12.00').bill.subtotalCents).toBe(1200);
  });
  it('"Total Sales INCL SVC TAX" is still the total, not a subtotal', () => {
    const r = parseReceipt('Beans 5.04\nSub-total 5.04\nTotal Sales INCL SVC TAX 5.04');
    expect(r.bill.subtotalCents).toBe(504);
    expect(r.bill.totalCents).toBe(504);
  });
});

describe('SP-05 clock times, glued amounts, rounding rows and price-after-discount rows', () => {
  it('a clock time with am or pm is not an item, however its dot was read', () => {
    expect(parseReceipt('Date 13/10/2026 12.26PM\nNasi 12.00\nTotal 12.00').bill.lines.map((l) => l.grossCents)).toEqual([1200]);
  });
  it('a number stuck to letters (an address) is not an amount', () => {
    expect(parseReceipt('N0.19,JALAN JURU U1/20\nNasi 12.00\nTotal 12.00').bill.lines.map((l) => l.grossCents)).toEqual([1200]);
  });
  it('an amount after an x still counts: "2x12.00"', () => {
    expect(parseReceipt('Teh 2x3.00\nTotal 6.00').bill.lines.map((l) => l.grossCents)).toEqual([300]);
  });
  it('a big amount on a "Rounding" row is the total, a small one is the rounding', () => {
    const big = parseReceipt('Shirt 29.00\nJeans 69.00\nRounding 98.00');
    expect(big.bill.totalCents).toBe(9800);
    expect(big.bill.roundingCents).toBeNull();
    expect(parseReceipt('Nasi 12.01\nRounding -0.01\nTotal 12.00').bill.roundingCents).toBe(-1);
  });
  it('"Dis off %: 60.61  39.00" lowers the item from 99.00 to 39.00', () => {
    const r = parseReceipt('Jacket 99.00\nDis off %: 60.61 39.00\nSub Total: 39.00\nTotal: 39.00');
    expect(r.bill.lines).toHaveLength(1);
    expect(r.bill.lines[0]).toMatchObject({ grossCents: 9900, discountCents: 6000 });
    expect(audit(r.bill).status).toBe('verified');
  });
});

describe('SP-05 payment confirmations and Chinese total words', () => {
  it('an amount alone on a row, or after "Amount", is the total of a payment screen', () => {
    expect(parseReceipt('Payment successful\n-RM163.92\nTransaction Type Payment').bill.totalCents).toBe(16392);
    expect(parseReceipt('Date/Time : 3-Sep-2026\nAmount : MYR 30.80\nPayment Method : Credit Card').bill.totalCents).toBe(3080);
  });
  it('a receipt with items keeps its own total rules', () => {
    expect(parseReceipt('Nasi 12.00\nTotal 12.00').bill.totalCents).toBe(1200);
  });
  it('总数 and 总计 are totals', () => {
    expect(parseReceipt('1x Soup 24.90\n总数 (含 GST) RM 24.90').bill.totalCents).toBe(2490);
  });
});

describe('SP-05 delivery-app totals, add-ons after words, and unit prices beside Chinese', () => {
  it('a total printed above the items does not end the items', () => {
    const r = parseReceipt('总数 (含 GST) RM 50.30\n1x Soup 24.90\n1x Dry 25.90\n3x Rice 10.50\n小计 RM 61.30\n优惠券: syok - RM 11.00\n总数 (含 GST) RM 50.30');
    expect(r.bill.lines.map((l) => l.grossCents)).toEqual([2490, 2590, 1050]);
    expect(r.bill.subtotalCents).toBe(6130);
    expect(r.bill.totalCents).toBe(5030);
    expect(audit(r.bill).status).toBe('verified');
  });
  it('"Cold 冷 +1.00" and "Add Noodle 加面 +2.00" belong to the item above', () => {
    const r = parseReceipt('Pasta 虾酱 18.90\n(16.90/ea)\nAdd Noodle 加面 +2.00\nCham 4.20\nCold 冷 +1.00\nTotal 23.10');
    expect(r.bill.lines).toHaveLength(2);
    expect(r.bill.lines[0]?.addonCents).toBe(200);
    expect(r.bill.lines[1]?.addonCents).toBe(100);
  });
  it('a unit price in brackets beside Chinese words is not an item', () => {
    const r = parseReceipt('Pasta 18.90\n虾酱炸鸡意大利面 (16.90/ea)\nTotal 18.90');
    expect(r.bill.lines).toHaveLength(1);
    expect(r.bill.lines[0]?.unitCents).toBe(1690);
  });
});
