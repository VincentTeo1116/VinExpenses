// PL-01, PL-02, PL-03, PL-04: deposit and loan maths. A typed port of legacy/finance-calc.js (the server's reminder function still uses
// that file), checked against it in tests/finance-parity.test.js. Dates are YYYY-MM-DD, money is worked out in sen and rounded half-up.
// Mistakes are returned as codes (not English sentences) so each screen can show them in the person's language.

export const LIMITS = {
  amountMin: 1,
  amountMax: 100000000,
  fdRateMax: 30,
  loanRateMax: 40,
  fdDaysMax: 3660,
  fdTenure: { days: 3650, months: 120, years: 10 },
  loanTerm: { months: 480, years: 40 },
  leadDayMax: 60,
  leadDayCount: 5,
  nameMax: 60,
} as const;

export const FD_PAYOUTS = ['maturity', 'monthly', 'quarterly', 'yearly'] as const;
export type Payout = (typeof FD_PAYOUTS)[number];
const PAYOUT_STEP: Record<string, number> = { monthly: 1, quarterly: 3, yearly: 12 };
export const LOAN_METHODS = ['reducing', 'flat'] as const;
export type LoanMethod = (typeof LOAN_METHODS)[number];
export const DEFAULT_FD_LEADS = [7, 1, 0];
export const DEFAULT_LOAN_LEADS = [3, 0];
export type TenureUnit = 'days' | 'months' | 'years';

export type FieldLabel = 'amount' | 'rate' | 'tenure' | 'term' | 'tax' | 'fees';
export interface FieldError {
  code: 'required' | 'number' | 'decimals' | 'atLeast' | 'moreThan' | 'atMost' | 'whole' | 'startDate' | 'maturityDate' | 'maturityAfter' | 'maturityMax' | 'method' | 'firstPayment' | 'tooSmall' | 'leadFormat' | 'leadMax' | 'leadCount';
  label?: FieldLabel;
  n?: number;
}
export type Errors = Record<string, FieldError>;

// ---- dates (no time zones involved: whole days counted from 1970) ----
const pad = (n: number) => String(n).padStart(2, '0');
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export function parseYmd(value: unknown): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''));
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (y < 1990 || y > 2200 || m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return { y, m, d };
}
export const isDate = (value: unknown): boolean => parseYmd(value) !== null;
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
function dayNumber(value: string): number {
  const p = parseYmd(value);
  return p ? Math.floor(Date.UTC(p.y, p.m - 1, p.d) / 86400000) : NaN;
}
function fromDayNumber(n: number): string {
  const date = new Date(n * 86400000);
  return ymd(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}
export const addDays = (value: string, n: number): string => fromDayNumber(dayNumber(value) + n);
export const daysBetween = (from: string, to: string): number => dayNumber(to) - dayNumber(from);
/** Same day of the month, n months later; a day that does not exist (31st, 29 Feb) becomes the month's last day. */
export function addMonths(value: string, n: number, anchorDay?: number): string {
  const p = parseYmd(value);
  if (!p) return '';
  const index = p.y * 12 + (p.m - 1) + n;
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return ymd(y, m, Math.min(anchorDay || p.d, daysInMonth(y, m)));
}

// ---- numbers ----
const toSen = (ringgit: number) => Math.round(Number(ringgit) * 100);
const toRinggit = (sen: number) => Math.round(sen) / 100;

type Read<T> = { value: T; error?: undefined } | { error: FieldError; value?: undefined };
interface NumberRule {
  label: FieldLabel;
  min: number;
  max: number;
  minExclusive?: boolean;
  decimals?: number;
  required?: boolean;
  fallback?: number | null;
}
function readNumber(raw: unknown, rule: NumberRule): Read<number | null> {
  const { label, min, max, minExclusive = false, decimals = 2, required = true, fallback = null } = rule;
  const text = String(raw ?? '').trim().replace(/,/g, '');
  if (text === '') return required ? { error: { code: 'required', label } } : { value: fallback };
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(text)) return { error: { code: 'number', label } };
  const value = Number(text);
  if (!Number.isFinite(value)) return { error: { code: 'number', label } };
  const scaled = value * Math.pow(10, decimals);
  if (Math.abs(scaled - Math.round(scaled)) > 1e-6) return { error: { code: 'decimals', n: decimals } };
  if (minExclusive ? value <= min : value < min) return { error: { code: minExclusive ? 'moreThan' : 'atLeast', label, n: min } };
  if (value > max) return { error: { code: 'atMost', label, n: max } };
  return { value };
}
function readWhole(raw: unknown, rule: { label: FieldLabel; min: number; max: number }): Read<number> {
  const text = String(raw ?? '').trim();
  if (text === '') return { error: { code: 'required', label: rule.label } };
  if (!/^\d+$/.test(text)) return { error: { code: 'whole', label: rule.label } };
  const value = Number(text);
  if (value < rule.min) return { error: { code: 'atLeast', label: rule.label, n: rule.min } };
  if (value > rule.max) return { error: { code: 'atMost', label: rule.label, n: rule.max } };
  return { value };
}

