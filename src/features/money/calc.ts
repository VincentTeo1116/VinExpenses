// The money arithmetic. Everything is added up as whole cents, so 0.1 + 0.2 is 0.30 and a long list never drifts.
import { advanceDue, daysBetween, monthOf, parseYmd, type Frequency } from '@/lib/dates';
import { toCents } from '@/lib/money';
import type { Budget, Expense, Income, RecurringExpense } from './types';

export const sumCents = (rows: { amount: string }[]): number => rows.reduce((total, row) => total + toCents(row.amount), 0);

export const inMonth = <T extends { created_at: string }>(rows: T[], month: string): T[] => rows.filter((row) => monthOf(row.created_at) === month);

export interface MonthTotals {
  spent: number;
  income: number;
  balance: number;
}
/** Cents spent, earned, and what is left, for one month ("2026-11"). */
export function monthTotals(expenses: Expense[], incomes: Income[], month: string): MonthTotals {
  const spent = sumCents(inMonth(expenses, month));
  const income = sumCents(inMonth(incomes, month));
  return { spent, income, balance: income - spent };
}

/** What a schedule costs in a month, on average: weekly x 52 / 12, yearly / 12. */
export function monthlyEquivalent(item: { amount: string; frequency: Frequency }): number {
  const cents = toCents(item.amount);
  if (item.frequency === 'weekly') return Math.round((cents * 52) / 12);
  if (item.frequency === 'yearly') return Math.round(cents / 12);
  return cents;
}

export interface RecurringTotals {
  active: number;
  incomePerMonth: number;
  expensePerMonth: number;
  /** Money in minus money out: positive when the schedules bring in more than they cost. */
  netPerMonth: number;
  netPerYear: number;
}
/** RC-04: income counts as plus and spending as minus. Never a plain sum of both. */
export function recurringTotals(expenses: { amount: string; frequency: Frequency; active: boolean }[], incomes: { amount: string; frequency: Frequency; active: boolean }[]): RecurringTotals {
  const outgoing = expenses.filter((item) => item.active);
  const incoming = incomes.filter((item) => item.active);
  const expensePerMonth = outgoing.reduce((total, item) => total + monthlyEquivalent(item), 0);
  const incomePerMonth = incoming.reduce((total, item) => total + monthlyEquivalent(item), 0);
  const netPerMonth = incomePerMonth - expensePerMonth;
  return { active: outgoing.length + incoming.length, incomePerMonth, expensePerMonth, netPerMonth, netPerYear: netPerMonth * 12 };
}

export interface DuePlan {
  /** The dates to post now, oldest first (at most 36 in one go). */
  dues: string[];
  /** The next due date after those. */
  next: string;
  /** The schedule has reached its end date and should switch itself off. */
  finished: boolean;
}

/** RC-02: which due dates are owed today, including any missed while the app was closed. */
export function planDue(item: { next_due: string; start_date: string; frequency: Frequency; end_date?: string | null }, today: string): DuePlan {
  const anchor = parseYmd(item.start_date).d;
  const dues: string[] = [];
  let next = item.next_due;
  const ended = () => Boolean(item.end_date) && next > (item.end_date as string);
  while (next <= today && !ended() && dues.length < 36) {
    dues.push(next);
    next = advanceDue(next, item.frequency, anchor);
  }
  return { dues, next, finished: ended() };
}

/** Resuming a paused schedule skips the dates missed while it was paused instead of posting them all. */
export function resumeDate(item: { next_due: string; start_date: string; frequency: Frequency }, today: string): string {
  const anchor = parseYmd(item.start_date).d;
  let due = item.next_due;
  let guard = 0;
  while (due < today && guard++ < 1000) due = advanceDue(due, item.frequency, anchor);
  return due;
}

export type DueWording = { kind: 'today' } | { kind: 'tomorrow' } | { kind: 'inDays'; days: number };
export function dueWording(due: string, today: string): DueWording {
  const days = daysBetween(today, due);
  if (days <= 0) return { kind: 'today' };
  if (days === 1) return { kind: 'tomorrow' };
  return { kind: 'inDays', days };
}

export interface BudgetStatus {
  limit: number;
  spent: number;
  left: number;
  /** 0 to 100+ */
  percent: number;
  level: 'ok' | 'warn' | 'over';
}
/** Progress against a limit: "warn" from 80%, "over" beyond 100%. */
export function budgetStatus(limitCents: number, spentCents: number): BudgetStatus {
  const percent = limitCents > 0 ? (spentCents / limitCents) * 100 : 0;
  return { limit: limitCents, spent: spentCents, left: limitCents - spentCents, percent, level: percent > 100 ? 'over' : percent >= 80 ? 'warn' : 'ok' };
}

export const budgetFor = (budgets: Budget[], key: string): number => {
  const row = budgets.find((budget) => budget.category === key);
  return row ? toCents(row.amount) : 0;
};

/** TX-05: did this expense push a limit across 80% or 100%? Returns the level it crossed into, or null. */
export function crossedLimit(limitCents: number, spentBefore: number, spentAfter: number): 'warn' | 'over' | null {
  if (limitCents <= 0) return null;
  const before = budgetStatus(limitCents, spentBefore).level;
  const after = budgetStatus(limitCents, spentAfter).level;
  if (after === before) return null;
  return after === 'ok' ? null : after;
}

/** TX-03: the same amount at the same place (or in the same category when there is no place) within a day of each other. */
export function findDuplicate(candidate: { amount: string; merchant: string | null; category: string; created_at: string }, existing: Expense[], ignoreId?: string): Expense | null {
  const cents = toCents(candidate.amount);
  const merchant = (candidate.merchant ?? '').trim().toLowerCase();
  const day = candidate.created_at.slice(0, 10);
  return (
    existing.find((row) => {
      if (row.id === ignoreId || toCents(row.amount) !== cents) return false;
      if (Math.abs(daysBetween(day, row.created_at.slice(0, 10))) > 1) return false;
      const other = (row.merchant ?? '').trim().toLowerCase();
      return merchant ? other === merchant : !other && row.category === candidate.category;
    }) ?? null
  );
}

export const byDateDesc = <T extends { created_at: string }>(a: T, b: T): number => b.created_at.localeCompare(a.created_at);

export type { RecurringExpense };
