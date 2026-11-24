import { describe, expect, it } from 'vitest';
import { ymdToNoonIso } from '@/lib/dates';
import { categoryBreakdown, compareWithLastMonth, forecastMonth, frequentMerchants, headline, insights, isFixedBill, safeToSpend, shiftMonth, spendingPatterns, trend } from './summary';
import type { Expense, Income } from '@/features/money/types';

let n = 0;
const ex = (amount: string, day: string, extra: Partial<Expense> = {}): Expense => ({ id: `e${(n += 1)}`, user_id: 'u', amount, category: 'food', payment: 'card', merchant: null, note: null, created_at: ymdToNoonIso(day), ...extra });
const inc = (amount: string, day: string): Income => ({ id: `i${(n += 1)}`, user_id: 'u', amount, source: 'Salary', created_at: ymdToNoonIso(day) });

describe('months', () => {
  it('moves across year ends', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-03', -14)).toBe('2025-01');
  });
});

describe('the headline (DB-02, DB-03)', () => {
  const expenses = [ex('100.00', '2026-11-03'), ex('50.50', '2026-11-10'), ex('999.00', '2026-10-30')];
  const incomes = [inc('3000.00', '2026-11-01')];
  it('spent, income and balance for the month, in cents', () => {
    expect(headline(expenses, incomes, 0, '2026-11')).toMatchObject({ spent: 15050, income: 300000, balance: 284950, overall: null });
  });
  it('with a budget: what is left, and the level', () => {
    const h = headline(expenses, incomes, 18000, '2026-11');
    expect(h.overall).toMatchObject({ left: 2950, level: 'warn' });
    expect(headline(expenses, incomes, 10000, '2026-11').overall?.level).toBe('over');
  });
  it('a negative balance when spending is more than income', () => {
    expect(headline([ex('500.00', '2026-11-02')], [inc('100.00', '2026-11-01')], 0, '2026-11').balance).toBe(-40000);
  });
});

describe('same-days comparison (DB-02)', () => {
  it('this month so far is compared with the same days of last month, not the whole of it', () => {
    const expenses = [ex('100.00', '2026-10-05'), ex('900.00', '2026-10-25'), ex('150.00', '2026-11-04')];
    expect(compareWithLastMonth(expenses, '2026-11', '2026-11-10')).toEqual({ percent: 50, throughDay: 10, previousMonth: '2026-10' });
  });
  it('a finished month is compared with the whole of the one before', () => {
    const expenses = [ex('100.00', '2026-09-05'), ex('100.00', '2026-09-25'), ex('300.00', '2026-10-04')];
    expect(compareWithLastMonth(expenses, '2026-10', '2026-11-10').percent).toBe(50);
  });
  it('nothing to compare with gives no percentage', () => {
    expect(compareWithLastMonth([ex('10.00', '2026-11-04')], '2026-11', '2026-11-10').percent).toBeNull();
  });
});