/** Reads reminder days such as "7, 1, 0" and returns them sorted (biggest first), or an error. */
export function readLeadDays(raw: unknown, fallback: number[]): { days: number[]; error?: undefined } | { error: FieldError; days?: undefined } {
  let parts: string[];
  if (Array.isArray(raw)) parts = raw.map((v) => String(v));
  else {
    const text = String(raw ?? '').trim();
    if (text === '') return { days: fallback.slice() };
    parts = text.split(/[\s,;]+/).filter(Boolean);
  }
  const days: number[] = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return { error: { code: 'leadFormat' } };
    const n = Number(part);
    if (n > LIMITS.leadDayMax) return { error: { code: 'leadMax', n: LIMITS.leadDayMax } };
    if (!days.includes(n)) days.push(n);
  }
  if (!days.length) return { days: fallback.slice() };
  if (days.length > LIMITS.leadDayCount) return { error: { code: 'leadCount', n: LIMITS.leadDayCount } };
  return { days: days.sort((a, b) => b - a) };
}

// ---- fixed deposits ----
export function fdAutoMaturity(startDate: string, tenureValue: number, tenureUnit: TenureUnit): string {
  if (!isDate(startDate) || !Number.isFinite(tenureValue)) return '';
  if (tenureUnit === 'days') return addDays(startDate, tenureValue);
  if (tenureUnit === 'years') return addMonths(startDate, tenureValue * 12);
  return addMonths(startDate, tenureValue);
}

export interface FdInput {
  amount: unknown;
  rate: unknown;
  tenureValue: unknown;
  tenureUnit: unknown;
  startDate: unknown;
  maturityDate?: unknown;
  payout?: unknown;
  taxRate?: unknown;
  dayBasis?: unknown;
}
interface FdValues {
  amount: number;
  rate: number;
  tenureUnit: TenureUnit;
  tenureValue: number;
  startDate: string;
  payout: Payout;
  taxRate: number;
  dayBasis: 360 | 365;
  autoMaturityDate?: string;
  maturityDate?: string;
}

export function validateFd(input: FdInput): { errors: Errors; values: Partial<FdValues>; ok: boolean } {
  const errors: Errors = {};
  const v: Partial<FdValues> = {};
  const amount = readNumber(input.amount, { label: 'amount', min: LIMITS.amountMin, max: LIMITS.amountMax });
  if (amount.error) errors.amount = amount.error;
  else v.amount = amount.value as number;

  const rate = readNumber(input.rate, { label: 'rate', min: 0, minExclusive: true, max: LIMITS.fdRateMax, decimals: 3 });
  if (rate.error) errors.rate = rate.error;
  else v.rate = rate.value as number;

  v.tenureUnit = (['days', 'months', 'years'] as const).includes(input.tenureUnit as TenureUnit) ? (input.tenureUnit as TenureUnit) : 'months';
  const tenure = readWhole(input.tenureValue, { label: 'tenure', min: 1, max: LIMITS.fdTenure[v.tenureUnit] });
  if (tenure.error) errors.tenureValue = tenure.error;
  else v.tenureValue = tenure.value;

  if (!isDate(input.startDate)) errors.startDate = { code: 'startDate' };
  else v.startDate = input.startDate as string;

  v.payout = (FD_PAYOUTS as readonly unknown[]).includes(input.payout) ? (input.payout as Payout) : 'maturity';

  const tax = readNumber(input.taxRate, { label: 'tax', min: 0, max: 100, decimals: 2, required: false, fallback: 0 });
  if (tax.error) errors.taxRate = tax.error;
  else v.taxRate = tax.value as number;

  v.dayBasis = Number(input.dayBasis) === 360 ? 360 : 365;

  if (v.startDate && v.tenureValue) v.autoMaturityDate = fdAutoMaturity(v.startDate, v.tenureValue, v.tenureUnit);
  const override = String(input.maturityDate ?? '').trim();
  if (override) {
    if (!isDate(override)) errors.maturityDate = { code: 'maturityDate' };
    else if (v.startDate && daysBetween(v.startDate, override) < 1) errors.maturityDate = { code: 'maturityAfter' };
    else if (v.startDate && daysBetween(v.startDate, override) > LIMITS.fdDaysMax) errors.maturityDate = { code: 'maturityMax' };
    else v.maturityDate = override;
  } else if (v.autoMaturityDate) {
    v.maturityDate = v.autoMaturityDate;
  }
  return { errors, values: v, ok: Object.keys(errors).length === 0 };
}

