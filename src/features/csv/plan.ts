// CS-01: turns what a CSV file says into records that are ready to add, leaving out what is already in the app
// and guessing categories the same way the add sheet does. Pure, so it can be tested without a screen.
import { ymdToNoonIso, isoToYmd } from '@/lib/dates';
import { toCents } from '@/lib/money';
import { findDuplicate } from '@/features/money/calc';
import { buildMerchantMemory, suggestCategory, type CategoryLite } from '@/features/entry/smartEntry';
import type { Expense, Income } from '@/features/money/types';
import type { ImportedRecord } from './csv';
import type { NewExpense, NewIncome } from '@/features/money/data';

interface Named {
  key: string;
  label: string;
}

function matchByLabel<T extends Named>(items: T[], text: string): T | null {
  const wanted = String(text || '').trim().toLowerCase();
  if (!wanted) return null;
  return items.find((i) => i.key.toLowerCase() === wanted || String(i.label).toLowerCase() === wanted) ?? null;
}

export interface ImportPlan {
  expenses: NewExpense[];
  incomes: NewIncome[];
  duplicates: number;
}

export function planImport(records: ImportedRecord[], context: { categories: (Named & { builtin?: boolean })[]; payments: Named[]; expenses: Expense[]; incomes: Income[] }): ImportPlan {
  const { categories, payments } = context;
  const lite: CategoryLite[] = categories.map((c) => ({ key: c.key, label: c.label, active: true, is_builtin: c.builtin ?? false }));
  const defaultPayment = (payments.find((p) => p.key === 'bank') ?? payments[0])?.key ?? 'bank';
  const memory = buildMerchantMemory(context.expenses);
  const plan: ImportPlan = { expenses: [], incomes: [], duplicates: 0 };
  const seenExpenses: Expense[] = [...context.expenses];

  for (const r of records) {
    const createdAt = ymdToNoonIso(r.date);
    if (r.type === 'income') {
      const source = r.source || r.merchant || 'Salary';
      const twin = context.incomes.find((i) => toCents(i.amount) === Math.round(r.amount * 100) && isoToYmd(i.created_at) === r.date && String(i.source || 'Salary').toLowerCase() === source.toLowerCase());
      const queued = plan.incomes.find((i) => toCents(i.amount) === Math.round(r.amount * 100) && isoToYmd(i.created_at) === r.date && i.source.toLowerCase() === source.toLowerCase());
      if (twin || queued) {
        plan.duplicates += 1;
        continue;
      }
      plan.incomes.push({ amount: r.amount.toFixed(2), source: source.slice(0, 60), created_at: createdAt });
      continue;
    }
    let category = matchByLabel(categories, r.category)?.key;
    if (!category) {
      const guess = suggestCategory({ merchant: r.merchant, memory, categories: lite });
      category = guess && guess.confidence !== 'low' ? guess.key : 'other';
    }
    const candidate = { amount: r.amount.toFixed(2), category, payment: matchByLabel(payments, r.payment)?.key ?? defaultPayment, merchant: r.merchant || null, note: null as string | null, created_at: createdAt };
    if (findDuplicate(candidate, seenExpenses)) {
      plan.duplicates += 1;
      continue;
    }
    const note = r.note || (category === 'other' ? r.merchant : '');
    const row: NewExpense = { ...candidate, note: note || null };
    plan.expenses.push(row);
    // two identical lines inside the same file are not both added either
    seenExpenses.push({ id: `plan-${plan.expenses.length}`, user_id: '', ...row } as Expense);
  }
  return plan;
}
