/* eslint-disable jsx-a11y/no-noninteractive-tabindex -- tables that scroll sideways must be reachable by keyboard */
// RP-01, HI-02: the monthly report inside the app, ready to print or save as a PDF. Back (or Esc) returns to where the person was.
import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/Button';
import { useToast } from '@/components/Toast';
import { useI18n, type Lang } from '@/lib/i18n';
import { formatDate, isoToYmd, monthKey, todayYmd } from '@/lib/dates';
import { formatMoney, toCents } from '@/lib/money';
import { inMonth } from '@/features/money/calc';
import { useMoney } from '@/features/money/MoneyContext';
import { shiftMonth } from '@/features/dashboard/summary';
import type { Expense, Income } from '@/features/money/types';
import { compareMonths, summarizeMonth, type Change, type ReportTransaction } from './insights';
import styles from './ReportPage.module.css';

const LOCALES: Record<Lang, string> = { en: 'en-MY', ms: 'ms-MY', zh: 'zh-CN' };

function summaryOf(expenses: Expense[], incomes: Income[], monthValue: string) {
  return summarizeMonth([
    ...inMonth(expenses, monthValue).map((r): ReportTransaction => ({ type: 'expense', amount: r.amount, merchant: r.merchant, category: r.category })),
    ...inMonth(incomes, monthValue).map((r): ReportTransaction => ({ type: 'income', amount: r.amount })),
  ]);
}