/** Interest in sen after `days`, rounded half-up. BigInt keeps it exact for very large deposits. */
function fdInterestSen(principalSen: number, rate: number, days: number, basis: number): number {
  const rateMilli = BigInt(Math.round(rate * 1000));
  const top = BigInt(principalSen) * rateMilli * BigInt(days);
  const bottom = BigInt(100000 * basis);
  return Number((top * 2n + bottom) / (bottom * 2n));
}
const taxSen = (interestSen: number, taxRate: number) => Math.round((interestSen * Math.round(taxRate * 100)) / 10000);

export interface Payment {
  n: number;
  date: string;
  days: number;
  gross: number;
  tax: number;
  net: number;
}
export interface FdResult {
  ok: true;
  errors: Errors;
  principal: number;
  rate: number;
  taxRate: number;
  dayBasis: number;
  payout: Payout;
  tenureValue: number;
  tenureUnit: TenureUnit;
  startDate: string;
  maturityDate: string;
  autoMaturityDate: string | undefined;
  maturityOverridden: boolean;
  days: number;
  grossInterest: number;
  tax: number;
  netInterest: number;
  maturityAmount: number;
  effectiveYield: number;
  payouts: Payment[];
  interestAfter: (days: number) => number;
  daysElapsed?: number;
  daysLeft?: number;
  earnedSoFar?: number;
  progress?: number;
}
export type Failed = { ok: false; errors: Errors };

export function calcFd(input: FdInput, options?: { today?: string }): FdResult | Failed {
  const today = options && isDate(options.today) ? (options.today as string) : null;
  const { errors, values, ok } = validateFd(input);
  if (!ok) return { ok: false, errors };
  const v = values as FdValues & { maturityDate: string };

  const days = daysBetween(v.startDate, v.maturityDate);
  const principalSen = toSen(v.amount);
  const cum = (d: number) => fdInterestSen(principalSen, v.rate, d, v.dayBasis);
  const grossSen = cum(days);
  const totalTaxSen = taxSen(grossSen, v.taxRate);

  // Payout dates: every step months after the start, with the maturity date always last
  const dates: string[] = [];
  const step = PAYOUT_STEP[v.payout];
  if (step) {
    for (let k = 1; k <= 400; k++) {
      const date = addMonths(v.startDate, k * step);
      if (date >= v.maturityDate) break;
      dates.push(date);
    }
  }
  dates.push(v.maturityDate);

  // Each payout is the difference between two rounded running totals, so the payouts always add up exactly
  const payouts: Payment[] = [];
  let previousDays = 0;
  let previousGross = 0;
  let previousTax = 0;
  dates.forEach((date, index) => {
    const elapsed = daysBetween(v.startDate, date);
    const gross = cum(elapsed);
    const taxed = index === dates.length - 1 ? totalTaxSen : taxSen(gross, v.taxRate);
    payouts.push({ n: index + 1, date, days: elapsed - previousDays, gross: toRinggit(gross - previousGross), tax: toRinggit(taxed - previousTax), net: toRinggit(gross - previousGross - (taxed - previousTax)) });
    previousDays = elapsed;
    previousGross = gross;
    previousTax = taxed;
  });

  const netSen = grossSen - totalTaxSen;
  const result: FdResult = {
    ok: true,
    errors: {},
    principal: v.amount,
    rate: v.rate,
    taxRate: v.taxRate,
    dayBasis: v.dayBasis,
    payout: v.payout,
    tenureValue: v.tenureValue,
    tenureUnit: v.tenureUnit,
    startDate: v.startDate,
    maturityDate: v.maturityDate,
    autoMaturityDate: v.autoMaturityDate,
    maturityOverridden: !!v.autoMaturityDate && v.autoMaturityDate !== v.maturityDate,
    days,
    grossInterest: toRinggit(grossSen),
    tax: toRinggit(totalTaxSen),
    netInterest: toRinggit(netSen),
    maturityAmount: toRinggit(principalSen + netSen),
    effectiveYield: days > 0 ? (netSen / principalSen) * (365 / days) * 100 : 0,
    payouts,
    interestAfter: (d) => toRinggit(cum(Math.max(0, Math.min(days, d)))),
  };
  if (today) {
    const elapsed = Math.max(0, Math.min(days, daysBetween(v.startDate, today)));
    result.daysElapsed = elapsed;
    result.daysLeft = daysBetween(today, v.maturityDate);
    result.earnedSoFar = toRinggit(cum(elapsed));
    result.progress = days > 0 ? elapsed / days : 0;
  }
  return result;
}

