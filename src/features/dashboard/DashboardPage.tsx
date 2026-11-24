// DB-01 … DB-10: the Home screen. One big card for what was spent this month, three small tiles under it (income, balance,
// budget left), then the details. Every number is built from the same records as History, so the two always agree.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icon';
import { Notice } from '@/components/Notice';
import { useAuth } from '@/app/AuthProvider';
import { useI18n, type Lang } from '@/lib/i18n';
import { daysBetween, formatDate, isoToYmd, monthKey, todayYmd } from '@/lib/dates';
import { formatMoney, formatSigned, toCents } from '@/lib/money';
import { budgetFor, dueWording } from '@/features/money/calc';
import { useMoney } from '@/features/money/MoneyContext';
import type { Expense, Income } from '@/features/money/types';
import { ReminderList, ReminderPopup, useReminderList } from '@/features/finance/Reminders';
import { TelegramPrompt } from './TelegramPrompt';
import { Donut, TrendBars } from './charts';
import { categoryBreakdown, compareWithLastMonth, forecastMonth, frequentMerchants, headline, insights, safeToSpend, shiftMonth, spendingPatterns, trend } from './summary';
import styles from './DashboardPage.module.css';

const LOCALES: Record<Lang, string> = { en: 'en-MY', ms: 'ms-MY', zh: 'zh-CN' };
const money = (cents: number) => formatMoney(cents / 100);

function monthLabel(month: string, lang: Lang, style: 'long' | 'short' | 'name'): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const options: Intl.DateTimeFormatOptions = style === 'long' ? { month: 'long', year: 'numeric' } : style === 'name' ? { month: 'long' } : { month: 'short' };
  return new Intl.DateTimeFormat(LOCALES[lang], options).format(new Date(y, m - 1, 1));
}

