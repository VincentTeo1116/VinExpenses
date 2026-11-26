// SP-09: what the person edits on the page (text boxes) turned into the receipt maths and back, and each failed check put into plain words.
import { numbersOnly } from '../guides/bill';
import type { Audit } from './audit';
import type { CheckId, SplitBill, SplitLine } from './types';

export interface LineDraft {
  id: string;
  mine: boolean;
  qty: string;
  name: string;
  gross: string;
  discount: string;
  /** The price of one and any add-on, as printed: kept so quantity times price can still be checked after the person edits. */
  unit: string;
  addon: string;
}

export interface TotalsDraft {
  billDiscount: string;
  subtotal: string;
  servicePercent: string;
  serviceAmount: string;
  sstPercent: string;
  sstAmount: string;
  rounding: string;
  total: string;
}

export interface Draft {
  lines: LineDraft[];
  totals: TotalsDraft;
}

/** "12.5" to 1250 sen; empty or unreadable is null (not charged or not printed), never 0. */
export function sen(value: string): number | null {
  const text = value.trim();
  if (!text || text === '.' || text === '-') return null;
  const n = Number(text);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

const percent = (value: string): number | null => {
  const n = Number(value.trim());
  return value.trim() && Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
};

const asText = (cents: number | null) => (cents == null ? '' : (cents / 100).toFixed(2));

export function billFromDraft(draft: Draft): SplitBill {
  const t = draft.totals;
  const lines: SplitLine[] = draft.lines.map((l) => {
    const unit = Math.max(1, Math.round(Number(l.qty) || 1));
    return { id: l.id, qty: unit, name: l.name.trim() || '—', unitCents: sen(l.unit), addonCents: sen(l.addon) ?? undefined, grossCents: Math.max(0, sen(l.gross) ?? 0), discountCents: Math.max(0, sen(l.discount) ?? 0), discountPercent: null, taxable: true };
  });
  return {
    lines,
    billDiscountCents: Math.max(0, sen(t.billDiscount) ?? 0),
    subtotalCents: sen(t.subtotal),
    servicePercent: percent(t.servicePercent),
    serviceCents: sen(t.serviceAmount),
    sstPercent: percent(t.sstPercent),
    sstCents: sen(t.sstAmount),
    roundingCents: sen(t.rounding),
    totalCents: sen(t.total),
  };
}

/** The text boxes for a receipt that was read (every line starts as "mine" until the person decides). */
export function draftFromBill(bill: SplitBill): Draft {
  return {
    lines: bill.lines.map((l) => ({ id: l.id, mine: false, qty: String(l.qty), name: l.name, gross: asText(l.grossCents), discount: l.discountCents ? asText(l.discountCents) : '', unit: asText(l.unitCents), addon: l.addonCents ? asText(l.addonCents) : '' })),
    totals: {
      billDiscount: bill.billDiscountCents ? asText(bill.billDiscountCents) : '',
      subtotal: asText(bill.subtotalCents),
      servicePercent: bill.servicePercent == null ? '' : String(bill.servicePercent),
      serviceAmount: asText(bill.serviceCents),
      sstPercent: bill.sstPercent == null ? '' : String(bill.sstPercent),
      sstAmount: asText(bill.sstCents),
      rounding: asText(bill.roundingCents),
      total: asText(bill.totalCents),
    },
  };
}

export const blankDraft = (): Draft => ({ lines: [], totals: { billDiscount: '', subtotal: '', servicePercent: '', serviceAmount: '', sstPercent: '', sstAmount: '', rounding: '', total: '' } });

let counter = 0;
export const newLineId = () => `n${(counter += 1)}`;
export const blankLine = (): LineDraft => ({ id: newLineId(), mine: false, qty: '1', name: '', gross: '', discount: '', unit: '', addon: '' });

/** Keeps digits and one dot (and a leading minus where a negative is allowed), for a number box. */
export function numberText(value: string, signed = false): string {
  const negative = signed && value.trim().startsWith('-');
  return `${negative ? '-' : ''}${numbersOnly(value.replace('-', ''))}`;
}

export interface Explained {
  id: CheckId;
  /** A key for the page's words, with the figures to put into it (already formatted as ringgit). */
  key: `split.check.${CheckId}`;
  params: Record<string, string>;
  lineIds: string[];
}

/** One plain sentence for each check that failed. `fmt` turns sen into "RM 12.50". */
export function explain(result: Audit, bill: SplitBill, fmt: (cents: number) => string): Explained[] {
  const names = new Map(bill.lines.map((l) => [l.id, l.name]));
  return result.checks
    .filter((c) => !c.ok)
    .map((c) => ({
      id: c.id,
      key: `split.check.${c.id}` as const,
      lineIds: c.lineIds,
      params: { expected: fmt(c.expected ?? 0), found: fmt(c.found ?? 0), items: c.lineIds.map((id) => names.get(id) ?? '').filter(Boolean).join(', ') },
    }));
}
