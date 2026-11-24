// RP-01: the numbers behind the monthly report: totals, top merchants, category shares and the comparison with last month.
// A typed port of summarizeMonth and compareMonths in legacy/smart-entry.js (the monthly report email still uses that file);
// tests/ports-parity.test.js compares the two. Money is added in whole cents.
import { normalizeMerchant } from '../entry/smartEntry.ts';

export interface ReportTransaction {
  type: 'expense' | 'income';
  amount: number | string;
  merchant?: string | null;
  category?: string | null;
}
export interface MonthSummary {
  income: number;
  expenses: number;
  net: number;
  expenseCount: number;
  topMerchants: { name: string; total: number; count: number }[];
  byCategory: { key: string; total: number; share: number }[];
}

const cents = (v: unknown) => Math.round((Number(v) || 0) * 100);

export function summarizeMonth(transactions: ReportTransaction[]): MonthSummary {
  let income = 0;
  let expenses = 0;
  let expenseCount = 0;
  const merchants = new Map<string, { name: string; total: number; count: number }>();
  const categories = new Map<string, number>();
  for (const t of transactions || []) {
    if (!t) continue;
    if (t.type === 'income') {
      income += cents(t.amount);
      continue;
    }
    expenses += cents(t.amount);
    expenseCount++;
    const category = String(t.category ?? '');
    categories.set(category, (categories.get(category) ?? 0) + cents(t.amount));
    const key = normalizeMerchant(t.merchant);
    if (!key) continue;
    const m = merchants.get(key) ?? { name: String(t.merchant).trim(), total: 0, count: 0 };
    m.total += cents(t.amount);
    m.count++;
    if (String(t.merchant).trim().length < m.name.length) m.name = String(t.merchant).trim(); // show the plain name, not a branch
    merchants.set(key, m);
  }
  const topMerchants = [...merchants.values()]
    .sort((a, b) => b.total - a.total || b.count - a.count)
    .slice(0, 5)
    .map((m) => ({ name: m.name, total: m.total / 100, count: m.count }));
  const byCategory = [...categories.entries()].sort((a, b) => b[1] - a[1]).map(([key, total]) => ({ key, total: total / 100, share: expenses ? total / expenses : 0 }));
  return { income: income / 100, expenses: expenses / 100, net: (income - expenses) / 100, expenseCount, topMerchants, byCategory };
}

export interface Change {
  delta: number;
  /** A fraction (0.1 is 10%), or null when last month was zero. */
  pct: number | null;
}
export interface Comparison {
  hasPrevious: boolean;
  expenses: Change | null;
  income: Change | null;
  net: Change | null;
  categoryChanges: { key: string; delta: number; now: number; before: number }[];
}

/** Compares two summarizeMonth() results. */
export function compareMonths(current: MonthSummary, previous: MonthSummary | null): Comparison {
  const hasPrevious = !!previous && (previous.expenses > 0 || previous.income > 0);
  const diff = (a: number, b: number): Change => ({ delta: Math.round((a - b) * 100) / 100, pct: b > 0 ? (a - b) / b : null });
  const out: Comparison = { hasPrevious, expenses: null, income: null, net: null, categoryChanges: [] };
  if (!hasPrevious || !previous) return out;
  out.expenses = diff(current.expenses, previous.expenses);
  out.income = diff(current.income, previous.income);
  out.net = { delta: Math.round((current.net - previous.net) * 100) / 100, pct: null };
  const before = new Map(previous.byCategory.map((c) => [c.key, c.total]));
  const now = new Map(current.byCategory.map((c) => [c.key, c.total]));
  const keys = new Set([...before.keys(), ...now.keys()]);
  out.categoryChanges = [...keys]
    .map((key) => ({ key, delta: Math.round(((now.get(key) ?? 0) - (before.get(key) ?? 0)) * 100) / 100, now: now.get(key) ?? 0, before: before.get(key) ?? 0 }))
    .filter((c) => Math.abs(c.delta) >= 0.01)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 3);
  return out;
}
