// HI-01, TX-04: every record, newest first, grouped by day with the day's total; filter by type, category and month; search.
import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { downloadCsv, entriesToCsv } from '@/features/csv/DataCard';
import { Button } from '@/components/Button';
import { CatIcon } from '@/components/CatIcon';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icon';
import { Notice } from '@/components/Notice';
import { useToast } from '@/components/Toast';
import { useI18n } from '@/lib/i18n';
import { daysBetween, formatDate, isoToYmd, monthKey, monthOf, todayYmd } from '@/lib/dates';
import { formatMoney, formatSigned, toCents } from '@/lib/money';
import { useMoney } from '@/features/money/MoneyContext';
import type { Expense, Income } from '@/features/money/types';
import { SwipeRow } from './SwipeRow';
import { useJustAdded } from '@/features/money/justAdded';
import styles from './HistoryPage.module.css';

type Row = { kind: 'expense'; row: Expense & { pending?: boolean } } | { kind: 'income'; row: Income & { pending?: boolean } };
const DAYS_PER_PAGE = 60;

export function HistoryPage() {
  const { t } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const { data, actions, categoryOf, paymentOf, categories, openAdd } = useMoney();
  const [type, setType] = useState<'all' | 'expense' | 'income'>('all');
  // the dashboard sends the month and category it was showing, so History opens already narrowed to them
  const incoming = (useLocation().state ?? null) as { month?: string; category?: string } | null;
  const [category, setCategory] = useState(incoming?.category ?? '');
  const [month, setMonth] = useState(incoming?.month ?? '');
  const [search, setSearch] = useState('');
  const [days, setDays] = useState(DAYS_PER_PAGE);

  const rows = useMemo<Row[]>(() => {
    const all: Row[] = [...data.expenses.map((row) => ({ kind: 'expense' as const, row })), ...data.incomes.map((row) => ({ kind: 'income' as const, row }))];
    const needle = search.trim().toLowerCase();
    return all
      .filter((entry) => type === 'all' || entry.kind === type)
      .filter((entry) => !category || (entry.kind === 'expense' && entry.row.category === category))
      .filter((entry) => !month || monthOf(entry.row.created_at) === month)
      .filter((entry) => {
        if (!needle) return true;
        const text = entry.kind === 'expense' ? `${entry.row.merchant ?? ''} ${entry.row.note ?? ''} ${categoryOf(entry.row.category).label}` : entry.row.source;
        return text.toLowerCase().includes(needle);
      })
      .sort((a, b) => b.row.created_at.localeCompare(a.row.created_at));
  }, [data.expenses, data.incomes, type, category, month, search, categoryOf]);

  const groups = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const entry of rows) {
      const day = isoToYmd(entry.row.created_at);
      map.set(day, [...(map.get(day) ?? []), entry]);
    }
    return [...map.entries()];
  }, [rows]);
  const shown = groups.slice(0, days);

  const monthsAvailable = useMemo(() => [...new Set([...data.expenses, ...data.incomes].map((row) => monthOf(row.created_at)))].sort().reverse(), [data.expenses, data.incomes]);

  // HI-02: the list as it is filtered right now, as a CSV
  const exportShown = () => {
    const entries = rows.filter((entry) => !entry.row.id.startsWith('queued-'));
    if (!entries.length) return;
    downloadCsv(entriesToCsv(entries, { category: (key) => categoryOf(key).label, payment: (key) => paymentOf(key).label }), `vinexpenses-${month || 'all'}-transactions.csv`);
    toast.show('success', t('data.exported', { n: entries.length }));
  };

  const duplicate = (entry: Row) => openAdd({ copy: { kind: entry.kind, row: entry.row } });
  const remove = async (entry: Row) => {
    try {
      await actions.deleteTransaction(entry.kind, entry.row.id);
      toast.show('success', t('add.deleted'), { label: t('add.undo'), onClick: () => void actions.restoreTransaction(entry.kind, entry.row).then(() => toast.show('info', t('add.restored'))) });
    } catch {
      toast.show('error', t('add.failed'));
    }
  };

  const fresh = useJustAdded();
  const filtered = Boolean(type !== 'all' || category || month || search.trim());
  const reset = () => {
    setType('all');
    setCategory('');
    setMonth('');
    setSearch('');
    setDays(DAYS_PER_PAGE);
  };
  const today = todayYmd();
  // the banner: the chosen month (or this month), from every record, whatever else is filtered
  const bannerMonth = month || monthKey(today);
  const inBanner = <T extends { created_at: string; amount: string | number }>(list: T[]) => list.filter((row) => monthOf(row.created_at) === bannerMonth);
  const total = (list: { amount: string | number }[]) => list.reduce((sum, row) => sum + toCents(row.amount), 0);
  const banner = { spent: total(inBanner(data.expenses)), income: total(inBanner(data.incomes)), count: inBanner(data.expenses).length + inBanner(data.incomes).length };
  const monthText = (value: string) => formatDate(`${value}-01`, 'dmy_short').replace(/^1 /, '');
  // what is listed right now
  const sumOf = (kind: Row['kind']) => rows.filter((entry) => entry.kind === kind).reduce((total, entry) => total + toCents(entry.row.amount), 0);
  const listed = { out: sumOf('expense'), in: sumOf('income') };
  const dayName = (day: string) => {
    const ago = daysBetween(day, today);
    return ago === 0 ? t('history.today') : ago === 1 ? t('history.yesterday') : formatDate(day, data.dateFormat);
  };

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div>
          <h1 className={styles.h1}>{t('screen.history.title')}</h1>
          <p className={styles.pageSub}>{t('history.sub')}</p>
        </div>
        <span className={styles.headAdd}>
          <Button onClick={() => openAdd()}>
            <Icon name="plus" size={18} />
            {t('nav.add')}
          </Button>
        </span>
      </header>

      <section className={styles.overview} aria-label={t('history.spentIn', { month: monthText(bannerMonth) })} data-testid="history-overview">
        <div className={styles.overviewMain}>
          <span className={styles.overviewLabel}>{t('history.spentIn', { month: monthText(bannerMonth) })}</span>
          <strong className={styles.overviewAmount}>{formatMoney(banner.spent / 100)}</strong>
          <span className={styles.overviewMeta}>{t('history.count', { n: banner.count })}</span>
        </div>
        <dl className={styles.overviewStats}>
          <div>
            <dt>{t('dash.income')}</dt>
            <dd>{formatMoney(banner.income / 100)}</dd>
          </div>
          <div>
            <dt>{t('history.expenses')}</dt>
            <dd>{formatMoney(banner.spent / 100)}</dd>
          </div>
        </dl>
      </section>

      <div className={styles.filters}>
        <div className={styles.search}>
          <Icon name="search" size={18} />
          <input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setDays(DAYS_PER_PAGE); }} placeholder={t('history.search')} aria-label={t('history.search')} autoComplete="off" />
        </div>
        <div className={styles.filterRow}>
          <label className={styles.select}>
            <span className="sr-only">{t('history.type')}</span>
            <select value={type} onChange={(event) => { setType(event.target.value as typeof type); setDays(DAYS_PER_PAGE); }}>
              <option value="all">{t('history.allTypes')}</option>
              <option value="expense">{t('add.expense')}</option>
              <option value="income">{t('add.income')}</option>
            </select>
          </label>
          <label className={styles.select}>
            <span className="sr-only">{t('history.category')}</span>
            <select value={category} onChange={(event) => { setCategory(event.target.value); setDays(DAYS_PER_PAGE); }}>
              <option value="">{t('history.allCategories')}</option>
              {categories.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.select}>
            <span className="sr-only">{t('history.month')}</span>
            <select value={month} onChange={(event) => { setMonth(event.target.value); setDays(DAYS_PER_PAGE); }}>
              <option value="">{t('history.anyMonth')}</option>
              {monthsAvailable.map((value) => (
                <option key={value} value={value}>
                  {monthText(value)}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className={styles.reset} onClick={reset} disabled={!filtered}>
            <Icon name="x" size={16} />
            {t('history.reset')}
          </button>
        </div>
      </div>

      <section className={styles.exportCard} aria-labelledby="history-export">
        <div className={styles.exportText}>
          <h2 id="history-export">{t('history.exportTitle')}</h2>
          <p>{t('history.exportBody')}</p>
        </div>
        <div className={styles.exportActions}>
          <Button variant="outline" onClick={exportShown} disabled={rows.length === 0}>
            {t('history.exportCsv')}
          </Button>
          <Button variant="outline" onClick={() => navigate(`/app/report?month=${month || monthKey(todayYmd())}`)}>
            {t('report.open')}
          </Button>
        </div>
      </section>

      {data.failed ? (
        <Notice kind="warn">
          {t('money.loadFailed')}{' '}
          <button type="button" className={styles.link} onClick={data.reload}>
            {t('common.retry')}
          </button>
        </Notice>
      ) : null}
      {data.pendingCount > 0 ? <Notice kind="info">{t('money.pendingBanner', { n: data.pendingCount })}</Notice> : null}

      {data.loading ? (
        <p className={styles.muted} role="status">
          {t('history.loading')}
        </p>
      ) : groups.length === 0 ? (
        <EmptyState icon="history" title={t('screen.history.title')} action={filtered ? undefined : <Button onClick={() => openAdd()}>{t('nav.add')}</Button>}>
          {filtered ? t('history.emptyFiltered') : t('history.empty')}
        </EmptyState>
      ) : (
        <div className={styles.list}>
          <p className={styles.summary} role="status" data-testid="history-summary">
            <span>
              <strong>{rows.length}</strong> {t('history.entriesWord')}
            </span>
            {listed.in > 0 ? <span className={styles.in}>{formatSigned(listed.in / 100)}</span> : null}
            {listed.out > 0 ? <span className={styles.out}>{formatSigned(-listed.out / 100)}</span> : null}
          </p>
          <p className={styles.swipeHint}>{t('history.swipeHint')}</p>
          {shown.map(([day, entries]) => {
            const net = entries.reduce((total, entry) => total + (entry.kind === 'income' ? 1 : -1) * toCents(entry.row.amount), 0);
            return (
              <section key={day} className={styles.day} aria-label={formatDate(day, data.dateFormat)}>
                <header className={styles.dayHead}>
                  <h2>{dayName(day)}</h2>
                  <span className={net < 0 ? styles.out : styles.in}>{formatSigned(net / 100)}</span>
                </header>
                <ul className={styles.rows}>
                  {entries.map((entry) => {
                    const isExpense = entry.kind === 'expense';
                    const item = isExpense ? categoryOf((entry.row as Expense).category) : null;
                    const title = isExpense ? (entry.row as Expense).merchant || (entry.row as Expense).note || item?.label : (entry.row as Income).source;
                    const sub = isExpense ? `${item?.label} · ${paymentOf((entry.row as Expense).payment).label}` : t('add.income');
                    const amount = formatSigned((isExpense ? -1 : 1) * (toCents(entry.row.amount) / 100));
                    return (
                      <SwipeRow key={`${entry.kind}-${entry.row.id}`} className={`${styles.row} ${fresh === entry.row.id ? styles.fresh : ''}`} kind={entry.kind} duplicateLabel={t('history.duplicate')} deleteLabel={t('add.delete')} onDuplicate={() => duplicate(entry)} onDelete={() => void remove(entry)}>
                        <button type="button" data-slide className={styles.main} onClick={() => openAdd({ edit: { kind: entry.kind, row: entry.row } })}>
                          <span className={styles.glyph} data-glyph={item?.key ?? 'income'}>
                            {item ? <CatIcon name={item.key} color={item.color} glyph={item.glyph} /> : <CatIcon name="income" color="#059669" />}
                          </span>
                          <span className={styles.text}>
                            <span className={styles.title}>{title}</span>
                            <span className={styles.sub}>
                              {sub}
                              {entry.row.pending ? <span className={styles.badge}>{t('money.notSynced')}</span> : null}
                            </span>
                          </span>
                          <span className={`${styles.amount} ${isExpense ? styles.out : styles.in}`}>{amount}</span>
                        </button>
                        <div className={styles.tools}>
                          <button type="button" className={styles.tool} onClick={() => duplicate(entry)} aria-label={`${t('history.duplicate')}: ${title}`}>
                            <Icon name="copy" size={18} />
                          </button>
                          <button type="button" className={`${styles.tool} ${styles.danger}`} onClick={() => void remove(entry)} aria-label={`${t('add.delete')}: ${title}`}>
                            <Icon name="x" size={18} />
                          </button>
                        </div>
                      </SwipeRow>
                    );
                  })}
                </ul>
              </section>
            );
          })}
          {groups.length > shown.length ? (
            <Button variant="outline" block onClick={() => setDays((n) => n + DAYS_PER_PAGE)}>
              {t('common.show')} ({groups.length - shown.length})
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