export type FdView = 'daily' | 'monthly' | 'yearly';
const FD_PAGE: Record<FdView, number> = { daily: 31, monthly: 12, yearly: 50 };
export interface FdRow {
  n: number;
  view: FdView;
  from: string;
  to: string;
  days: number;
  interest: number;
  cumulative: number;
  payout: number;
}
export interface Page<T> {
  rows: T[];
  page: number;
  pageCount: number;
  total: number;
  pageSize?: number;
}

/** One page of the earnings table: daily, monthly or yearly. */
export function fdSchedule(result: FdResult | Failed | null, view: FdView, page: number): Page<FdRow> & { view: FdView } {
  if (!result || !result.ok) return { rows: [], page: 0, pageCount: 0, total: 0, view };
  const mode: FdView = FD_PAGE[view] ? view : 'monthly';
  const size = FD_PAGE[mode];
  const payoutOn = new Map<string, number>();
  result.payouts.forEach((p) => payoutOn.set(p.date, (payoutOn.get(p.date) ?? 0) + toSen(p.net)));
  const paidBetween = (fromExclusive: string, toInclusive: string) => {
    let sum = 0;
    payoutOn.forEach((sen, date) => {
      if (date > fromExclusive && date <= toInclusive) sum += sen;
    });
    return toRinggit(sum);
  };

  let total: number;
  let boundary: (k: number) => string;
  if (mode === 'daily') {
    total = result.days;
    boundary = (k) => addDays(result.startDate, k);
  } else {
    const stepMonths = mode === 'yearly' ? 12 : 1;
    const ends: string[] = [];
    for (let k = 1; k <= 400; k++) {
      const date = addMonths(result.startDate, k * stepMonths);
      if (date >= result.maturityDate) break;
      ends.push(date);
    }
    ends.push(result.maturityDate);
    total = ends.length;
    boundary = (k) => (k === 0 ? result.startDate : (ends[k - 1] as string));
  }
  const pageCount = Math.max(1, Math.ceil(total / size));
  const current = Math.max(0, Math.min(pageCount - 1, Number(page) || 0));
  const rows: FdRow[] = [];
  for (let k = current * size + 1; k <= Math.min(total, (current + 1) * size); k++) {
    const from = boundary(k - 1);
    const to = boundary(k);
    const before = result.interestAfter(daysBetween(result.startDate, from));
    const after = result.interestAfter(daysBetween(result.startDate, to));
    rows.push({ n: k, view: mode, from, to, days: daysBetween(from, to), interest: toRinggit(toSen(after) - toSen(before)), cumulative: after, payout: paidBetween(from, to) });
  }
  return { rows, page: current, pageCount, total, view: mode, pageSize: size };
}

/** Points for the growth chart: interest earned so far against time (at most maxPoints). */
export function fdChartSeries(result: FdResult | Failed | null, maxPoints = 48): { day: number; date: string; value: number }[] {
  if (!result || !result.ok) return [];
  const count = Math.max(2, Math.min(maxPoints, result.days + 1));
  const points = [];
  for (let i = 0; i < count; i++) {
    const d = Math.round((result.days * i) / (count - 1));
    points.push({ day: d, date: addDays(result.startDate, d), value: result.interestAfter(d) });
  }
  return points;
}

