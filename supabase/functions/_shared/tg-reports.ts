// Reports for the Telegram bot: loading the numbers (always scoped to ONE user) and turning them into pretty messages.
// The loading functions touch the database; the render functions are pure, so they are easy to test.

import { fetchAll, q } from "./db.ts";
import {
  bar,
  categoryRow,
  emojiFor,
  escapeHtml,
  formatDay,
  formatMonth,
  type Lang,
  pct,
  RULE,
  ringgit,
  trend,
  truncate,
} from "./tg-format.ts";
import { tr } from "./tg-i18n.ts";

export interface ExpenseLine {
  amount: string | number;
  category: string;
  merchant?: string | null;
}
export interface Aggregate {
  total: number;
  count: number;
  byCategory: [string, number][]; // biggest first
  byMerchant: { name: string; amount: number; n: number }[]; // biggest first
  biggest: { amount: number; merchant: string | null; category: string } | null;
}
export interface BudgetLine {
  category: string; // a category key, or "all"
  amount: number;
}
export interface BudgetUsage {
  key: string;
  limit: number;
  used: number;
  ratio: number;
}

// ---------------------------------------------------------------- loading (one user only)

export const loadExpenses = (userId: string, start: string, end: string) =>
  fetchAll<ExpenseLine>(`expenses?select=amount,category,merchant&user_id=eq.${q(userId)}&created_at=gte.${q(start)}&created_at=lt.${q(end)}&order=created_at.asc,id.asc`);

export async function loadIncomeTotal(userId: string, start: string, end: string): Promise<number> {
  const rows = await fetchAll<{ amount: string | number }>(`incomes?select=amount&user_id=eq.${q(userId)}&created_at=gte.${q(start)}&created_at=lt.${q(end)}&order=created_at.asc,id.asc`);
  return rows.reduce((sum, row) => sum + Math.round(Number(row.amount) * 100), 0) / 100;
}

/** Budgets are optional: if the table is missing or unreadable the reports simply have no budget section. */
export async function loadBudgets(userId: string): Promise<BudgetLine[]> {
  try {
    const rows = await fetchAll<{ category: string; amount: string | number }>(`budgets?select=category,amount&user_id=eq.${q(userId)}&order=category.asc`);
    return rows.map((row) => ({ category: row.category, amount: Number(row.amount) })).filter((row) => row.amount > 0);
  } catch (_error) {
    return [];
  }
}

// ---------------------------------------------------------------- pure maths

export function aggregate(rows: ExpenseLine[]): Aggregate {
  let totalCents = 0;
  const cats = new Map<string, number>();
  const places = new Map<string, { name: string; cents: number; n: number }>();
  let biggest: Aggregate["biggest"] = null;
  let biggestCents = -1;
  for (const row of rows) {
    const cents = Math.round(Number(row.amount) * 100);
    if (!Number.isFinite(cents)) continue;
    totalCents += cents;
    cats.set(row.category, (cats.get(row.category) ?? 0) + cents);
    const name = (row.merchant ?? "").replace(/\s+/g, " ").trim();
    if (name) {
      const key = name.toLowerCase();
      const entry = places.get(key) ?? { name, cents: 0, n: 0 };
      entry.cents += cents;
      entry.n += 1;
      places.set(key, entry);
    }
    if (cents > biggestCents) { biggestCents = cents; biggest = { amount: cents / 100, merchant: name || null, category: row.category }; }
  }
  return {
    total: totalCents / 100,
    count: rows.length,
    byCategory: [...cats.entries()].map(([k, c]) => [k, c / 100] as [string, number]).sort((a, b) => b[1] - a[1]),
    byMerchant: [...places.values()].map((p) => ({ name: p.name, amount: p.cents / 100, n: p.n })).sort((a, b) => b.amount - a.amount),
    biggest,
  };
}

export function budgetUsage(budgets: BudgetLine[], agg: Aggregate): BudgetUsage[] {
  const spent = new Map(agg.byCategory);
  return budgets
    .map((b) => {
      const used = b.category === "all" ? agg.total : (spent.get(b.category) ?? 0);
      return { key: b.category, limit: b.amount, used, ratio: b.amount > 0 ? used / b.amount : 0 };
    })
    .sort((a, b) => b.ratio - a.ratio);
}

// ---------------------------------------------------------------- rendering

export type Labels = (categoryKey: string) => string;

const countText = (lang: Lang, n: number) => tr(lang, n === 1 ? "expense_count_one" : "expense_count_many", { n });
const budgetName = (lang: Lang, key: string, labels: Labels) => (key === "all" ? tr(lang, "budget_overall") : labels(key));
const light = (ratio: number) => (ratio > 1 ? "🔴" : ratio >= 0.8 ? "🟡" : "🟢");

export function budgetBlock(lang: Lang, usage: BudgetUsage[], labels: Labels, limit = 5): string[] {
  if (!usage.length) return [];
  const lines = [RULE, tr(lang, "budgets_title")];
  for (const u of usage.slice(0, limit)) {
    const emoji = u.key === "all" ? "🎯" : emojiFor(u.key);
    lines.push(`${light(u.ratio)} ${emoji} ${escapeHtml(truncate(budgetName(lang, u.key, labels), 16))}  ${bar(u.ratio)} <b>${pct(u.ratio)}</b>`);
    lines.push(`    <i>${escapeHtml(ringgit(u.used))} / ${escapeHtml(ringgit(u.limit))}</i>`);
  }
  return lines;
}

