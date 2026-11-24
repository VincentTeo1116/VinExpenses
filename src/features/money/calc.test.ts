import { describe, expect, it } from 'vitest';
import { advanceDue, daysBetween, formatDate, isYmd, isoToYmd, todayYmd, ymdToNoonIso } from '@/lib/dates';
import { budgetFor, budgetStatus, crossedLimit, dueWording, findDuplicate, monthlyEquivalent, monthTotals, planDue, recurringTotals, resumeDate, sumCents } from './calc';
import { mergeCategories, newKey } from './taxonomy';
import type { Expense, Income } from './types';
import { translate } from '@/lib/i18n';

const expense = (id: string, amount: string, created_at: string, extra: Partial<Expense> = {}): Expense => ({ id, user_id: 'u', amount, category: 'food', payment: 'card', merchant: null, note: null, created_at, ...extra });
const income = (id: string, amount: string, created_at: string): Income => ({ id, user_id: 'u', amount, source: 'Salary', created_at });

describe('dates', () => {
  it('a monthly bill on the 31st lands on the last day of short months, then goes back to the 31st', () => {
    expect(advanceDue('2026-01-31', 'monthly', 31)).toBe('2026-02-28');
    expect(advanceDue('2026-02-28', 'monthly', 31)).toBe('2026-03-31');
    expect(advanceDue('2026-03-31', 'monthly', 31)).toBe('2026-04-30');
    expect(advanceDue('2028-01-31', 'monthly', 31)).toBe('2028-02-29'); // a leap year
    expect(advanceDue('2026-12-15', 'monthly', 15)).toBe('2027-01-15'); // across the year end
  });

  it('yearly keeps the day, and 29 February falls back to 28 in other years', () => {
    expect(advanceDue('2028-02-29', 'yearly', 29)).toBe('2029-02-28');
    expect(advanceDue('2029-02-28', 'yearly', 29)).toBe('2030-02-28');
    expect(advanceDue('2031-02-28', 'yearly', 29)).toBe('2032-02-29');
  });

  it('weekly adds seven days, across month and year ends', () => {
    expect(advanceDue('2026-12-28', 'weekly', 28)).toBe('2027-01-04');
    expect(advanceDue('2026-02-25', 'weekly', 25)).toBe('2026-03-04');
  });

  it('counts days between dates and recognises real dates only', () => {
    expect(daysBetween('2026-01-31', '2026-03-01')).toBe(29);
    expect(daysBetween('2026-03-01', '2026-01-31')).toBe(-29);
    for (const good of ['2026-02-28', '2028-02-29']) expect(isYmd(good), good).toBe(true);
    for (const bad of ['2026-02-30', '2026-13-01', '2026-1-1', '', 'tomorrow', '2026-02-29', null]) expect(isYmd(bad), String(bad)).toBe(false);
  });

  it('a record placed at noon keeps its day whatever the time zone', () => {
    for (const day of ['2026-01-01', '2026-06-15', '2026-12-31']) expect(isoToYmd(ymdToNoonIso(day))).toBe(day);
    expect(todayYmd(new Date(2026, 10, 23, 23, 59))).toBe('2026-11-23');
  });

  it('formats in the three chosen ways', () => {
    expect(formatDate('2026-10-19', 'dmy_short')).toBe('19 Oct 2026');
    expect(formatDate('2026-10-05', 'dmy')).toBe('05/10/2026');
    expect(formatDate('2026-10-19', 'ymd')).toBe('2026-10-19');
  });
});

describe('money totals', () => {
  it('adds in whole cents, so floating-point noise never shows', () => {
    expect(sumCents([{ amount: '0.10' }, { amount: '0.20' }])).toBe(30);
    expect(sumCents(Array.from({ length: 1000 }, () => ({ amount: '0.10' })))).toBe(10000);
  });

  it('a month counts only its own days, using the local day of each record', () => {
    const expenses = [expense('1', '10.00', ymdToNoonIso('2026-11-01')), expense('2', '5.50', ymdToNoonIso('2026-11-30')), expense('3', '99.00', ymdToNoonIso('2026-10-31'))];
    const incomes = [income('i', '100.00', ymdToNoonIso('2026-11-15'))];
    expect(monthTotals(expenses, incomes, '2026-11')).toEqual({ spent: 1550, income: 10000, balance: 8450 });
    expect(monthTotals(expenses, incomes, '2026-12')).toEqual({ spent: 0, income: 0, balance: 0 });
  });
});