// ---- loans ----
export interface LoanInput {
  amount: unknown;
  rate: unknown;
  termValue: unknown;
  termUnit: unknown;
  method: unknown;
  firstPaymentDate: unknown;
  fees?: unknown;
}
interface LoanValues {
  amount: number;
  rate: number;
  termUnit: 'months' | 'years';
  termValue: number;
  months: number;
  method: LoanMethod;
  firstPaymentDate: string;
  fees: number;
}

export function validateLoan(input: LoanInput): { errors: Errors; values: Partial<LoanValues>; ok: boolean } {
  const errors: Errors = {};
  const v: Partial<LoanValues> = {};
  const amount = readNumber(input.amount, { label: 'amount', min: LIMITS.amountMin, max: LIMITS.amountMax });
  if (amount.error) errors.amount = amount.error;
  else v.amount = amount.value as number;

  const rate = readNumber(input.rate, { label: 'rate', min: 0, max: LIMITS.loanRateMax, decimals: 3 });
  if (rate.error) errors.rate = rate.error;
  else v.rate = rate.value as number;

  v.termUnit = input.termUnit === 'months' ? 'months' : 'years';
  const term = readWhole(input.termValue, { label: 'term', min: 1, max: LIMITS.loanTerm[v.termUnit] });
  if (term.error) errors.termValue = term.error;
  else {
    v.termValue = term.value;
    v.months = v.termUnit === 'years' ? term.value * 12 : term.value;
  }

  if (!(LOAN_METHODS as readonly unknown[]).includes(input.method)) errors.method = { code: 'method' };
  else v.method = input.method as LoanMethod;

  if (!isDate(input.firstPaymentDate)) errors.firstPaymentDate = { code: 'firstPayment' };
  else v.firstPaymentDate = input.firstPaymentDate as string;

  const fees = readNumber(input.fees, { label: 'fees', min: 0, max: LIMITS.amountMax, required: false, fallback: 0 });
  if (fees.error) errors.fees = fees.error;
  else v.fees = fees.value as number;

  return { errors, values: v, ok: Object.keys(errors).length === 0 };
}

/** The yearly rate that gives these payments, so a flat loan can be compared with a reducing one. */
function effectiveAnnualRate(principalSen: number, payments: number[]): number {
  const total = payments.reduce((s, p) => s + p, 0);
  if (total <= principalSen) return 0;
  const presentValue = (i: number) => payments.reduce((sum, p, k) => sum + p / Math.pow(1 + i, k + 1), 0);
  let low = 0;
  let high = 1;
  for (let step = 0; step < 80; step++) {
    const mid = (low + high) / 2;
    if (presentValue(mid) > principalSen) low = mid;
    else high = mid;
  }
  return ((low + high) / 2) * 12 * 100;
}

export interface LoanRow {
  n: number;
  date: string;
  payment: number;
  principal: number;
  interest: number;
  balance: number;
}
export interface LoanYear {
  n: number;
  from: string;
  to: string;
  months: number;
  payment: number;
  principal: number;
  interest: number;
  balance: number;
}
export interface LoanResult {
  ok: true;
  errors: Errors;
  principal: number;
  rate: number;
  method: LoanMethod;
  months: number;
  termValue: number;
  termUnit: 'months' | 'years';
  fees: number;
  firstPaymentDate: string;
  lastPaymentDate: string;
  instalment: number;
  lastInstalment: number;
  totalInterest: number;
  totalPayments: number;
  totalCost: number;
  effectiveRate: number;
  costPerMonth: number;
  costPerYear: number;
  costPerDay: number;
  schedule: LoanRow[];
  yearly: LoanYear[];
}

