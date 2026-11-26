// A restaurant bill in sen: items, service charge, SST, the 5-sen rounding of the total, and an even split between people.
export interface BillInput {
  /** The food and drink total, in sen. */
  itemsCents: number;
  /** Percent, e.g. 10. */
  servicePercent: number;
  /** Percent, e.g. 6. */
  sstPercent: number;
  /** Some bills charge SST on the service charge too; Customs' guide says the tax is on the price without it. */
  sstOnService?: boolean;
  /** Round the total to the nearest 5 sen. */
  round?: boolean;
}

export interface Bill {
  itemsCents: number;
  serviceCents: number;
  sstCents: number;
  beforeRoundingCents: number;
  roundingCents: number;
  totalCents: number;
}

/** Percent of an amount in sen, rounded half up to a whole sen. */
export const percentOf = (cents: number, percent: number): number => Math.round((cents * Math.round(percent * 100)) / 10000);

/** Bank Negara's rule: endings of 1 or 2 sen go down, 3 or 4 go up, 6 or 7 go down, 8 or 9 go up (so a remainder of 1 or 2 against 5 goes down, 3 or 4 up). */
export function roundingFor(cents: number): number {
  const rest = ((cents % 5) + 5) % 5;
  return rest === 0 ? 0 : rest <= 2 ? -rest : 5 - rest;
}

export function calcBill(input: BillInput): Bill {
  const itemsCents = Math.max(0, Math.round(input.itemsCents));
  const serviceCents = percentOf(itemsCents, input.servicePercent);
  const sstBase = input.sstOnService ? itemsCents + serviceCents : itemsCents;
  const sstCents = percentOf(sstBase, input.sstPercent);
  const beforeRoundingCents = itemsCents + serviceCents + sstCents;
  const roundingCents = input.round === false ? 0 : roundingFor(beforeRoundingCents);
  return { itemsCents, serviceCents, sstCents, beforeRoundingCents, roundingCents, totalCents: beforeRoundingCents + roundingCents };
}

/** Shares a total between people so the shares add up exactly: everyone pays `each`, and `extra` of them pay one sen more. */
export function splitEvenly(totalCents: number, people: number): { each: number; extra: number } {
  const n = Math.max(1, Math.floor(people));
  return { each: Math.floor(totalCents / n), extra: totalCents % n };
}

/** Keeps only digits and at most one dot, so a number pad (or a paste) cannot put letters or signs into a number field. */
export function numbersOnly(value: string, decimals = true): string {
  const kept = value.replace(decimals ? /[^\d.]/g : /[^\d]/g, '');
  if (!decimals) return kept;
  const [whole = '', ...rest] = kept.split('.');
  return rest.length ? `${whole}.${rest.join('')}` : whole;
}

/** "12.5" to 1250 sen; an empty or unreadable value is 0. */
export function toSen(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
}
