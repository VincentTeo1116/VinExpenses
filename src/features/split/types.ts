// SP-01: a receipt as lines and totals, all money in whole sen; a printed total that is missing is null, never 0.
export interface SplitLine {
  id: string;
  qty: number;
  name: string;
  /** The price of one, when the receipt shows it. */
  unitCents: number | null;
  /** The original amount of the line, before its own discount. */
  grossCents: number;
  /** This line's own discount (30% off, a voucher on this item). */
  discountCents: number;
  /** The percentage printed for the discount, if any. */
  discountPercent: number | null;
  /** Whether SST applies to this line. */
  taxable: boolean;
  /** Add-ons printed under the item ("+ 2.00"), already inside the original amount unless the audit says otherwise. */
  addonCents?: number;
  /** The text of the receipt row, for showing where it came from. */
  raw?: string;
}

export interface SplitBill {
  lines: SplitLine[];
  /** A discount on the whole bill (member, voucher), shared out by price. */
  billDiscountCents: number;
  subtotalCents: number | null;
  servicePercent: number | null;
  serviceCents: number | null;
  sstPercent: number | null;
  sstCents: number | null;
  roundingCents: number | null;
  totalCents: number | null;
}

/** How this shop works the charges out; found by trying each way against the printed total. */
export interface Model {
  /** Service charge on the price after discounts, or on the original prices. */
  serviceBase: 'net' | 'gross';
  /** SST on the price after discounts, or on that plus the service charge. */
  sstBase: 'net' | 'net+service';
  /** Round the total to the nearest 5 sen, or not at all. */
  rounding: 'five' | 'none';
}

export interface Rates {
  servicePercent: number;
  sstPercent: number;
}

export interface Derived {
  grossCents: number;
  itemDiscountCents: number;
  netCents: number;
  billDiscountCents: number;
  baseCents: number;
  serviceCents: number;
  sstCents: number;
  beforeRoundingCents: number;
  roundingCents: number;
  totalCents: number;
}

export type CheckId = 'lineMath' | 'subtotal' | 'service' | 'sst' | 'rounding' | 'total';
export interface Check {
  id: CheckId;
  ok: boolean;
  /** The lines to look at when this check fails. */
  lineIds: string[];
  /** The two figures that disagree, in sen. */
  expected?: number;
  found?: number;
}

export type Status = 'verified' | 'check' | 'unverified';