export function calcLoan(input: LoanInput): LoanResult | Failed {
  const { errors, values, ok } = validateLoan(input);
  if (!ok) return { ok: false, errors };
  const v = values as LoanValues;

  const n = v.months;
  const principalSen = toSen(v.amount);
  const anchor = (parseYmd(v.firstPaymentDate) as { d: number }).d;
  const rows: { n: number; date: string; payment: number; principal: number; interest: number; balance: number }[] = [];
  let instalmentSen: number;

  if (v.method === 'flat') {
    const interestTotal = Math.round((principalSen * v.rate * n) / 1200);
    const total = principalSen + interestTotal;
    instalmentSen = Math.round(total / n);
    let balance = principalSen;
    let paid = 0;
    let interestSoFar = 0;
    for (let k = 1; k <= n; k++) {
      const payment = k === n ? total - paid : instalmentSen;
      const interestCum = Math.round((interestTotal * k) / n); // interest is spread evenly over the months
      const interest = interestCum - interestSoFar;
      const principal = k === n ? balance : payment - interest;
      balance -= principal;
      paid += payment;
      interestSoFar = interestCum;
      rows.push({ n: k, date: addMonths(v.firstPaymentDate, k - 1, anchor), payment, principal, interest, balance });
    }
  } else {
    const monthly = v.rate / 1200;
    instalmentSen = monthly === 0 ? Math.round(principalSen / n) : Math.round((principalSen * monthly) / (1 - Math.pow(1 + monthly, -n)));
    let balance = principalSen;
    for (let k = 1; k <= n; k++) {
      const interest = Math.round(balance * monthly);
      let principal = k === n ? balance : Math.min(balance, instalmentSen - interest);
      if (principal < 0) principal = 0;
      const payment = principal + interest;
      balance -= principal;
      rows.push({ n: k, date: addMonths(v.firstPaymentDate, k - 1, anchor), payment, principal, interest, balance });
    }
  }

  if (instalmentSen < 1 || rows.some((r) => r.payment < 0)) return { ok: false, errors: { amount: { code: 'tooSmall', n } } };

  const sum = (list: { payment: number }[], pick: 'payment' | 'principal' | 'interest') => list.reduce((s, r) => s + (r as unknown as Record<string, number>)[pick]!, 0);
  const totalPayments = sum(rows, 'payment');
  const totalInterest = sum(rows, 'interest');
  const feesSen = toSen(v.fees);
  const schedule: LoanRow[] = rows.map((r) => ({ n: r.n, date: r.date, payment: toRinggit(r.payment), principal: toRinggit(r.principal), interest: toRinggit(r.interest), balance: toRinggit(r.balance) }));

  const yearly: LoanYear[] = [];
  for (let start = 0; start < rows.length; start += 12) {
    const chunk = rows.slice(start, start + 12);
    yearly.push({
      n: yearly.length + 1,
      from: (chunk[0] as { date: string }).date,
      to: (chunk[chunk.length - 1] as { date: string }).date,
      months: chunk.length,
      payment: toRinggit(sum(chunk, 'payment')),
      principal: toRinggit(sum(chunk, 'principal')),
      interest: toRinggit(sum(chunk, 'interest')),
      balance: toRinggit((chunk[chunk.length - 1] as { balance: number }).balance),
    });
  }

  const last = rows[rows.length - 1] as { date: string; payment: number };
  return {
    ok: true,
    errors: {},
    principal: v.amount,
    rate: v.rate,
    method: v.method,
    months: n,
    termValue: v.termValue,
    termUnit: v.termUnit,
    fees: v.fees,
    firstPaymentDate: v.firstPaymentDate,
    lastPaymentDate: last.date,
    instalment: toRinggit(instalmentSen),
    lastInstalment: toRinggit(last.payment),
    totalInterest: toRinggit(totalInterest),
    totalPayments: toRinggit(totalPayments),
    totalCost: toRinggit(totalPayments + feesSen),
    effectiveRate: v.method === 'flat' ? effectiveAnnualRate(principalSen, rows.map((r) => r.payment)) : v.rate,
    costPerMonth: toRinggit(instalmentSen),
    costPerYear: toRinggit(instalmentSen * 12),
    costPerDay: toRinggit((instalmentSen * 12) / 365),
    schedule,
    yearly,
  };
}

const LOAN_PAGE = 12;
/** One page (12 months) of the repayment table, or the whole yearly summary. */
export function loanSchedule(result: LoanResult | Failed | null, view: 'monthly' | 'yearly', page: number): Page<LoanRow> & { view: 'monthly' } | Page<LoanYear> & { view: 'yearly' } {
  if (!result || !result.ok) return { rows: [], page: 0, pageCount: 0, total: 0, view: 'monthly' };
  if (view === 'yearly') return { rows: result.yearly, page: 0, pageCount: 1, total: result.yearly.length, view: 'yearly', pageSize: result.yearly.length };
  const pageCount = Math.max(1, Math.ceil(result.schedule.length / LOAN_PAGE));
  const current = Math.max(0, Math.min(pageCount - 1, Number(page) || 0));
  return { rows: result.schedule.slice(current * LOAN_PAGE, (current + 1) * LOAN_PAGE), page: current, pageCount, total: result.schedule.length, view: 'monthly', pageSize: LOAN_PAGE };
}