export function ReportPage() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { data, categoryOf } = useMoney();
  const requested = params.get('month') ?? '';
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(requested) ? requested : monthKey(todayYmd());
  const previous = shiftMonth(month, -1);
  const [y, m] = month.split('-').map(Number) as [number, number];
  const fmt = (options: Intl.DateTimeFormatOptions, date: Date) => new Intl.DateTimeFormat(LOCALES[lang], options).format(date);
  const monthLong = fmt({ month: 'long', year: 'numeric' }, new Date(y, m - 1, 1));
  const monthName = fmt({ month: 'long' }, new Date(y, m - 1, 1));
  const previousName = fmt({ month: 'long' }, new Date(y, m - 2, 1));

  const rows = (() => {
    const tag = (kind: 'expense' | 'income') => (row: { amount: string; merchant?: string | null; category?: string; source?: string; note?: string | null; created_at: string; id: string }) => ({ kind, row });
    const expenses = inMonth(data.expenses, month).map(tag('expense'));
    const incomes = inMonth(data.incomes, month).map(tag('income'));
    return [...expenses, ...incomes].sort((a, b) => a.row.created_at.localeCompare(b.row.created_at));
  })();

  const current = summaryOf(data.expenses, data.incomes, month);
  const before = summaryOf(data.expenses, data.incomes, previous);
  const comparison = compareMonths(current, before);

  // the days of the month, for the daily bars
  const daily = (() => {
    const days = new Date(y, m, 0).getDate();
    const sums = Array<number>(days).fill(0);
    for (const row of inMonth(data.expenses, month)) {
      const day = Number(isoToYmd(row.created_at).slice(8, 10));
      sums[day - 1] = (sums[day - 1] ?? 0) + toCents(row.amount);
    }
    return sums;
  })();
  const dailyMax = Math.max(1, ...daily);
  const dailyTotal = daily.reduce((a, b) => a + b, 0);
  const topDay = daily.reduce((best, cents, index) => (cents > best.cents ? { day: index + 1, cents } : best), { day: 0, cents: 0 });

  const categoryKeys = (() => {
    const keys = new Set([...current.byCategory.map((c) => c.key), ...before.byCategory.map((c) => c.key)]);
    const total = (key: string) => (current.byCategory.find((c) => c.key === key)?.total ?? 0) + (before.byCategory.find((c) => c.key === key)?.total ?? 0);
    return [...keys].sort((a, b) => total(b) - total(a));
  })();

  // Esc goes back, like the Back button
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('[role="dialog"]')) navigate(-1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [navigate]);

  const print = () => {
    if (typeof window.print !== 'function') return toast.show('error', t('report.printNo'));
    const title = document.title;
    document.title = `VinExpenses-${month}-report`; // becomes the default file name when saving as a PDF
    window.print();
    document.title = title;
  };

  const money = (value: number) => formatMoney(value);
  const describe = (change: Change | null, goodWhenDown: boolean) => {
    if (!change) return null;
    const up = change.delta > 0;
    const pct = change.pct === null ? '' : ` (${Math.abs(Math.round(change.pct * 100))}%)`;
    const good = goodWhenDown ? !up : up;
    return (
      <span className={good ? styles.good : styles.bad}>
        {t(up ? 'report.up' : 'report.down', { amount: money(Math.abs(change.delta)), pct })}
      </span>
    );
  };
  const categoryChange = (now: number, was: number) => {
    const diff = Math.round((now - was) * 100) / 100;
    if (Math.abs(diff) < 0.005) return t('report.noChange');
    const pct = was > 0 ? `${Math.round(Math.abs(diff / was) * 100)}%` : now > 0 ? t('report.new') : '—';
    return t(diff > 0 ? 'report.increased' : 'report.decreased', { amount: money(Math.abs(diff)), pct });
  };

  return (
    <article className={styles.page} aria-labelledby="report-title">
      <div className={styles.bar} data-noprint>
        <Button variant="outline" onClick={() => navigate(-1)}>
          {t('report.back')}
        </Button>
        <label className={styles.picker}>
          <span className="sr-only">{t('report.month')}</span>
          <input type="month" value={month} onChange={(event) => event.target.value && setParams({ month: event.target.value }, { replace: true })} />
        </label>
        <Button onClick={print}>{t('report.print')}</Button>
      </div>

      <header>
        <h1 id="report-title" className={styles.h1}>
          {t('report.title')}
        </h1>
        <p className={styles.sub}>{monthLong} · VinExpenses</p>
      </header>

      <p className={styles.line} data-testid="report-line">
        {rows.length === 0 ? t('report.lineNone', { month: monthLong }) : t('report.line', { month: monthLong, spent: money(current.expenses), income: money(current.income), net: money(current.net) })}
      </p>

      <div className={styles.totals} role="group" aria-label={t('report.title')}>
        <div>
          <span>{t('report.income')}</span>
          <b data-testid="report-income">{money(current.income)}</b>
        </div>
        <div>
          <span>{t('report.expenses')}</span>
          <b data-testid="report-expenses">{money(current.expenses)}</b>
        </div>
        <div>
          <span>{t('report.net')}</span>
          <b data-testid="report-net" className={current.net < 0 ? styles.bad : ''}>
            {money(current.net)}
          </b>
        </div>
        <div>
          <span>{t('report.count')}</span>
          <b>{rows.length}</b>
        </div>
      </div>

      <section className={styles.section} aria-labelledby="rep-daily">
        <h2 id="rep-daily" className={styles.h2}>
          {t('report.daily')}
        </h2>
        <p className={styles.muted}>{dailyTotal > 0 ? t('report.dailySummary', { total: money(dailyTotal / 100), day: topDay.day, month: monthName, amount: money(topDay.cents / 100) }) : t('report.dailyNone', { month: monthName })}</p>
        <div className={styles.daily} role="img" aria-label={t('report.dailyLabel', { month: monthLong })}>
          {daily.map((cents, index) => (
            <span key={index} className={styles.dayBar} data-h={Math.max(0, Math.min(100, Math.round((cents / dailyMax) * 20) * 5))} />
          ))}
        </div>
      </section>

      <section className={styles.section} aria-labelledby="rep-compare">
        <h2 id="rep-compare" className={styles.h2}>
          {t('report.compare')}
        </h2>
        {comparison.hasPrevious ? (
          <div className={styles.compare}>
            <div>
              <span>{t('report.expenses')}</span>
              <b>{describe(comparison.expenses, true)}</b>
            </div>
            <div>
              <span>{t('report.income')}</span>
              <b>{describe(comparison.income, false)}</b>
            </div>
            {comparison.categoryChanges.length ? (
              <div className={styles.wide}>
                <span>{t('report.biggest')}</span>
                <b>{comparison.categoryChanges.map((c) => `${categoryOf(c.key).label}: ${c.delta > 0 ? '+' : '−'}${money(Math.abs(c.delta))}`).join(' · ')}</b>
              </div>
            ) : null}
          </div>
        ) : (
          <p className={styles.muted}>{t('report.noPrev')}</p>
        )}
      </section>

      <div className={styles.columns}>
        {current.byCategory.length ? (
          <section className={styles.section} aria-labelledby="rep-where">
            <h2 id="rep-where" className={styles.h2}>
              {t('report.where')}
            </h2>
            <table className={styles.table}>
              <tbody>
                {current.byCategory.slice(0, 5).map((c) => (
                  <tr key={c.key}>
                    <th scope="row">{categoryOf(c.key).label}</th>
                    <td>{Math.round(c.share * 100)}%</td>
                    <td className={styles.amount}>{money(c.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}
        {current.topMerchants.length ? (
          <section className={styles.section} aria-labelledby="rep-merch">
            <h2 id="rep-merch" className={styles.h2}>
              {t('report.merchants')}
            </h2>
            <table className={styles.table}>
              <tbody>
                {current.topMerchants.map((entry) => (
                  <tr key={entry.name}>
                    <th scope="row">{entry.name}</th>
                    <td>{entry.count}×</td>
                    <td className={styles.amount}>{money(entry.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}
      </div>

      <section className={styles.section} aria-labelledby="rep-cat">
        <h2 id="rep-cat" className={styles.h2}>
          {t('report.catCompare')}
        </h2>
        {categoryKeys.length ? (
          <div className={styles.wrap} tabIndex={0} role="region" aria-label={t('report.catCompare')}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">{t('report.colCategory')}</th>
                  <th scope="col" className={styles.amount}>
                    {previousName}
                  </th>
                  <th scope="col" className={styles.amount}>
                    {monthName}
                  </th>
                  <th scope="col">{t('report.colChange')}</th>
                </tr>
              </thead>
              <tbody>
                {categoryKeys.map((key) => {
                  const now = current.byCategory.find((c) => c.key === key)?.total ?? 0;
                  const was = before.byCategory.find((c) => c.key === key)?.total ?? 0;
                  return (
                    <tr key={key}>
                      <th scope="row">{categoryOf(key).label}</th>
                      <td className={styles.amount}>{money(was)}</td>
                      <td className={styles.amount}>{money(now)}</td>
                      <td>{categoryChange(now, was)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={styles.muted}>{t('report.catNone')}</p>
        )}
      </section>

      <section className={styles.section} aria-labelledby="rep-all">
        <h2 id="rep-all" className={styles.h2}>
          {t('report.all')}
        </h2>
        <div className={styles.wrap} tabIndex={0} role="region" aria-label={t('report.all')}>
          <table className={styles.table} data-testid="report-rows">
            <thead>
              <tr>
                <th scope="col">{t('report.colDate')}</th>
                <th scope="col">{t('report.colType')}</th>
                <th scope="col">{t('report.colWho')}</th>
                <th scope="col">{t('report.colCategory')}</th>
                <th scope="col">{t('report.colNote')}</th>
                <th scope="col" className={styles.amount}>
                  {t('report.colAmount')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6}>{t('report.noRows')}</td>
                </tr>
              ) : (
                rows.map((entry) => {
                  const isExpense = entry.kind === 'expense';
                  const who = entry.row.merchant || (isExpense ? categoryOf(entry.row.category ?? '').label : entry.row.source || 'Salary');
                  return (
                    <tr key={`${entry.kind}-${entry.row.id}`}>
                      <td>{formatDate(isoToYmd(entry.row.created_at), data.dateFormat)}</td>
                      <td>{t(isExpense ? 'add.expense' : 'add.income')}</td>
                      <th scope="row">{who}</th>
                      <td>{isExpense ? categoryOf(entry.row.category ?? '').label : ''}</td>
                      <td>{entry.row.note ?? ''}</td>
                      <td className={styles.amount}>{money(Number(entry.row.amount))}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </article>
  );
}