describe('recurring totals: income is plus, spending is minus (RC-04)', () => {
  it('nets the two instead of adding them', () => {
    const totals = recurringTotals(
      [{ amount: '1200.00', frequency: 'monthly', active: true }, { amount: '120.00', frequency: 'yearly', active: true }, { amount: '50.00', frequency: 'monthly', active: false }],
      [{ amount: '3000.00', frequency: 'monthly', active: true }],
    );
    expect(totals.expensePerMonth).toBe(120000 + 1000);
    expect(totals.incomePerMonth).toBe(300000);
    expect(totals.netPerMonth).toBe(300000 - 121000);
    expect(totals.netPerYear).toBe((300000 - 121000) * 12);
    expect(totals.active).toBe(3);
  });

  it('is negative when the schedules cost more than they bring in', () => {
    expect(recurringTotals([{ amount: '500.00', frequency: 'monthly', active: true }], [{ amount: '100.00', frequency: 'monthly', active: true }]).netPerMonth).toBe(-40000);
  });

  it('weekly is x52/12 and yearly is /12', () => {
    expect(monthlyEquivalent({ amount: '12.00', frequency: 'weekly' })).toBe(5200);
    expect(monthlyEquivalent({ amount: '12.00', frequency: 'yearly' })).toBe(100);
  });
});

describe('posting due schedules (RC-02)', () => {
  const rent = { next_due: '2026-09-01', start_date: '2026-01-01', frequency: 'monthly' as const };

  it('posts every missed date, oldest first, and says when the next one is', () => {
    const plan = planDue(rent, '2026-11-23');
    expect(plan.dues).toEqual(['2026-09-01', '2026-10-01', '2026-11-01']);
    expect(plan.next).toBe('2026-12-01');
    expect(plan.finished).toBe(false);
  });

  it('posts nothing when nothing is due, and never more than 36 in one go', () => {
    expect(planDue({ ...rent, next_due: '2026-12-01' }, '2026-11-23').dues).toEqual([]);
    expect(planDue({ ...rent, next_due: '2000-01-01', start_date: '2000-01-01' }, '2026-11-23').dues).toHaveLength(36);
  });

  it('stops at an end date and switches itself off (a loan\'s last instalment)', () => {
    const plan = planDue({ ...rent, end_date: '2026-10-01' }, '2026-11-23');
    expect(plan.dues).toEqual(['2026-09-01', '2026-10-01']);
    expect(plan.finished).toBe(true);
  });

  it('a monthly bill on the 31st keeps its day after a short month', () => {
    const plan = planDue({ next_due: '2026-01-31', start_date: '2026-01-31', frequency: 'monthly' }, '2026-04-30');
    expect(plan.dues).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });

  it('resuming skips what was missed while paused', () => {
    expect(resumeDate({ ...rent, next_due: '2026-03-01' }, '2026-11-23')).toBe('2026-12-01');
    expect(resumeDate({ ...rent, next_due: '2026-12-05' }, '2026-11-23')).toBe('2026-12-05');
  });

  it('words a due date as today, tomorrow or in n days', () => {
    expect(dueWording('2026-11-22', '2026-11-23')).toEqual({ kind: 'today' });
    expect(dueWording('2026-11-24', '2026-11-23')).toEqual({ kind: 'tomorrow' });
    expect(dueWording('2026-11-30', '2026-11-23')).toEqual({ kind: 'inDays', days: 7 });
  });
});

