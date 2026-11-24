// Made-up sample data for the preview (?demo=1) and the tests. Nothing real is read or saved.
import { dayKey, dayNumber, DAY_MS, KL_MS } from './format.ts';
import { MiniApiError, type Bootstrap, type Choice, type ExpenseValues, type Insight, type Item, type MiniApi, type MonthData, type TransactionParams } from './api.ts';

export const DEMO_CATEGORIES: Choice[] = [
  { key: 'food', label: 'Food', color: '#ef4444', active: true },
  { key: 'beverages', label: 'Beverages', color: '#4f46e5', active: true },
  { key: 'travel', label: 'Travel', color: '#06b6d4', active: true },
  { key: 'entertain', label: 'Entertainment', color: '#f59e0b', active: true },
  { key: 'shopping', label: 'Shopping', color: '#8b5cf6', active: true },
  { key: 'utilities', label: 'Utilities', color: '#0ea5e9', active: true },
  { key: 'car', label: 'Car', color: '#f97316', active: true },
  { key: 'other', label: 'Other', color: '#6b7280', active: true },
];
export const DEMO_PAYMENTS: Choice[] = [
  { key: 'cash', label: 'Cash', color: '#4f46e5', active: true },
  { key: 'card', label: 'Card', color: '#4f46e5', active: true },
  { key: 'ewallet', label: 'E-wallet', color: '#4f46e5', active: true },
];
const SHOPS: Record<string, string[]> = {
  food: ['Nasi Lemak Wanjo', 'Village Park', 'Kopitiam Ah Heng', 'Sushi Zanmai'],
  beverages: ['Starbucks', 'ZUS Coffee', 'Tealive'],
  travel: ['Grab', 'Touch n Go', 'AirAsia'],
  entertain: ['GSC Cinemas', 'Steam'],
  shopping: ['Shopee', 'Uniqlo', 'Watsons'],
  utilities: ['TNB', 'Unifi', 'Air Selangor'],
  car: ['Petronas', 'Shell'],
  other: ['Pharmacy', 'Gift'],
};
const CAT_WEIGHTS = ['food', 'food', 'food', 'beverages', 'beverages', 'travel', 'travel', 'entertain', 'shopping', 'utilities', 'car', 'other'];
const BASE: Record<string, number> = { food: 14, beverages: 9, travel: 22, entertain: 48, shopping: 85, utilities: 120, car: 70, other: 25 };

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const round2 = (n: number) => Math.round(n * 100) / 100;

