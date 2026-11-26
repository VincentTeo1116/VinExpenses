// SP-02: the receipt's arithmetic. Original prices, item discounts, bill discount, service charge, SST and rounding, in that order, and a search for the
// way this shop does it that reproduces the printed total.
import { percentOf, roundingFor } from '../guides/bill';
import type { Derived, Model, Rates, SplitBill, SplitLine } from './types';

export const lineNet = (line: SplitLine): number => Math.max(0, line.grossCents - Math.min(line.discountCents, line.grossCents));

/** A percentage discount on one line, to the sen. */
export const discountFromPercent = (grossCents: number, percent: number): number => percentOf(grossCents, percent);

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

export function derive(bill: SplitBill, model: Model, rates: Rates): Derived {
  const grossCents = sum(bill.lines.map((l) => l.grossCents));
  const netCents = sum(bill.lines.map(lineNet));
  const itemDiscountCents = grossCents - netCents;
  const billDiscountCents = Math.min(Math.max(0, bill.billDiscountCents), netCents);
  const baseCents = netCents - billDiscountCents;
  const serviceCents = percentOf(model.serviceBase === 'gross' ? grossCents : baseCents, rates.servicePercent);
  // SST only on the taxable lines: their share of the price after discounts
  const taxableNet = sum(bill.lines.filter((l) => l.taxable).map(lineNet));
  const taxableBase = netCents > 0 ? Math.round((baseCents * taxableNet) / netCents) : 0;
  const sstBase = model.sstBase === 'net+service' ? taxableBase + serviceCents : taxableBase;
  const sstCents = percentOf(sstBase, rates.sstPercent);
  const beforeRoundingCents = baseCents + serviceCents + sstCents;
  const roundingCents = model.rounding === 'five' ? roundingFor(beforeRoundingCents) : 0;
  return { grossCents, itemDiscountCents, netCents, billDiscountCents, baseCents, serviceCents, sstCents, beforeRoundingCents, roundingCents, totalCents: beforeRoundingCents + roundingCents };
}

/** A rate such as 6 or 10 read from a printed amount, only when it reproduces that amount (to a sen) from the base. */
export function inferPercent(amountCents: number, baseCents: number): number | null {
  if (baseCents <= 0 || amountCents < 0) return null;
  const rate = Math.round((amountCents / baseCents) * 100 * 2) / 2;
  return Math.abs(percentOf(baseCents, rate) - amountCents) <= 1 ? rate : null;
}

export interface Fit {
  model: Model;
  rates: Rates;
  derived: Derived;
  /** Derived total minus the printed total; null when the receipt prints no total. */
  diffCents: number | null;
}

const MODELS: Model[] = [];
for (const rounding of ['five', 'none'] as const) for (const sstBase of ['net', 'net+service'] as const) for (const serviceBase of ['net', 'gross'] as const) MODELS.push({ serviceBase, sstBase, rounding });

/** Every way of working this bill out, the one that matches the printed total first. A better match always wins; between equals the simplest way wins. */
export function fitBill(bill: SplitBill): Fit[] {
  const fits = MODELS.map((model, order) => {
    const gross = sum(bill.lines.map((l) => l.grossCents));
    const net = sum(bill.lines.map(lineNet));
    const base = net - Math.min(Math.max(0, bill.billDiscountCents), net);
    const serviceBase = model.serviceBase === 'gross' ? gross : base;
    const servicePercent = bill.servicePercent ?? (bill.serviceCents != null ? inferPercent(bill.serviceCents, serviceBase) : 0) ?? 0;
    const serviceCents = bill.serviceCents ?? percentOf(serviceBase, servicePercent);
    const taxableNet = sum(bill.lines.filter((l) => l.taxable).map(lineNet));
    const taxableBase = net > 0 ? Math.round((base * taxableNet) / net) : 0;
    const sstBase = model.sstBase === 'net+service' ? taxableBase + serviceCents : taxableBase;
    const sstPercent = bill.sstPercent ?? (bill.sstCents != null ? inferPercent(bill.sstCents, sstBase) : 0) ?? 0;
    const rates: Rates = { servicePercent, sstPercent };
    const derived = derive(bill, model, rates);
    return { model, rates, derived, diffCents: bill.totalCents == null ? null : derived.totalCents - bill.totalCents, order };
  });
  fits.sort((a, b) => Math.abs(a.diffCents ?? 0) - Math.abs(b.diffCents ?? 0) || a.order - b.order);
  return fits.map((f) => ({ model: f.model, rates: f.rates, derived: f.derived, diffCents: f.diffCents }));
}