describe('budgets (TX-05, BU-01)', () => {
  it('is fine under 80%, warns from 80%, and is over beyond 100%', () => {
    expect(budgetStatus(10000, 7999).level).toBe('ok');
    expect(budgetStatus(10000, 8000).level).toBe('warn');
    expect(budgetStatus(10000, 10000).level).toBe('warn');
    expect(budgetStatus(10000, 10001).level).toBe('over');
    expect(budgetStatus(10000, 12500)).toMatchObject({ left: -2500, percent: 125 });
    expect(budgetStatus(0, 500).level).toBe('ok');
  });

  it('tells only when an expense crosses a line, not every time', () => {
    expect(crossedLimit(10000, 7000, 8500)).toBe('warn');
    expect(crossedLimit(10000, 8500, 9000)).toBeNull();
    expect(crossedLimit(10000, 9500, 10500)).toBe('over');
    expect(crossedLimit(10000, 10500, 11000)).toBeNull();
    expect(crossedLimit(0, 0, 500)).toBeNull();
    expect(crossedLimit(10000, 8500, 5000)).toBeNull();
  });

  it('finds a limit by category and the overall "all"', () => {
    const budgets = [{ id: '1', user_id: 'u', category: 'food', amount: '300.00' }, { id: '2', user_id: 'u', category: 'all', amount: '2000.00' }];
    expect(budgetFor(budgets, 'food')).toBe(30000);
    expect(budgetFor(budgets, 'all')).toBe(200000);
    expect(budgetFor(budgets, 'car')).toBe(0);
  });
});

describe('duplicate warning (TX-03)', () => {
  const rows = [expense('a', '12.50', '2026-11-20T04:00:00Z', { merchant: 'Kopitiam Ali' }), expense('b', '8.00', '2026-11-20T04:00:00Z', { category: 'travel' })];
  it('same amount, same place, within a day', () => {
    expect(findDuplicate({ amount: '12.5', merchant: ' kopitiam ali ', category: 'food', created_at: '2026-11-21T04:00:00Z' }, rows)?.id).toBe('a');
  });
  it('not when the amount, the place or the day differs', () => {
    expect(findDuplicate({ amount: '12.60', merchant: 'Kopitiam Ali', category: 'food', created_at: '2026-11-20T04:00:00Z' }, rows)).toBeNull();
    expect(findDuplicate({ amount: '12.50', merchant: 'Other', category: 'food', created_at: '2026-11-20T04:00:00Z' }, rows)).toBeNull();
    expect(findDuplicate({ amount: '12.50', merchant: 'Kopitiam Ali', category: 'food', created_at: '2026-11-23T04:00:00Z' }, rows)).toBeNull();
  });
  it('with no place, the category stands in; editing never matches itself', () => {
    expect(findDuplicate({ amount: '8', merchant: null, category: 'travel', created_at: '2026-11-20T04:00:00Z' }, rows)?.id).toBe('b');
    expect(findDuplicate({ amount: '8', merchant: null, category: 'food', created_at: '2026-11-20T04:00:00Z' }, rows)).toBeNull();
    expect(findDuplicate({ amount: '8', merchant: null, category: 'travel', created_at: '2026-11-20T04:00:00Z' }, rows, 'b')).toBeNull();
  });
});

describe('categories the person renamed, hid or added', () => {
  const t = (key: Parameters<typeof translate>[1]) => translate('en', key);
  it('built-ins appear by default, in their usual order', () => {
    const items = mergeCategories([], t);
    expect(items.map((i) => i.key)).toEqual(['beverages', 'travel', 'entertain', 'work', 'food', 'shopping', 'utilities', 'car', 'health', 'other']);
    expect(items.every((i) => i.active && i.builtin)).toBe(true);
  });
  it('a renamed or hidden built-in and a custom one are merged, and unsafe colours are replaced', () => {
    const base = { user_id: 'u', icon: 'fa-tag', is_builtin: false, sort_order: 100, active: true };
    const items = mergeCategories(
      [
        { ...base, category_key: 'food', label: 'Makan', color: '#ef4444', is_builtin: true, sort_order: 4 },
        { ...base, category_key: 'car', label: 'Car', color: '#f97316', is_builtin: true, active: false, sort_order: 7 },
        { ...base, category_key: 'c-pets', label: 'Pets', color: 'red;background:url(x)' },
      ],
      t,
    );
    expect(items.find((i) => i.key === 'food')).toMatchObject({ label: 'Makan', renamed: true });
    expect(items.find((i) => i.key === 'car')?.active).toBe(false);
    expect(items.at(-1)).toMatchObject({ key: 'c-pets', label: 'Pets', builtin: false, color: '#4f46e5' });
  });
  it('a new custom item gets a safe, unused key', () => {
    expect(newKey('Pets & Vet!', [])).toBe('c-pets-vet');
    expect(newKey('Pets', ['c-pets'])).toBe('c-pets-2');
    expect(newKey('🐶', [])).toBe('c-item');
  });
});
