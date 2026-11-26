// SP-05: reads the text of a receipt (one row per line) into lines and totals: quantity, name, original price, each item's own discount, and the totals block.
// It never changes a number silently: a letter read for a digit is put right and reported, and anything it cannot place is left out and reported.
import { percentOf } from '../guides/bill';
import type { SplitBill, SplitLine } from './types';

export interface ParsedReceipt {
  bill: SplitBill;
  /** Rows that were not used, with a reason, so nothing disappears without a trace. */
  ignored: { row: string; why: 'header' | 'payment' | 'quantity' | 'unclear' | 'saving' }[];
  /** Amounts where a letter was read as a digit and put right (O to 0, l to 1, S to 5). */
  repaired: { row: string; from: string; to: string }[];
}

const CONFUSED: Record<string, string> = { O: '0', o: '0', I: '1', l: '1', '|': '1', S: '5', s: '5', B: '8', Z: '2' };
const AMOUNT = /([-=—–]\s?)?(?:RM|MYR)?\s?(\(?)(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})(?!\d)(?!\.\d)(\)?)\s?(-|CR)?/gi;

/** "3.5O" is 3.50 and "1O.5O" is 10.50: only a short token that is mostly digits, and only the letters that look like digits. */
export function fixAmountToken(token: string): { value: string; changed: boolean } {
  const m = /^(RM|MYR)?([0-9OoIl|SsBZ]{1,7})([.,])([0-9OoIl|SsBZ]{2})$/.exec(token);
  if (!m) return { value: token, changed: false };
  const body = `${m[2]}${m[4]}`;
  const digits = (body.match(/\d/g) ?? []).length;
  if (digits === body.length || digits * 2 < body.length) return { value: token, changed: false };
  const fix = (s: string) => s.replace(/[OoIl|SsBZ]/g, (c) => CONFUSED[c] ?? c);
  return { value: `${m[1] ?? ''}${fix(m[2] as string)}.${fix(m[4] as string)}`, changed: true };
}

const PAYMENT = /\b(cash|tunai|tender(?:ed)?|change|baki|kembali|visa|master ?card|debit|credit|card|kad|tng|touch ?n ?go|grab ?pay|boost|duit ?now|e-?wallet|payment|bayaran|paid)\b|现金|找零|付款|刷卡|已付/i;
const SAVING = /saving|saved|you ?save|jimat|节省|已省/i;
const QTY_TOTAL = /\b(total )?(qty|quantity|items?|bil\.? ?item)\b|数量|件数/i;
const ROUNDING = /rounding|round ?adj|penggenapan|pelarasan|凑整|四舍五入/i;
const SUBTOTAL = /sub ?-? ?total|jumlah kecil|jumlah sebelum|小计/i;
const SST = /service ?tax|\bsst\b|sales ?tax|\bgst\b|\btax\b|cukai|税/i;
const SERVICE = /service ?(charge|chg)|\bsvc\b|\bs\/c\b|caj ?perkhidmatan|服务费/i;
const TOTAL = /\b(grand ?total|net+t? ?total|total ?(due|payable|amount)?|amount ?(due|payable)|jumlah( ?bayaran| ?besar)?|jumlah)\b|合计|总计|总额|应付/i;
const DISCOUNT = /disc(ount)?|diskaun|potongan|promo|voucher|member|rebate|offer|off\b|减|折|优惠/i;
const BILL_LEVEL = /voucher|member|bill|promo ?code|total disc|e-?coupon|coupon/i;
const PERCENT = /(\d{1,3}(?:\.\d{1,2})?)\s*%/;

interface Money {
  cents: number;
  negative: boolean;
  at: number;
  length: number;
}

function moneyIn(row: string): Money[] {
  const found: Money[] = [];
  for (const m of row.matchAll(AMOUNT)) {
    const cents = Number((m[3] as string).replace(/,/g, '')) * 100 + Number(m[4]);
    found.push({ cents, negative: Boolean(m[1]) || (m[2] === '(' && m[5] === ')') || Boolean(m[6]), at: m.index ?? 0, length: m[0].length });
  }
  return found;
}