export function renderToday(input: { lang: Lang; now: Date; agg: Aggregate; labels: Labels }): string {
  const { lang, now, agg, labels } = input;
  const lines = [tr(lang, "today_title", { date: formatDay(now, lang, "long") }), RULE];
  if (!agg.count) return [...lines, tr(lang, "no_expenses")].join("\n");
  lines.push(`${tr(lang, "spent")}  <b>${escapeHtml(ringgit(agg.total))}</b>  ·  ${countText(lang, agg.count)}`, RULE);
  for (const [key, amount] of agg.byCategory.slice(0, 6)) lines.push(categoryRow(key, labels(key), amount, agg.total));
  return lines.join("\n");
}

export function renderMonth(input: {
  lang: Lang;
  monthStart: Date;
  agg: Aggregate;
  previous: Aggregate | null;
  income: number;
  budgets: BudgetUsage[];
  labels: Labels;
}): string {
  const { lang, agg, previous, income, labels } = input;
  const lines = [tr(lang, "month_title", { month: formatMonth(input.monthStart, lang) }), RULE];
  if (income > 0) lines.push(`${tr(lang, "income")}  <b>${escapeHtml(ringgit(income))}</b>`);
  const t = previous ? trend(agg.total, previous.total) : { arrow: "", text: "", up: false };
  const versus = t.arrow ? `  ${t.up ? "🔺" : "🔻"} ${t.text} <i>${escapeHtml(tr(lang, "vs_last", { period: tr(lang, "period_month") }))}</i>` : "";
  lines.push(`${tr(lang, "spent")}  <b>${escapeHtml(ringgit(agg.total))}</b>${versus}`);
  if (income > 0) {
    lines.push(`${tr(lang, "net")}  <b>${escapeHtml(ringgit(income - agg.total))}</b>`);
    const rate = (income - agg.total) / income;
    lines.push(`${tr(lang, "savings")}  ${bar(Math.max(0, rate))} <b>${pct(Math.max(0, rate))}</b>`);
  }
  lines.push(`🧮 ${countText(lang, agg.count)}`);
  if (!agg.count) return [...lines, "", tr(lang, "no_expenses")].join("\n");
  lines.push(RULE, tr(lang, "top_categories"));
  for (const [key, amount] of agg.byCategory.slice(0, 6)) lines.push(categoryRow(key, labels(key), amount, agg.total));
  lines.push(...budgetBlock(lang, input.budgets, labels));
  return lines.join("\n");
}

const MEDALS = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣"];

export function renderTop(input: { lang: Lang; monthStart: Date; agg: Aggregate; labels: Labels }): string {
  const { lang, agg, labels } = input;
  const lines = [tr(lang, "top_title", { month: formatMonth(input.monthStart, lang) }), RULE];
  if (!agg.count) return [...lines, tr(lang, "no_expenses")].join("\n");
  lines.push(tr(lang, "top_categories"));
  agg.byCategory.slice(0, 5).forEach(([key, amount], i) => {
    lines.push(`${MEDALS[i]} ${emojiFor(key)} ${escapeHtml(truncate(labels(key), 16))}  ${bar(amount / agg.total)} <b>${escapeHtml(ringgit(amount))}</b>`);
  });
  if (agg.byMerchant.length) {
    lines.push(RULE, tr(lang, "top_merchants"));
    agg.byMerchant.slice(0, 5).forEach((p, i) => {
      lines.push(`${MEDALS[i]} ${escapeHtml(truncate(p.name, 22))}  <b>${escapeHtml(ringgit(p.amount))}</b>${p.n > 1 ? `  <i>×${p.n}</i>` : ""}`);
    });
  }
  return lines.join("\n");
}

export function renderDigest(input: {
  lang: Lang;
  rangeStart: Date;
  rangeEnd: Date; // last day of the week (inclusive)
  agg: Aggregate;
  previous: Aggregate | null;
  budgets: BudgetUsage[]; // month-to-date
  labels: Labels;
}): string {
  const { lang, agg, previous, labels } = input;
  const range = `${formatDay(input.rangeStart, lang)} – ${formatDay(input.rangeEnd, lang)}`;
  const lines = [tr(lang, "week_title", { range }), RULE];
  if (!agg.count) return [...lines, tr(lang, "no_expenses"), "", tr(lang, "digest_tip")].join("\n");
  const t = previous ? trend(agg.total, previous.total) : { arrow: "", text: "", up: false };
  const versus = t.arrow ? `  ${t.up ? "🔺" : "🔻"} ${t.text} <i>${escapeHtml(tr(lang, "vs_last", { period: tr(lang, "period_week") }))}</i>` : "";
  lines.push(`${tr(lang, "spent")}  <b>${escapeHtml(ringgit(agg.total))}</b>${versus}`, `🧮 ${countText(lang, agg.count)}`);
  if (agg.biggest) {
    const where = agg.biggest.merchant ? ` · ${escapeHtml(truncate(agg.biggest.merchant, 24))}` : "";
    lines.push(`${tr(lang, "biggest")}  <b>${escapeHtml(ringgit(agg.biggest.amount))}</b>${where}`);
  }
  lines.push(RULE);
  for (const [key, amount] of agg.byCategory.slice(0, 4)) lines.push(categoryRow(key, labels(key), amount, agg.total));
  const close = input.budgets.filter((u) => u.ratio >= 0.8);
  lines.push(...budgetBlock(lang, close, labels, 3));
  lines.push("", tr(lang, "digest_tip"));
  return lines.join("\n");
}
