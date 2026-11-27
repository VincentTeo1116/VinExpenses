// SP-15: scores a read receipt against the figures printed on it (item amounts, subtotal, service, SST, total), so accuracy is a number and not a feeling.
import { lineNet } from './compute';
import type { SplitBill } from './types';

/** What is really printed on a receipt, in sen. Fields that are absent are not scored. */
export interface Truth {
  items?: number[];
  subtotal?: number;
  service?: number;
  sst?: number;
  total?: number;
}

export interface FieldScore {
  field: 'item' | 'subtotal' | 'service' | 'sst' | 'total';
  expected: number;
  found: number | null;
  ok: boolean;
}

export interface Score {
  fields: FieldScore[];
  /** Fields read correctly. */
  hit: number;
  /** Fields that should have been read. */
  want: number;
  /** Item lines read that are not on the receipt (a made-up or doubled line). */
  extra: number;
  /** hit out of (want + extra): a junk line costs as much as a missed one. */
  accuracy: number;
  /** Every field right and no junk line. */
  perfect: boolean;
}

/** Item amounts are matched one to one, so two items of the same price need two matching lines. Zero-amount lines (free items) are ignored on both sides. */
export function scoreBill(bill: SplitBill, truth: Truth): Score {
  const fields: FieldScore[] = [];
  const pool = bill.lines.map(lineNet).filter((n) => n > 0);
  for (const expected of (truth.items ?? []).filter((n) => n > 0)) {
    const at = pool.indexOf(expected);
    if (at >= 0) pool.splice(at, 1);
    fields.push({ field: 'item', expected, found: at >= 0 ? expected : null, ok: at >= 0 });
  }
  const one = (field: FieldScore['field'], expected: number | undefined, found: number | null) => {
    if (expected == null) return;
    fields.push({ field, expected, found, ok: found === expected });
  };
  one('subtotal', truth.subtotal, bill.subtotalCents);
  one('service', truth.service, bill.serviceCents);
  one('sst', truth.sst, bill.sstCents);
  one('total', truth.total, bill.totalCents);
  const hit = fields.filter((f) => f.ok).length;
  const want = fields.length;
  const extra = pool.length;
  return { fields, hit, want, extra, accuracy: want + extra === 0 ? 1 : hit / (want + extra), perfect: hit === want && extra === 0 };
}

/** Adds up many receipts: the share of all fields read correctly (junk lines counted against), and how many were perfect. */
export function summarise(scores: Score[]): { accuracy: number; perfect: number; receipts: number } {
  const hit = scores.reduce((n, s) => n + s.hit, 0);
  const total = scores.reduce((n, s) => n + s.want + s.extra, 0);
  return { accuracy: total === 0 ? 1 : hit / total, perfect: scores.filter((s) => s.perfect).length, receipts: scores.length };
}