export function DashboardPage() {
  const { t, lang } = useI18n();
  const { session } = useAuth();
  const navigate = useNavigate();
  const { data, categoryOf, openAdd } = useMoney();
  const today = todayYmd();
  const [month, setMonth] = useState(monthKey(today));
  const meta = (session?.user?.user_metadata ?? {}) as Record<string, unknown>;
  const name = (typeof meta.username === 'string' && meta.username) || session?.user?.email?.split('@')[0] || '';

  const overallLimit = budgetFor(data.budgets, 'all');
  const top = useMemo(() => headline(data.expenses, data.incomes, overallLimit, month), [data.expenses, data.incomes, overallLimit, month]);
  const compare = useMemo(() => compareWithLastMonth(data.expenses, month, today), [data.expenses, month, today]);
  const detail = useMemo(() => insights(data.expenses, data.recurring, month, today), [data.expenses, data.recurring, month, today]);
  const slices = useMemo(() => categoryBreakdown(data.expenses, month), [data.expenses, month]);
  const bars = useMemo(() => trend(data.expenses, data.incomes, month), [data.expenses, data.incomes, month]);
  const safe = useMemo(() => safeToSpend(overallLimit, top.spent, month, today), [overallLimit, top.spent, month, today]);
  const forecast = useMemo(() => forecastMonth(top.spent, overallLimit, month, today), [top.spent, overallLimit, month, today]);
  const patterns = useMemo(() => spendingPatterns(data.expenses, today), [data.expenses, today]);
  const frequent = useMemo(() => frequentMerchants(data.expenses), [data.expenses]);
  const recent = useMemo(() => [...data.expenses.map((row) => ({ kind: 'expense' as const, row })), ...data.incomes.map((row) => ({ kind: 'income' as const, row }))].sort((a, b) => b.row.created_at.localeCompare(a.row.created_at)).slice(0, 5), [data.expenses, data.incomes]);
  const upcoming = useMemo(
    () =>
      [...data.recurring.filter((r) => r.active).map((r) => ({ id: r.id, title: r.name, amount: -toCents(r.amount), due: r.next_due })), ...data.recurringIncomes.filter((r) => r.active).map((r) => ({ id: r.id, title: r.source, amount: toCents(r.amount), due: r.next_due }))]
        .sort((a, b) => a.due.localeCompare(b.due))
        .slice(0, 4),
    [data.recurring, data.recurringIncomes],
  );

  const reminders = useReminderList();
  const isCurrent = month === monthKey(today);
  const monthName = monthLabel(month, lang, 'long');
  const nothingAtAll = !data.loading && data.expenses.length === 0 && data.incomes.length === 0;

  const delta = () => {
    if (compare.percent === null) return null;
    const text = compare.percent > 0 ? t('dash.up', { percent: compare.percent }) : compare.percent < 0 ? t('dash.down', { percent: Math.abs(compare.percent) }) : t('dash.same');
    return { text, up: compare.percent > 0, down: compare.percent < 0 };
  };
  const change = delta();

  const goHistory = (category?: string) => navigate('/app/history', { state: { month, category } });

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div>
          <h1 className={styles.h1}>{t('dash.hello', { name })}</h1>
          <p className={styles.sub}>{t('dash.sub', { month: monthName })}</p>
        </div>
        <div className={styles.switch} role="group" aria-label={t('dash.months')}>
          <button type="button" onClick={() => setMonth(shiftMonth(month, -1))} aria-label={t('dash.prev')}>
            <Icon name="back" size={18} />
          </button>
          <span className={styles.monthName} aria-live="polite">
            {monthName}
          </span>
          <button type="button" onClick={() => setMonth(shiftMonth(month, 1))} aria-label={t('dash.next')} disabled={month >= shiftMonth(monthKey(today), 12)}>
            <span className={styles.flip}>
              <Icon name="back" size={18} />
            </span>
          </button>
          {isCurrent ? null : (
            <button type="button" className={styles.now} onClick={() => setMonth(monthKey(today))}>
              {t('dash.thisMonth')}
            </button>
          )}
        </div>
      </header>

      {data.failed ? (
        <Notice kind="warn">
          {t('money.loadFailed')}{' '}
          <button type="button" className={styles.link} onClick={data.reload}>
            {t('common.retry')}
          </button>
        </Notice>
      ) : null}
      <ReminderPopup />
      <TelegramPrompt />
      {data.pendingCount > 0 ? <Notice kind="info">{t('money.pendingBanner', { n: data.pendingCount })}</Notice> : null}

      {reminders.list.length > 0 ? (
        <section className={styles.card} aria-labelledby="dash-rem">
          <div className={styles.cardHead}>
            <h2 id="dash-rem" className={styles.h2}>
              {t('rem.title')}
            </h2>
            <button type="button" className={styles.link} onClick={() => navigate('/app/plan', { state: { tab: reminders.list[0]?.kind === 'loan' ? 'loans' : 'deposits' } })}>
              {t('nav.plan')}
            </button>
          </div>
          <ReminderList list={reminders.list.slice(0, 4)} />
        </section>
      ) : null}

      {data.loading ? (
        <div className={styles.skeleton} role="status" aria-label={t('common.loading')}>
          <span className="sr-only">{t('common.loading')}</span>
        </div>
      ) : nothingAtAll ? (
        <EmptyState icon="plus" title={t('dash.firstTitle')} action={<Button onClick={() => openAdd()}>{t('nav.add')}</Button>}>
          {t('dash.firstBody')}
        </EmptyState>
      ) : (
        <>
          <div className={styles.top}>
            <section className={styles.hero} aria-label={t('dash.spentIn', { month: monthName })} data-testid="hero">
              <div className={styles.heroTop}>
                <span className={styles.heroLabel}>{t('dash.spentIn', { month: monthLabel(month, lang, 'name') })}</span>
                {change ? (
                  <span className={styles.delta} title={compare.throughDay ? t('dash.sameDays') : undefined} data-trend={change.up ? 'up' : change.down ? 'down' : 'same'}>
                    {change.text}
                  </span>
                ) : null}
              </div>
              <p className={styles.heroAmount} data-testid="spent">
                {money(top.spent)}
              </p>
              {top.overall ? (
                <>
                  <progress className={`${styles.heroBar} ${styles[top.overall.level]}`} max={100} value={Math.min(100, Math.round(top.overall.percent))} aria-label={t('dash.budgetPct', { percent: Math.round(top.overall.percent), amount: money(top.overall.limit) })} />
                  <p className={styles.heroCaption}>{top.overall.left >= 0 ? t('bud.left', { amount: money(top.overall.left) }) : t('bud.over', { amount: money(-top.overall.left) })}</p>
                </>
              ) : top.income > 0 ? (
                <p className={styles.heroCaption}>{t('dash.budgetPct', { percent: Math.round((top.spent / top.income) * 100), amount: money(top.income) })}</p>
              ) : null}
              {safe ? (
                <div className={styles.safe} data-testid="safe">
                  <div>
                    <span>{t('dash.safe')}</span>
                    <strong>{money(safe.perDay)}</strong>
                  </div>
                  <span>{t('dash.safeSub', { amount: money(safe.left), n: safe.daysLeft })}</span>
                </div>
              ) : overallLimit > 0 && isCurrent && top.overall && top.overall.left <= 0 ? (
                <div className={`${styles.safe} ${styles.safeBad}`}>
                  <div>
                    <span>{t('dash.budgetUsed')}</span>
                    <strong>{t('bud.over', { amount: money(-top.overall.left) })}</strong>
                  </div>
                  <span>{t('dash.budgetUsedSub')}</span>
                </div>
              ) : null}
              {forecast?.willExceed ? (
                <p className={styles.forecast} role="status">
                  {t('dash.forecast', { amount: money(forecast.projected) })}
                </p>
              ) : null}
            </section>

            <div className={styles.tiles} role="group" aria-label={t('dash.tiles')}>
              <div className={styles.tile} data-testid="tile-income">
                <span className={styles.tileLabel}>{t('dash.income')}</span>
                <strong className={styles.tileValue}>{money(top.income)}</strong>
              </div>
              <div className={styles.tile} data-testid="tile-balance" data-negative={top.balance < 0}>
                <span className={styles.tileLabel}>{t('dash.balance')}</span>
                <strong className={`${styles.tileValue} ${top.balance < 0 ? styles.neg : ''}`}>{money(top.balance)}</strong>
              </div>
              <button type="button" className={`${styles.tile} ${styles.budgetTile} ${top.overall ? styles[top.overall.level] : ''}`} data-testid="tile-budget" onClick={() => navigate('/app/plan', { state: { tab: 'budgets' } })}>
                <span className={styles.tileLabel}>{top.overall ? (top.overall.left < 0 ? t('dash.budgetOver') : t('dash.budgetLeft')) : t('dash.budgetLeft')}</span>
                <strong className={styles.tileValue}>{top.overall ? money(Math.abs(top.overall.left)) : t('dash.budgetNotSet')}</strong>
                <span className={styles.tileSub}>{top.overall ? t('dash.budgetPct', { percent: Math.min(999, Math.round(top.overall.percent)), amount: money(top.overall.limit) }) : t('dash.budgetTap')}</span>
              </button>
            </div>
          </div>

          {frequent.length > 0 ? (
            <div className={styles.quick} aria-label={t('dash.quick')}>
              <span className={styles.quickLabel}>{t('dash.quick')}</span>
              {frequent.map((item) => (
                <button key={item.merchant} type="button" className={styles.chip} onClick={() => openAdd({ copy: { kind: 'expense', row: item.latest } })}>
                  {item.merchant} <small>{formatMoney(item.latest.amount)}</small>
                </button>
              ))}
            </div>
          ) : null}

          <div className={styles.insights}>
            <div className={styles.insight}>
              <span className={styles.insightLabel}>{detail.separated ? t('dash.dailyEveryday') : t('dash.daily')}</span>
              <strong className={styles.insightValue} data-testid="daily">
                {money(detail.dailyAverage)}
              </strong>
              <span className={styles.insightSub}>{detail.separated ? t('dash.dailyLeaves', { amount: money(detail.fixedBills) }) : isCurrent ? t('dash.dailySoFar', { n: detail.days }) : t('dash.dailyDays', { n: detail.days })}</span>
            </div>
            <div className={styles.insight}>
              <span className={styles.insightLabel}>{t('dash.top')}</span>
              {detail.topCategory ? (
                <>
                  <strong className={styles.insightValue}>{categoryOf(detail.topCategory.key).label}</strong>
                  <span className={styles.insightSub}>{t(detail.separated ? 'dash.topSubEveryday' : 'dash.topSub', { amount: money(detail.topCategory.cents), percent: Math.round(detail.topCategory.percent) })}</span>
                </>
              ) : (
                <>
                  <strong className={styles.insightValue}>—</strong>
                  <span className={styles.insightSub}>{t('dash.none')}</span>
                </>
              )}
            </div>
            <div className={styles.insight}>
              <span className={styles.insightLabel}>{t('dash.largest')}</span>
              {detail.largest ? (
                <>
                  <strong className={styles.insightValue}>{formatMoney(detail.largest.amount)}</strong>
                  <span className={styles.insightSub}>
                    {detail.largest.merchant || categoryOf(detail.largest.category).label} · {formatDate(isoToYmd(detail.largest.created_at), data.dateFormat)}
                  </span>
                </>
              ) : (
                <>
                  <strong className={styles.insightValue}>—</strong>
                  <span className={styles.insightSub}>{t('dash.none')}</span>
                </>
              )}
            </div>
          </div>

          <div className={styles.grid2}>
            <section className={styles.card} aria-labelledby="dash-cat">
              <h2 id="dash-cat" className={styles.h2}>
                {t('dash.byCategory')}
              </h2>
              <p className={styles.muted}>{t('dash.byCategorySub')}</p>
              {slices.length === 0 ? (
                <p className={styles.empty}>{t('dash.noSpendMonth')}</p>
              ) : (
                <div className={styles.catBody}>
                  <Donut slices={slices.map((slice) => ({ key: slice.key, color: categoryOf(slice.key).color, percent: slice.percent, label: categoryOf(slice.key).label }))} centre={money(top.spent)} caption={t('dash.spentWord')} label={t('dash.donutLabel')} />
                  <ul className={styles.catList}>
                    {slices.map((slice) => {
                      const item = categoryOf(slice.key);
                      return (
                        <li key={slice.key}>
                          <button type="button" className={styles.catRow} onClick={() => goHistory(slice.key)} data-category={slice.key}>
                            <span className={styles.catGlyph} aria-hidden="true">
                              {item.glyph}
                            </span>
                            <span className={styles.catName}>{item.label}</span>
                            <span className={styles.catAmount}>
                              {money(slice.cents)}
                              <small>{Math.round(slice.percent)}%</small>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </section>

            <section className={styles.card} aria-labelledby="dash-trend">
              <h2 id="dash-trend" className={styles.h2}>
                {t('dash.trend')}
              </h2>
              <p className={styles.muted}>{t('dash.trendSub')}</p>
              <TrendBars
                points={bars.map((point) => ({ key: point.month, label: monthLabel(point.month, lang, 'short'), spent: point.spent, income: point.income, active: point.month === month, aria: t('dash.trendBar', { month: monthLabel(point.month, lang, 'long'), spent: money(point.spent), income: money(point.income) }) }))}
                onPick={setMonth}
              />
              <ul className={styles.legend}>
                <li>
                  <span className={styles.dotSpent} aria-hidden="true" /> {t('dash.legendSpent')}
                </li>
                <li>
                  <span className={styles.dotIncome} aria-hidden="true" /> {t('dash.legendIncome')}
                </li>
              </ul>
            </section>
          </div>

          <div className={styles.grid2}>
            <section className={styles.card} aria-labelledby="dash-coming">
              <div className={styles.cardHead}>
                <h2 id="dash-coming" className={styles.h2}>
                  {t('dash.comingUp')}
                </h2>
                <button type="button" className={styles.link} onClick={() => navigate('/app/plan')}>
                  {t('nav.plan')}
                </button>
              </div>
              {upcoming.length === 0 ? (
                <p className={styles.empty}>{t('dash.comingEmpty')}</p>
              ) : (
                <ul className={styles.rows}>
                  {upcoming.map((item) => {
                    const wording = dueWording(item.due, today);
                    const when = wording.kind === 'today' ? t('due.today') : wording.kind === 'tomorrow' ? t('due.tomorrow') : t('due.inDays', { n: wording.days });
                    return (
                      <li key={item.id} className={styles.rowItem}>
                        <span className={styles.rowText}>
                          <span className={styles.rowTitle}>{item.title}</span>
                          <span className={`${styles.rowSub} ${daysBetween(today, item.due) <= 3 ? styles.soon : ''}`}>
                            {when} · {formatDate(item.due, data.dateFormat)}
                          </span>
                        </span>
                        <span className={`${styles.rowAmount} ${item.amount > 0 ? styles.pos : ''}`}>{formatSigned(item.amount / 100)}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className={styles.card} aria-labelledby="dash-recent">
              <div className={styles.cardHead}>
                <h2 id="dash-recent" className={styles.h2}>
                  {t('dash.recent')}
                </h2>
                <button type="button" className={styles.link} onClick={() => navigate('/app/history')}>
                  {t('dash.viewAll')}
                </button>
              </div>
              <ul className={styles.rows}>
                {recent.map((entry) => {
                  const isExpense = entry.kind === 'expense';
                  const title = isExpense ? (entry.row as Expense).merchant || categoryOf((entry.row as Expense).category).label : (entry.row as Income).source;
                  return (
                    <li key={`${entry.kind}-${entry.row.id}`}>
                      <button type="button" className={styles.rowItem} onClick={() => openAdd({ edit: { kind: entry.kind, row: entry.row } })}>
                        <span className={styles.rowText}>
                          <span className={styles.rowTitle}>{title}</span>
                          <span className={styles.rowSub}>{formatDate(isoToYmd(entry.row.created_at), data.dateFormat)}</span>
                        </span>
                        <span className={`${styles.rowAmount} ${isExpense ? '' : styles.pos}`}>{formatSigned((isExpense ? -1 : 1) * (toCents(entry.row.amount) / 100))}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          </div>

          <section className={styles.card} aria-labelledby="dash-patterns">
            <h2 id="dash-patterns" className={styles.h2}>
              {t('dash.patterns')}
            </h2>
            <p className={styles.muted}>{t('dash.patternsSub')}</p>
            <p>{t('dash.last7', { amount: money(patterns.last7) })}</p>
            {patterns.change !== null && patterns.change !== 0 ? <p className={styles.muted}>{patterns.change > 0 ? t('dash.moreThan', { percent: patterns.change }) : t('dash.lessThan', { percent: Math.abs(patterns.change) })}</p> : null}
            {patterns.repeats.length > 0 ? (
              <>
                <ul className={styles.repeats}>
                  {patterns.repeats.map((repeat) => (
                    <li key={repeat.merchant}>{t(repeat.every === 'week' ? 'dash.repeatWeek' : 'dash.repeatMonth', { merchant: repeat.merchant, n: repeat.count })}</li>
                  ))}
                </ul>
                <p className={styles.muted}>{t('dash.repeatHint')}</p>
              </>
            ) : (
              <p className={styles.muted}>{t('dash.patternsEmpty')}</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