export function createDemo(options: { lang?: string; now?: Date } = {}): MiniApi {
  const now = options.now ?? new Date();
  const todayKey = dayKey(now.toISOString());
  const rand = seeded(20260);
  const rows: (Omit<Item, 'amount'> & { amount: number })[] = [];
  let nextId = 1;
  const monthStartIso = (offset: number) => {
    const y = +todayKey.slice(0, 4);
    const m = +todayKey.slice(5, 7) - 1 - offset;
    return new Date(Date.UTC(y, m, 1) - KL_MS).toISOString();
  };
  const dateToIso = (date: string) => new Date(Date.parse(`${date}T12:00:00Z`) - KL_MS).toISOString();
  const put = (dayNo: number, category: string, amount: number, merchant: string) => {
    const key = new Date(dayNo * DAY_MS).toISOString().slice(0, 10);
    rows.push({ id: `demo-${nextId++}`, amount, category, payment: (DEMO_PAYMENTS[Math.floor(rand() * 3)] as Choice).key, merchant, note: '', created_at: dateToIso(key) });
  };
  const todayNo = dayNumber(todayKey);
  for (let back = 0; back < 200; back++) {
    if (rand() < 0.28) continue;
    const count = 1 + Math.floor(rand() * 3);
    for (let k = 0; k < count; k++) {
      const cat = CAT_WEIGHTS[Math.floor(rand() * CAT_WEIGHTS.length)] as string;
      const shops = SHOPS[cat] as string[];
      put(todayNo - back, cat, round2((BASE[cat] as number) * (0.5 + rand() * 1.4)), shops[Math.floor(rand() * shops.length)] as string);
    }
  }
  const budgets = [
    { key: 'all', limit: 2500 },
    { key: 'food', limit: 600 },
    { key: 'beverages', limit: 120 },
    { key: 'entertain', limit: 150 },
  ];
  const inMonth = (offset: number) => {
    const start = monthStartIso(offset);
    const end = monthStartIso(offset - 1);
    return rows.filter((r) => r.created_at >= start && r.created_at < end);
  };
  const sum = (list: { amount: number }[]) => round2(list.reduce((s, r) => s + r.amount, 0));

  function month(offset: number): MonthData {
    const start = monthStartIso(offset);
    const end = monthStartIso(offset - 1);
    const days = Math.round((Date.parse(end) - Date.parse(start)) / DAY_MS);
    const list = inMonth(offset);
    const byCat: Record<string, number> = {};
    const daily = Array<number>(days).fill(0);
    for (const r of list) {
      byCat[r.category] = (byCat[r.category] ?? 0) + r.amount;
      const index = Math.floor((Date.parse(r.created_at) - Date.parse(start)) / DAY_MS);
      if (index >= 0 && index < days) daily[index] = (daily[index] ?? 0) + r.amount;
    }
    const byCategory = Object.keys(byCat).map((k): [string, number] => [k, round2(byCat[k] as number)]).sort((a, b) => b[1] - a[1]);
    const todayIndex = offset === 0 ? Math.floor((Date.parse(`${todayKey}T12:00:00Z`) - KL_MS - Date.parse(start)) / DAY_MS) : null;
    const previous = inMonth(offset + 1);
    const totals: number[] = [];
    const starts: string[] = [];
    for (let m = 5; m >= 0; m--) {
      totals.push(sum(inMonth(offset + m)));
      starts.push(monthStartIso(offset + m));
    }
    let streak = 0;
    if (todayIndex !== null) for (let d = todayIndex; d >= 0 && (daily[d] as number) > 0; d--) streak++;
    const insights: Insight[] = [];
    if (byCategory[0]) insights.push({ kind: 'cat', key: byCategory[0][0], up: true, pct: 18 });
    insights.push({ kind: 'weekend', weekendHeavy: true, ratio: 1.4 });
    const used = budgets.map((b) => ({ key: b.key, limit: b.limit, used: b.key === 'all' ? sum(list) : round2(byCat[b.key] ?? 0) }));
    if (offset === 0 && todayIndex !== null) {
      const food = used[1] as { used: number; limit: number };
      const projected = food.used / food.limit / ((todayIndex + 1) / days);
      insights.push({ kind: 'pace', key: 'food', warn: projected > 1.1, projected, used: food.used / food.limit, day: todayIndex + 1 });
    }
    return {
      offset, start, end, days, firstWeekday: (new Date(Date.parse(start) + KL_MS).getUTCDay() + 6) % 7,
      total: sum(list), count: list.length, previousTotal: sum(previous), previousCount: previous.length, income: offset <= 1 ? 4200 : 0,
      byCategory, daily: daily.map(round2), todayIndex, budgets: used, monthTotals: totals, monthStarts: starts, streak, insights,
    };
  }

  const find = (id: string) => rows.findIndex((r) => r.id === id);
  const toAmount = (value: unknown) => Number(String(value).replace(',', '.'));

  return {
    demo: true,
    bootstrap: () => Promise.resolve<Bootstrap>({ ok: true, name: 'Sample', lang: options.lang ?? 'en', today: todayKey, categories: DEMO_CATEGORIES, payments: DEMO_PAYMENTS, maxOffset: 60, maxAmount: 1000000, maxDaysBack: 400 }),
    month: (offset) => Promise.resolve({ ok: true as const, data: month(offset) }),
    transactions: (params: TransactionParams) => {
      let list = inMonth(params.offset || 0);
      if (params.category) list = list.filter((r) => r.category === params.category);
      if (params.q) {
        const needle = String(params.q).toLowerCase();
        list = list.filter((r) => (r.merchant ?? '').toLowerCase().includes(needle) || (r.note ?? '').toLowerCase().includes(needle));
      }
      list = [...list].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      const skip = params.skip || 0;
      return Promise.resolve({ ok: true as const, items: list.slice(skip, skip + (params.limit || 50)), total: list.length, sum: sum(list) });
    },
    addExpense: (v: ExpenseValues) => {
      const amount = toAmount(v.amount);
      if (!(amount > 0)) return Promise.reject(new MiniApiError('invalid', 'amount'));
      rows.push({ id: `demo-${nextId++}`, amount, category: v.category ?? 'other', payment: v.payment ?? 'cash', merchant: v.merchant || '', note: v.note || 'via Mini App', created_at: dateToIso(v.date || todayKey) });
      return Promise.resolve({ ok: true as const });
    },
    updateExpense: (id, v) => {
      const i = find(id);
      if (i < 0) return Promise.reject(new MiniApiError('not_found'));
      const row = rows[i] as (typeof rows)[number];
      if ('amount' in v) {
        const amount = toAmount(v.amount);
        if (!(amount > 0)) return Promise.reject(new MiniApiError('invalid', 'amount'));
        row.amount = amount;
      }
      if (v.category !== undefined) row.category = v.category;
      if (v.payment !== undefined) row.payment = v.payment;
      if (v.merchant !== undefined) row.merchant = v.merchant;
      if (v.note !== undefined) row.note = v.note;
      if (v.date && v.date !== dayKey(row.created_at)) row.created_at = dateToIso(v.date);
      return Promise.resolve({ ok: true as const });
    },
    deleteExpense: (id) => {
      const i = find(id);
      if (i < 0) return Promise.reject(new MiniApiError('not_found'));
      rows.splice(i, 1);
      return Promise.resolve({ ok: true as const });
    },
  };
}