const labelOf = (row: string, money: Money[]) => {
  let label = row;
  for (const m of [...money].sort((a, b) => b.at - a.at)) label = `${label.slice(0, m.at)} ${label.slice(m.at + m.length)}`;
  return label.replace(/\s+/g, ' ').replace(/[.\-_=*#:]{2,}/g, ' ').trim();
};

function quantityOf(label: string): { qty: number; name: string } {
  let m = /^(\d{1,2})\s*[xX×]\s*(.+)$/.exec(label);
  if (m) return { qty: Number(m[1]), name: (m[2] as string).trim() };
  m = /^(\d{1,2})\s*@\s*(.+)$/.exec(label);
  if (m) return { qty: Number(m[1]), name: (m[2] as string).trim() };
  m = /^(.+?)\s+(\d{1,2})\s*[xX×]$/.exec(label);
  if (m) return { qty: Number(m[2]), name: (m[1] as string).trim() };
  m = /^(.+?)\s*[xX×]\s*(\d{1,2})$/.exec(label);
  if (m) return { qty: Number(m[2]), name: (m[1] as string).trim() };
  m = /^(\d{1,2})\s+\d{3,5}\s+([A-Za-z\u4e00-\u9fff].*)$/.exec(label);
  if (m) return { qty: Number(m[1]), name: (m[2] as string).trim() };
  m = /^(\d{1,2})\s+([A-Za-z一-鿿].*)$/.exec(label);
  if (m) return { qty: Number(m[1]), name: (m[2] as string).trim() };
  return { qty: 1, name: label };
}

const cleanName = (name: string) =>
  name
    .replace(/^\d{6,}\s+/, '')
    .replace(/\s+[A-Z*]$/, '')
    .replace(/^[\s\-+*.:]+|[\s\-+*.:]+$/g, '')
    .replace(/\s+/g, ' ');

export function parseReceipt(text: string): ParsedReceipt {
  const rows = text
    .normalize('NFKC')
    .replace(/[\u00a0\u2007\u202f]/g, ' ')
    .split(/\r?\n/)
    .map((r) => r.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean);

  const bill: SplitBill = { lines: [], billDiscountCents: 0, subtotalCents: null, servicePercent: null, serviceCents: null, sstPercent: null, sstCents: null, roundingCents: null, totalCents: null };
  const ignored: ParsedReceipt['ignored'] = [];
  const repaired: ParsedReceipt['repaired'] = [];
  let phase: 'items' | 'totals' | 'end' = 'items';
  let lastItem: SplitLine | null = null;
  let pendingName = '';
  let roundingSign: 'unknown' | 'signed' = 'unknown';
  let roundingAmount = 0;

  rows.forEach((original, index) => {
    if (phase === 'end') return;
    // put right letters that are plainly digits inside an amount
    const row = original
      .split(' ')
      .map((token) => {
        const fixed = fixAmountToken(token);
        if (fixed.changed) repaired.push({ row: original, from: token, to: fixed.value });
        return fixed.value;
      })
      .join(' ');

    if (phase === 'totals' && PAYMENT.test(row) && !TOTAL.test(row)) {
      phase = 'end';
      ignored.push({ row: original, why: 'payment' });
      return;
    }
    const money = moneyIn(row);
    const label = labelOf(row, money);
    const lower = label.toLowerCase();
    const percent = PERCENT.exec(label);

    if (SAVING.test(label)) return void ignored.push({ row: original, why: 'saving' });
    if (money.length === 0) {
      if (QTY_TOTAL.test(label)) return void ignored.push({ row: original, why: 'quantity' });
      // a name on one row and its amount on the next
      const nextRow = rows[index + 1];
      const nextMoney = nextRow ? moneyIn(nextRow) : [];
      if (phase === 'items' && /[A-Za-z一-鿿]{2}/.test(label) && nextRow && nextMoney.length > 0 && !/[A-Za-z一-鿿]/.test(labelOf(nextRow, nextMoney))) {
        pendingName = label;
        return;
      }
      // "+ no ice" under an item belongs to that item
      if (phase === 'items' && lastItem && /^[+\-*(]/.test(label)) {
        lastItem.name = `${lastItem.name} ${label}`.slice(0, 80);
        return;
      }
      return void ignored.push({ row: original, why: 'header' });
    }
    const amount = money[money.length - 1] as Money;
    const perUnit = /^\W*\(?\s*(\d+\.\d{2})\s*\/\s*[A-Za-z0-9]{1,4}\s*\)?\W*$/.exec(row.replace(/[A-Za-z]{3,}/g, ''));
    if (perUnit && lastItem && phase === 'items') {
      lastItem.unitCents = Math.round(Number(perUnit[1]) * 100);
      return;
    }
    // "+ extra cheese 2.00" under an item: an add-on, counted in the item's own amount unless the audit shows it is extra
    if (/^\s*\+/.test(row) && lastItem && phase === 'items' && !DISCOUNT.test(label)) {
      lastItem.addonCents = (lastItem.addonCents ?? 0) + amount.cents;
      return;
    }

    // the totals block
    if (ROUNDING.test(label)) {
      phase = 'totals';
      roundingAmount = amount.negative ? -amount.cents : amount.cents;
      roundingSign = amount.negative || /\+\s*(RM|MYR)?\s*\d/.test(row) ? 'signed' : 'unknown';
      bill.roundingCents = roundingAmount;
      return;
    }
    if (SUBTOTAL.test(label)) {
      phase = 'totals';
      bill.subtotalCents = amount.cents;
      return;
    }
    if (SST.test(label) && !/total/.test(lower)) {
      phase = 'totals';
      bill.sstCents = amount.cents;
      if (percent) bill.sstPercent = Number(percent[1]);
      return;
    }
    if (SERVICE.test(label)) {
      phase = 'totals';
      bill.serviceCents = amount.cents;
      if (percent) bill.servicePercent = Number(percent[1]);
      return;
    }
    if (TOTAL.test(label) && !DISCOUNT.test(label)) {
      phase = 'totals';
      bill.totalCents = amount.cents;
      return;
    }

    // a discount: on the item above, or on the whole bill
    if (DISCOUNT.test(label) || (amount.negative && label.length < 3)) {
      // "30% off" whose amount is exactly 30% of the item above belongs to that item, whatever the row is called
      const matchesItem = Boolean(percent && lastItem && phase === 'items' && Math.abs(percentOf(lastItem.grossCents, Number(percent[1])) - amount.cents) <= 1);
      const bigger = (BILL_LEVEL.test(label) && !matchesItem) || phase === 'totals' || !lastItem;
      if (bigger) bill.billDiscountCents += amount.cents;
      else if (lastItem) {
        lastItem.discountCents += amount.cents;
        if (percent) lastItem.discountPercent = Number(percent[1]);
      }
      return;
    }
    if (amount.negative && lastItem && phase === 'items') {
      lastItem.discountCents += amount.cents;
      return;
    }
    if (phase !== 'items') return void ignored.push({ row: original, why: 'unclear' });

    // an item
    const nameRow = pendingName ? `${pendingName} ${label}`.trim() : label;
    pendingName = '';
    const { qty, name } = quantityOf(nameRow);
    const cleaned = cleanName(name);
    if (!/[A-Za-z一-鿿]/.test(cleaned)) return void ignored.push({ row: original, why: 'unclear' });
    const gross = amount.cents;
    const unitMoney = money.length > 1 ? (money[money.length - 2] as Money) : null;
    const unit = unitMoney ? unitMoney.cents : null;
    const line: SplitLine = { id: `l${bill.lines.length + 1}`, qty, name: cleaned, unitCents: unit, grossCents: gross, discountCents: 0, discountPercent: null, taxable: true, raw: original };
    bill.lines.push(line);
    lastItem = line;
  });

  // a printed rounding such as "0.01" has no sign: the one that makes the parts add up is the right one
  if (bill.roundingCents != null && roundingSign === 'unknown' && bill.totalCents != null) {
    const net = bill.lines.reduce((s, l) => s + Math.max(0, l.grossCents - Math.min(l.discountCents, l.grossCents)), 0) - bill.billDiscountCents;
    const parts = net + (bill.serviceCents ?? 0) + (bill.sstCents ?? 0);
    const gap = bill.totalCents - parts;
    if (Math.abs(gap) === Math.abs(roundingAmount)) bill.roundingCents = gap;
  }
  return { bill, ignored, repaired };
}