describe('where the money went, and the trend (DB-05)', () => {
  const rows = [ex('60.00', '2026-11-01', { category: 'food' }), ex('30.00', '2026-11-02', { category: 'car' }), ex('10.00', '2026-11-03', { category: 'food' })];
  it('ranks categories with shares that add up to 100', () => {
    const slices = categoryBreakdown(rows, '2026-11');
    expect(slices.map((s) => [s.key, s.cents])).toEqual([['food', 7000], ['car', 3000]]);
    expect(slices.reduce((total, s) => total + s.percent, 0)).toBeCloseTo(100, 5);
    expect(categoryBreakdown(rows, '2026-12')).toEqual([]);
  });
  it('six months ending at the chosen one, oldest first, empty months as zero', () => {
    const points = trend(rows, [inc('500.00', '2026-09-15')], '2026-11');
    expect(points.map((p) => p.month)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
    expect(points[3]).toMatchObject({ income: 50000, spent: 0 });
    expect(points[5]).toMatchObject({ spent: 10000 });
  });
});

describe('insights (DB-04)', () => {
  const recurring = [{ name: 'Rent' }];
  const rows = [ex('1200.00', '2026-11-01', { merchant: 'Rent', note: 'Rent', category: 'utilities' }), ex('50.00', '2026-11-02', { merchant: 'Lunch' }), ex('30.00', '2026-11-03', { category: 'car' })];
  it('knows a fixed bill when a schedule posted it', () => {
    expect(isFixedBill(rows[0] as Expense, recurring)).toBe(true);
    expect(isFixedBill(rows[1] as Expense, recurring)).toBe(false);
    expect(isFixedBill({ merchant: 'Rent', note: 'Rent' }, [])).toBe(false);
  });
  it('the daily average leaves fixed bills out and says how much they were', () => {
    const result = insights(rows, recurring, '2026-11', '2026-11-10');
    expect(result.separated).toBe(true);
    expect(result.fixedBills).toBe(120000);
    expect(result.dailyAverage).toBe(800); // (50 + 30) / 10 days
    expect(result.topCategory?.key).toBe('food');
    expect(result.largest?.merchant).toBe('Rent');
  });
  it('when everything is a fixed bill nothing is separated', () => {
    const only = [rows[0] as Expense];
    expect(insights(only, recurring, '2026-11', '2026-11-10')).toMatchObject({ separated: false, dailyAverage: 12000 });
  });
  it('a past month averages over all its days, and a future month is zero', () => {
    expect(insights([ex('310.00', '2026-10-05')], [], '2026-10', '2026-11-10')).toMatchObject({ days: 31, dailyAverage: 1000 });
    expect(insights([], [], '2027-01', '2026-11-10').dailyAverage).toBe(0);
  });
});

describe('safe to spend and the forecast (DB-02, BU-02)', () => {
  it('safe to spend divides what is left by the days remaining, today counted', () => {
    expect(safeToSpend(300000, 100000, '2026-11', '2026-11-21')).toEqual({ perDay: 20000, left: 200000, daysLeft: 10 });
  });
  it('not shown with no budget, another month, or a budget already used up', () => {
    expect(safeToSpend(0, 0, '2026-11', '2026-11-21')).toBeNull();
    expect(safeToSpend(1000, 0, '2026-10', '2026-11-21')).toBeNull();
    expect(safeToSpend(1000, 1000, '2026-11', '2026-11-21')).toBeNull();
  });
  it('projects the month end from the pace and warns before the budget is passed', () => {
    expect(forecastMonth(100000, 250000, '2026-11', '2026-11-10')).toEqual({ projected: 300000, willExceed: true });
    expect(forecastMonth(100000, 400000, '2026-11', '2026-11-10')?.willExceed).toBe(false);
    expect(forecastMonth(300000, 250000, '2026-11', '2026-11-10')?.willExceed).toBe(false); // already over: a different message
  });
  it('says nothing too early in the month, with no spending, or for another month', () => {
    expect(forecastMonth(5000, 10000, '2026-11', '2026-11-03')).toBeNull();
    expect(forecastMonth(0, 10000, '2026-11', '2026-11-20')).toBeNull();
    expect(forecastMonth(5000, 10000, '2026-10', '2026-11-20')).toBeNull();
  });
});

describe('patterns and quick add (DB-07, DB-08)', () => {
  it('compares the last 7 days with the 7 before', () => {
    const rows = [ex('70.00', '2026-11-10'), ex('30.00', '2026-11-03'), ex('50.00', '2026-11-01')];
    expect(spendingPatterns(rows, '2026-11-10')).toMatchObject({ last7: 7000, previous7: 8000, change: -12 });
  });
  it('finds a merchant that comes back every week or every month, but not an irregular one', () => {
    const weekly = ['2026-10-13', '2026-10-20', '2026-10-27', '2026-11-03'].map((d) => ex('9.00', d, { merchant: 'Yoga' }));
    const monthly = ['2026-08-05', '2026-09-05', '2026-10-05'].map((d) => ex('55.00', d, { merchant: 'Streamyx' }));
    const messy = ['2026-10-01', '2026-10-04', '2026-10-30'].map((d) => ex('5.00', d, { merchant: 'Random' }));
    const result = spendingPatterns([...weekly, ...monthly, ...messy], '2026-11-10').repeats;
    expect(result).toEqual(expect.arrayContaining([{ merchant: 'yoga', every: 'week', count: 4 }, { merchant: 'streamyx', every: 'month', count: 3 }]));
    expect(result.some((r) => r.merchant === 'random')).toBe(false);
  });
  it('never offers something a schedule already posts', () => {
    const posted = ['2026-08-05', '2026-09-05', '2026-10-05'].map((d) => ex('55.00', d, { merchant: 'Rent', note: 'Rent' }));
    expect(spendingPatterns(posted, '2026-11-10').repeats).toEqual([]);
    expect(frequentMerchants(posted)).toEqual([]);
  });
  it('frequent merchants: most visited first, with what was paid last time; one visit is not "frequent"', () => {
    const rows = [ex('4.00', '2026-11-01', { merchant: 'Kopi' }), ex('4.50', '2026-11-05', { merchant: 'kopi' }), ex('12.00', '2026-11-02', { merchant: 'Lunch spot' }), ex('11.00', '2026-11-04', { merchant: 'Lunch spot' }), ex('12.00', '2026-11-06', { merchant: 'Lunch spot' }), ex('9.00', '2026-11-06', { merchant: 'Once' })];
    const result = frequentMerchants(rows);
    expect(result.map((r) => r.merchant)).toEqual(['Lunch spot', 'Kopi']);
    expect(result[1]?.latest.amount).toBe('4.50');
  });
});
