// SP-03: the audit of a receipt: does every line and every total reconcile, which lines to look at when they do not, and a single fix to offer when one is clear.
import { fitBill, lineNet, type Fit } from './compute';
import type { Check, SplitBill, SplitLine, Status } from './types';

export interface Suggestion {
  lineId: string;
  kind: 'digit' | 'qty' | 'addon';
  from: number;
  to: number;
}

export interface Audit {
  status: Status;
  checks: Check[];
  fit: Fit;
  /** Only when exactly one change to one line makes the whole receipt reconcile. */
  suggestion: Suggestion | null;
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const within = (a: number, b: number, sen = 1) => Math.abs(a - b) <= sen;

function run(bill: SplitBill): Omit<Audit, 'suggestion'> {
  const fit = fitBill(bill)[0] as Fit;
  const d = fit.derived;
  const checks: Check[] = [];

  const unitBad = bill.lines.filter((l) => l.unitCents != null && l.qty > 0 && !within(Math.round(l.qty * (l.unitCents as number)) + (l.addonCents ?? 0), l.grossCents));
  checks.push({ id: 'lineMath', ok: unitBad.length === 0, lineIds: unitBad.map((l) => l.id) });

  if (bill.subtotalCents != null) {
    // the printed subtotal may be before any discount, after the item discounts, or after the bill discount too
    const ok = within(d.grossCents, bill.subtotalCents) || within(d.netCents, bill.subtotalCents) || within(d.baseCents, bill.subtotalCents);
    checks.push({ id: 'subtotal', ok, lineIds: [], expected: bill.subtotalCents, found: d.netCents });
  }
  if (bill.serviceCents != null) checks.push({ id: 'service', ok: within(d.serviceCents, bill.serviceCents), lineIds: [], expected: bill.serviceCents, found: d.serviceCents });
  if (bill.sstCents != null) checks.push({ id: 'sst', ok: within(d.sstCents, bill.sstCents), lineIds: [], expected: bill.sstCents, found: d.sstCents });
  if (bill.roundingCents != null) checks.push({ id: 'rounding', ok: Math.abs(bill.roundingCents) <= 2, lineIds: [], expected: 0, found: bill.roundingCents });

  if (bill.totalCents != null) {
    // the printed parts must add up to the printed total, to the sen
    const parts = d.baseCents + (bill.serviceCents ?? d.serviceCents) + (bill.sstCents ?? d.sstCents) + (bill.roundingCents ?? d.roundingCents);
    checks.push({ id: 'total', ok: parts === bill.totalCents, lineIds: [], expected: bill.totalCents, found: parts });
  }
  const status: Status = bill.totalCents == null ? 'unverified' : checks.every((c) => c.ok) ? 'verified' : 'check';
  return { status, checks, fit };
}

/** One change (a single digit of one amount, or "that was the unit price") that makes the receipt reconcile, if there is exactly one. */
function suggest(bill: SplitBill): Suggestion | null {
  if (bill.totalCents == null && bill.subtotalCents == null) return null;
  const found: Suggestion[] = [];
  const retry = (line: SplitLine, gross: number, kind: Suggestion['kind']) => {
    const lines = bill.lines.map((l) => (l.id === line.id ? { ...l, grossCents: gross, unitCents: l.unitCents != null && kind === 'digit' ? null : l.unitCents } : l));
    if (run({ ...bill, lines }).status === 'verified') found.push({ lineId: line.id, kind, from: line.grossCents, to: gross });
  };
  for (const line of bill.lines) {
    const digits = String(line.grossCents);
    for (let at = 0; at < digits.length; at += 1) {
      for (let digit = 0; digit <= 9; digit += 1) {
        if (String(digit) === digits[at]) continue;
        const next = Number(`${digits.slice(0, at)}${digit}${digits.slice(at + 1)}`);
        if (next > 0 && String(next).length === digits.length) retry(line, next, 'digit');
      }
    }
    if (line.qty > 1 && line.unitCents == null) retry(line, line.grossCents * line.qty, 'qty');
    if (line.addonCents) retry(line, line.grossCents + line.addonCents, 'addon');
  }
  const distinct = new Map(found.map((f) => [`${f.lineId}:${f.to}`, f]));
  return distinct.size === 1 ? ([...distinct.values()][0] as Suggestion) : null;
}

export function audit(bill: SplitBill): Audit {
  const result = run(bill);
  return { ...result, suggestion: result.status === 'check' && bill.lines.length <= 60 ? suggest(bill) : null };
}

/** The sum of the lines after their own discounts. */
export const netOfLines = (bill: SplitBill): number => sum(bill.lines.map(lineNet));