// ---- saved items: database rows to calculator input, status and progress ----
export interface DepositRow {
  id: string;
  user_id?: string;
  name: string;
  bank: string | null;
  principal: number | string;
  rate: number | string;
  start_date: string;
  tenure_value: number;
  tenure_unit: TenureUnit;
  maturity_date: string;
  payout: Payout;
  tax_rate: number | string | null;
  day_basis: number;
  reminders_on: boolean;
  reminder_days: number[];
  status: 'open' | 'closed';
  interest_recorded: boolean;
}
export interface LoanSaved {
  id: string;
  user_id?: string;
  name: string;
  lender: string | null;
  principal: number | string;
  rate: number | string;
  method: LoanMethod;
  term_months: number;
  first_payment_date: string;
  fees: number | string | null;
  instalment?: number | string | null;
  reminders_on: boolean;
  reminder_days: number[];
  status: 'open' | 'closed';
  paid_through: string | null;
}

export const fdInputFromRow = (row: DepositRow): FdInput => ({ amount: row.principal, rate: row.rate, tenureValue: row.tenure_value, tenureUnit: row.tenure_unit, startDate: row.start_date, maturityDate: row.maturity_date, payout: row.payout, taxRate: row.tax_rate ?? 0, dayBasis: row.day_basis });
export const loanInputFromRow = (row: LoanSaved): LoanInput => ({ amount: row.principal, rate: row.rate, termValue: row.term_months, termUnit: 'months', method: row.method, firstPaymentDate: row.first_payment_date, fees: row.fees ?? 0 });

/** Worked out from dates, so it is right even if no reminder has run. */
export function fdStatus(row: Pick<DepositRow, 'status' | 'start_date' | 'maturity_date'>, today: string): 'closed' | 'upcoming' | 'active' | 'matured' {
  if (row.status === 'closed') return 'closed';
  if (row.start_date > today) return 'upcoming';
  return row.maturity_date <= today ? 'matured' : 'active';
}

export interface LoanProgress {
  ok: true;
  result: LoanResult;
  status: 'closed' | 'finished' | 'upcoming' | 'active';
  paidCount: number;
  total: number;
  balance: number;
  nextDue: string | null;
  nextAmount: number;
  overdue: string[];
  firstUnpaid: string | null;
}
/** Where a saved loan stands today. `autoPaid` means every due date so far counts as paid. */
export function loanProgress(row: LoanSaved, today: string, options?: { autoPaid?: boolean }): LoanProgress | { ok: false } {
  const result = calcLoan(loanInputFromRow(row));
  if (!result.ok) return { ok: false };
  const autoPaid = !!options?.autoPaid;
  const dates = result.schedule.map((r) => r.date);
  const paidThrough = autoPaid ? today : isDate(row.paid_through) ? (row.paid_through as string) : '';
  const paidCount = dates.filter((d) => paidThrough && d <= paidThrough).length;
  const unpaidDue = autoPaid ? [] : dates.filter((d) => d < today && !(paidThrough && d <= paidThrough));
  const nextDue = dates.find((d) => d >= today && !(paidThrough && d <= paidThrough)) ?? null;
  let status: LoanProgress['status'] = 'active';
  if (row.status === 'closed') status = 'closed';
  else if (paidCount >= dates.length || (autoPaid && result.lastPaymentDate < today)) status = 'finished';
  else if (result.firstPaymentDate > today && paidCount === 0) status = 'upcoming';
  return {
    ok: true,
    result,
    status,
    paidCount,
    total: dates.length,
    balance: paidCount > 0 ? (result.schedule[paidCount - 1] as LoanRow).balance : result.principal,
    nextDue,
    nextAmount: nextDue ? (result.schedule[dates.indexOf(nextDue)] as LoanRow).payment : 0,
    overdue: unpaidDue,
    firstUnpaid: unpaidDue.length ? (unpaidDue[0] as string) : nextDue,
  };
}

/** The latest due date before today (what a newly saved loan assumes was already paid), or "" if none yet. */
export function lastDueBefore(row: LoanSaved, today: string): string {
  const result = calcLoan(loanInputFromRow(row));
  if (!result.ok) return '';
  const past = result.schedule.filter((r) => r.date < today);
  return past.length ? (past[past.length - 1] as LoanRow).date : '';
}

