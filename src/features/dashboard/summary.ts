// DB-01 … DB-10: the numbers behind the dashboard. Pure functions, all in whole cents, tested without a screen.
import { daysBetween, daysInMonth, isoToYmd, monthKey, monthOf, parseYmd, todayYmd } from '@/lib/dates';
import { toCents } from '@/lib/money';
import { budgetStatus, inMonth, sumCents, type BudgetStatus } from '@/features/money/calc';
import type { Expense, Income, RecurringExpense } from '@/features/money/types';

/** A bill that a recurring entry posted by itself (rent, a loan payment, a subscription): the same every month. */
export function isFixedBill(expense: Pick<Expense, 'merchant' | 'note'>, recurring: Pick<RecurringExpense, 'name'>[]): boolean {
  const name = (expense.merchant ?? '').trim();
  return name !== '' && name === (expense.note ?? '').trim() && recurring.some((item) => item.name === name);
}

export const shiftMonth = (month: string, delta: number): string => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const date = new Date(y, m - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

export interface CategorySlice {
  key: string;
  cents: number;
  percent: number;
}
/** Where the money went, biggest first. */
export function categoryBreakdown(expenses: Expense[], month: string): CategorySlice[] {
  const rows = inMonth(expenses, month);
  const total = sumCents(rows);
  const byKey = new Map<string, number>();
  for (const row of rows) byKey.set(row.category, (byKey.get(row.category) ?? 0) + toCents(row.amount));
  return [...byKey.entries()]
    .map(([key, cents]) => ({ key, cents, percent: total > 0 ? (cents / total) * 100 : 0 }))
    .filter((slice) => slice.cents > 0)
    .sort((a, b) => b.cents - a.cents);
}

export interface TrendPoint {
  month: string;
  spent: number;
  income: number;
}
/** The last `count` months ending at `endMonth`, oldest first. */
export function trend(expenses: Expense[], incomes: Income[], endMonth: string, count = 6): TrendPoint[] {
  return Array.from({ length: count }, (_, i) => {
    const month = shiftMonth(endMonth, i - (count - 1));
    return { month, spent: sumCents(inMonth(expenses, month)), income: sumCents(inMonth(incomes, month)) };
  });
}

export interface Comparison {
  /** Whole percent change versus the same days of the previous month, or null when there is nothing to compare. */
  percent: number | null;
  /** The number of days compared when this is the current month (a part month). */
  throughDay: number | null;
  previousMonth: string;
}
/** Spending so far against the SAME days of last month, so half a month is never set against a whole one. */
export function compareWithLastMonth(expenses: Expense[], month: string, today: string): Comparison {
  const previousMonth = shiftMonth(month, -1);
  const current = monthKey(today) === month;
  const through = current ? parseYmd(today).d : 31;
  const spent = sumCents(inMonth(expenses, month));
  const before = sumCents(inMonth(expenses, previousMonth).filter((row) => parseYmd(isoToYmd(row.created_at)).d <= through));
  if (before <= 0) return { percent: null, throughDay: current ? through : null, previousMonth };
  return { percent: Math.round(((spent - before) / before) * 100), throughDay: current ? through : null, previousMonth };
}

export interface Insights {
  dailyAverage: number;
  /** The daily average left out this much money of fixed bills. */
  fixedBills: number;
  separated: boolean;
  topCategory: CategorySlice | null;
  largest: Expense | null;
  /** Days the daily average is spread over. */
  days: number;
}
export function insights(expenses: Expense[], recurring: Pick<RecurringExpense, 'name'>[], month: string, today: string): Insights {
  const all = inMonth(expenses, month);
  const fixed = all.filter((row) => isFixedBill(row, recurring));
  // Everyday spending, unless every record is a fixed bill (then there is nothing to separate)
  const separated = fixed.length > 0 && fixed.length < all.length;
  const everyday = separated ? all.filter((row) => !isFixedBill(row, recurring)) : all;
  const [y, m] = month.split('-').map(Number) as [number, number];
  const current = monthKey(today) === month;
  const future = month > monthKey(today);
  const days = current ? parseYmd(today).d : daysInMonth(y, m);
  const sum = sumCents(everyday);
  const slices = categoryBreakdown(everyday, month);
  const largest = [...all].sort((a, b) => toCents(b.amount) - toCents(a.amount))[0] ?? null;
  return { dailyAverage: future ? 0 : Math.round(sum / Math.max(1, days)), fixedBills: sumCents(fixed), separated, topCategory: slices[0] ?? null, largest, days };
}

/** What is safe to spend each remaining day (today counts), or null when it does not apply. */
export function safeToSpend(limitCents: number, spentCents: number, month: string, today: string): { perDay: number; left: number; daysLeft: number } | null {
  if (limitCents <= 0 || monthKey(today) !== month) return null;
  const { y, m, d } = parseYmd(today);
  const daysLeft = daysInMonth(y, m) - d + 1;
  const left = limitCents - spentCents;
  return left > 0 ? { perDay: Math.floor(left / daysLeft), left, daysLeft } : null;
}

export interface Forecast {
  projected: number;
  /** The budget would be passed by month end at this pace, although it has not been passed yet. */
  willExceed: boolean;
}
/** BU-02: where the month will end at the current pace. Only for the current month, and only once a few days have passed. */
export function forecastMonth(spentCents: number, limitCents: number, month: string, today: string): Forecast | null {
  if (monthKey(today) !== month) return null;
  const { y, m, d } = parseYmd(today);
  if (d < 5 || spentCents <= 0) return null;
  const projected = Math.round((spentCents / d) * daysInMonth(y, m));
  return { projected, willExceed: limitCents > 0 && spentCents <= limitCents && projected > limitCents };
}

export interface Patterns {
  last7: number;
  previous7: number;
  /** Percent change, or null with nothing to compare. */
  change: number | null;
  repeats: { merchant: string; every: 'week' | 'month'; count: number }[];
}
/** The last 7 days against the 7 before, and merchants that keep coming back on a weekly or monthly rhythm. Never added automatically. */
export function spendingPatterns(expenses: Expense[], today: string): Patterns {
  const dayOf = (row: Expense) => isoToYmd(row.created_at);
  const within = (from: number, to: number) => expenses.filter((row) => {
    const ago = daysBetween(dayOf(row), today);
    return ago >= from && ago <= to;
  });
  const last7 = sumCents(within(0, 6));
  const previous7 = sumCents(within(7, 13));
  const byMerchant = new Map<string, string[]>();
  for (const row of expenses) {
    const name = (row.merchant ?? '').trim().toLowerCase();
    if (!name || row.note === row.merchant) continue; // already a recurring entry
    byMerchant.set(name, [...(byMerchant.get(name) ?? []), dayOf(row)]);
  }
  const repeats: Patterns['repeats'] = [];
  for (const [merchant, days] of byMerchant) {
    const sorted = [...new Set(days)].sort();
    if (sorted.length < 3) continue;
    const gaps = sorted.slice(1).map((day, i) => daysBetween(sorted[i] as string, day));
    const weekly = gaps.every((gap) => gap >= 6 && gap <= 8);
    const monthly = gaps.every((gap) => gap >= 27 && gap <= 33);
    if (weekly || monthly) repeats.push({ merchant, every: weekly ? 'week' : 'month', count: sorted.length });
  }
  return { last7, previous7, change: previous7 > 0 ? Math.round(((last7 - previous7) / previous7) * 100) : null, repeats: repeats.slice(0, 3) };
}

export interface Frequent {
  merchant: string;
  count: number;
  latest: Expense;
}
/** Places the person goes to again and again, with what they usually pay: one tap to add them. */
export function frequentMerchants(expenses: Expense[], limit = 4): Frequent[] {
  const map = new Map<string, Frequent>();
  for (const row of expenses) {
    const name = (row.merchant ?? '').trim();
    if (!name || row.note === row.merchant) continue;
    const key = name.toLowerCase();
    const entry = map.get(key);
    if (!entry) map.set(key, { merchant: name, count: 1, latest: row });
    else {
      entry.count += 1;
      if (row.created_at > entry.latest.created_at) entry.latest = row;
    }
  }
  return [...map.values()].filter((entry) => entry.count >= 2).sort((a, b) => b.count - a.count || b.latest.created_at.localeCompare(a.latest.created_at)).slice(0, limit);
}

export interface Headline {
  spent: number;
  income: number;
  balance: number;
  overall: BudgetStatus | null;
}
export function headline(expenses: Expense[], incomes: Income[], overallLimit: number, month: string): Headline {
  const spent = sumCents(inMonth(expenses, month));
  const income = sumCents(inMonth(incomes, month));
  return { spent, income, balance: income - spent, overall: overallLimit > 0 ? budgetStatus(overallLimit, spent) : null };
}

export { monthOf, todayYmd };
