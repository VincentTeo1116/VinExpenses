// SP-04: my share of a receipt. Each part (discounts, service charge, SST, rounding) is shared out by what each side's items cost, in whole sen,
// and the other side takes the remainder, so my share plus the rest is always exactly the receipt.
import { lineNet, type Fit } from './compute';
import type { SplitBill } from './types';

export interface Share {
  grossCents: number;
  itemDiscountCents: number;
  netCents: number;
  billDiscountCents: number;
  serviceCents: number;
  sstCents: number;
  roundingCents: number;
  totalCents: number;
}

export interface Allocation {
  mine: Share;
  others: Share;
  whole: Share;
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const ratio = (part: number, all: number) => (all > 0 ? part / all : 0);

const withTotal = (s: Omit<Share, 'totalCents'>): Share => ({ ...s, totalCents: s.netCents - s.billDiscountCents + s.serviceCents + s.sstCents + s.roundingCents });
const minus = (a: Share, b: Share): Share =>
  withTotal({ grossCents: a.grossCents - b.grossCents, itemDiscountCents: a.itemDiscountCents - b.itemDiscountCents, netCents: a.netCents - b.netCents, billDiscountCents: a.billDiscountCents - b.billDiscountCents, serviceCents: a.serviceCents - b.serviceCents, sstCents: a.sstCents - b.sstCents, roundingCents: a.roundingCents - b.roundingCents });

export function allocate(bill: SplitBill, fit: Fit, selected: ReadonlySet<string>): Allocation {
  const d = fit.derived;
  const mineLines = bill.lines.filter((l) => selected.has(l.id));
  const grossMine = sum(mineLines.map((l) => l.grossCents));
  const netMine = sum(mineLines.map(lineNet));
  const netAll = d.netCents;

  // what the receipt really says, where it says it, otherwise what the working out gives
  const whole = withTotal({
    grossCents: d.grossCents,
    itemDiscountCents: d.itemDiscountCents,
    netCents: d.netCents,
    billDiscountCents: d.billDiscountCents,
    serviceCents: bill.serviceCents ?? d.serviceCents,
    sstCents: bill.sstCents ?? d.sstCents,
    roundingCents: bill.roundingCents ?? d.roundingCents,
  });

  const billDiscountMine = Math.round(whole.billDiscountCents * ratio(netMine, netAll));
  const baseMine = netMine - billDiscountMine;
  const serviceBasis = fit.model.serviceBase === 'gross' ? ratio(grossMine, whole.grossCents) : ratio(baseMine, whole.netCents - whole.billDiscountCents);
  const serviceMine = Math.round(whole.serviceCents * serviceBasis);
  const taxableMine = sum(mineLines.filter((l) => l.taxable).map(lineNet));
  const taxableAll = sum(bill.lines.filter((l) => l.taxable).map(lineNet));
  const sstShare =
    fit.model.sstBase === 'net+service'
      ? ratio(taxableMine + serviceMine, taxableAll + whole.serviceCents)
      : ratio(taxableMine, taxableAll);
  const sstMine = Math.round(whole.sstCents * sstShare);
  const beforeRoundingMine = baseMine + serviceMine + sstMine;
  const beforeRoundingAll = whole.netCents - whole.billDiscountCents + whole.serviceCents + whole.sstCents;
  const roundingMine = Math.round(whole.roundingCents * ratio(beforeRoundingMine, beforeRoundingAll));

  const mine = withTotal({ grossCents: grossMine, itemDiscountCents: grossMine - netMine, netCents: netMine, billDiscountCents: billDiscountMine, serviceCents: serviceMine, sstCents: sstMine, roundingCents: roundingMine });
  return { mine, others: minus(whole, mine), whole };
}
