import { describe, expect, it } from 'vitest';
import { ymdToNoonIso } from '@/lib/dates';
import { importRecords } from './csv';
import { planImport } from './plan';
import type { Expense, Income } from '@/features/money/types';

const categories = [
  { key: 'food', label: 'Food' },
  { key: 'utilities', label: 'Utilities' },
  { key: 'other', label: 'Other' },
];
const payments = [
  { key: 'card', label: 'Card' },
  { key: 'bank', label: 'Bank' },
];
const ctx = (expenses: Expense[] = [], incomes: Income[] = []) => ({ categories, payments, expenses, incomes });
const rec = (text: string) => importRecords(text).records;

describe('planning an import', () => {
  it('matches a category or payment written as its label, in any case', () => {
    const plan = planImport(rec('Date,Description,Category,Payment,Amount\n2026-03-04,Shop,FOOD,card,10.00'), ctx());
    expect(plan.expenses[0]).toMatchObject({ category: 'food', payment: 'card', amount: '10.00', merchant: 'Shop' });
  });

  it('guesses the category from the merchant, and falls back to Other, keeping the name as the note', () => {
    const plan = planImport(rec('Date,Description,Amount\n2026-03-04,SINGTEL,50.00\n2026-03-05,Ah Seng Stall,4.00'), ctx());
    expect(plan.expenses[0]?.category).toBe('utilities');
    expect(plan.expenses[1]).toMatchObject({ category: 'other', note: 'Ah Seng Stall' });
  });

  it('uses the bank as the payment when none is given', () => {
    expect(planImport(rec('Date,Description,Amount\n2026-03-04,X,1.00'), ctx()).expenses[0]?.payment).toBe('bank');
  });

  it('skips what is already there (same amount, place, within a day), and repeats inside the file', () => {
    const existing = [{ id: 'e1', user_id: 'u', amount: '10.00', category: 'food', payment: 'card', merchant: 'Shop', note: null, created_at: ymdToNoonIso('2026-03-04') }] as Expense[];
    const plan = planImport(rec('Date,Description,Amount\n2026-03-05,Shop,10.00\n2026-03-20,Cafe,7.00\n2026-03-20,Cafe,7.00'), ctx(existing));
    expect(plan.duplicates).toBe(2);
    expect(plan.expenses).toHaveLength(1);
  });

  it('income: skips a twin (same day, amount and source) and keeps the source', () => {
    const existing = [{ id: 'i1', user_id: 'u', amount: '4500.00', source: 'Salary', created_at: ymdToNoonIso('2026-03-25') }] as Income[];
    const plan = planImport(rec('Date,Type,Description,Amount\n2026-03-25,income,Salary,4500.00\n2026-04-25,income,Salary,4500.00'), ctx([], existing));
    expect(plan.duplicates).toBe(1);
    expect(plan.incomes).toEqual([{ amount: '4500.00', source: 'Salary', created_at: ymdToNoonIso('2026-04-25') }]);
  });
});