// ---- reminders: only the current milestone matters; a missed one is never sent late as well ----
export function milestoneFor(daysLeft: number, leads: number[]): number | null {
  const fitting = leads.filter((lead) => lead >= daysLeft);
  return fitting.length ? Math.min(...fitting) : null;
}
const leadsOf = (row: { reminder_days?: number[] }, fallback: number[]): number[] => {
  const read = readLeadDays(Array.isArray(row.reminder_days) ? row.reminder_days : fallback, fallback);
  return read.days && read.days.length ? read.days : fallback;
};

export interface Reminder {
  kind: 'fd' | 'loan';
  id: string;
  name: string;
  dueDate: string;
  daysLeft: number;
  group: 'overdue' | 'today' | 'soon';
  milestone: number;
  amount?: number;
  count?: number;
  firstUnpaid?: string | null;
}

export function fdReminder(row: DepositRow, today: string, options?: { lateDays?: number }): Reminder | null {
  if (row.status === 'closed' || row.reminders_on === false || !isDate(row.maturity_date) || !isDate(today)) return null;
  const lateDays = options?.lateDays ?? 30;
  const leads = leadsOf(row, DEFAULT_FD_LEADS);
  const daysLeft = daysBetween(today, row.maturity_date);
  const base = { kind: 'fd' as const, id: row.id, name: row.name, dueDate: row.maturity_date, daysLeft };
  if (daysLeft < 0) {
    if (-daysLeft > lateDays) return null;
    return { ...base, group: 'overdue', milestone: 0 };
  }
  const milestone = milestoneFor(daysLeft, leads);
  if (milestone === null) return null;
  return { ...base, group: daysLeft === 0 ? 'today' : 'soon', milestone };
}

/** Up to two entries: missed payments (not for auto-paid loans) and the next one coming up. */
export function loanReminders(row: LoanSaved, today: string, options?: { lateDays?: number; autoPaid?: boolean }): Reminder[] {
  if (row.status === 'closed' || row.reminders_on === false || !isDate(today)) return [];
  const lateDays = options?.lateDays ?? 30;
  const progress = loanProgress(row, today, options);
  if (!progress.ok || progress.status === 'finished') return [];
  const leads = leadsOf(row, DEFAULT_LOAN_LEADS);
  const out: Reminder[] = [];
  const amountOn = (date: string) => progress.result.schedule.find((s) => s.date === date)?.payment ?? progress.result.instalment;
  const recent = progress.overdue.filter((d) => daysBetween(d, today) <= lateDays);
  if (recent.length) {
    const latest = recent[recent.length - 1] as string;
    out.push({ kind: 'loan', id: row.id, name: row.name, dueDate: latest, daysLeft: daysBetween(today, latest), group: 'overdue', milestone: 0, count: progress.overdue.length, amount: amountOn(latest), firstUnpaid: progress.overdue[0] });
  }
  if (progress.nextDue) {
    const daysLeft = daysBetween(today, progress.nextDue);
    const milestone = milestoneFor(daysLeft, leads);
    if (milestone !== null) out.push({ kind: 'loan', id: row.id, name: row.name, dueDate: progress.nextDue, daysLeft, group: daysLeft === 0 ? 'today' : 'soon', milestone, amount: amountOn(progress.nextDue) });
  }
  return out;
}

/** Everything worth a reminder today, most urgent first. */
export function dueReminders(deposits: DepositRow[], loans: LoanSaved[], today: string, options?: { lateDays?: number; autoPaidLoanIds?: string[] }): Reminder[] {
  const auto = new Set(options?.autoPaidLoanIds ?? []);
  const list: Reminder[] = [];
  for (const row of deposits) {
    const r = fdReminder(row, today, options);
    if (!r) continue;
    const calc = calcFd(fdInputFromRow(row));
    r.amount = calc.ok ? calc.maturityAmount : Number(row.principal) || 0;
    list.push(r);
  }
  for (const row of loans) list.push(...loanReminders(row, today, { ...options, autoPaid: auto.has(row.id) }));
  const rank = { overdue: 0, today: 1, soon: 2 };
  return list.sort((a, b) => rank[a.group] - rank[b.group] || a.dueDate.localeCompare(b.dueDate) || String(a.name).localeCompare(String(b.name)));
}
