// TG-02: the Telegram Mini App, built in the same codebase as the web app. No sign-in screen and no stored password: Telegram's signed
// launch data goes to the server, which checks the signature and finds the person. Only the person's own expenses are ever shown.
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/Button';
import { ChipGroup } from '@/components/ChipGroup';
import { amountSize, Field } from '@/components/Field';
import { Sheet } from '@/components/Sheet';
import { useToast } from '@/components/Toast';
import { Donut } from '@/features/dashboard/charts';
import { useI18n } from '@/lib/i18n';
import { envResult } from '@/lib/env';
import { createApi, MiniApiError, type Choice, type ErrorCode, type Insight, type Item, type MiniApi, type MonthData } from './api';
import { createBridge, frameAllowed, type Bridge } from './bridge';
import { createDemo } from './demo';
import type { MiniKey } from './dict';
import { asLang, COLORS, compactMoney, dayKey, dayLabel, emojiFor, formatKey, heatLevel, keyOfMonthDay, minDate, money, monthShort, monthTitle, PALETTE, percent, safeColor, translate, trend, truncate, weekdayShort, type Lang } from './format';
import styles from './MiniApp.module.css';

type Tab = 'overview' | 'days' | 'budgets' | 'trend' | 'history';
const TABS: { id: Tab; glyph: string; key: MiniKey }[] = [
  { id: 'overview', glyph: '🏠', key: 'tab_overview' },
  { id: 'days', glyph: '📅', key: 'tab_days' },
  { id: 'budgets', glyph: '🎯', key: 'tab_budgets' },
  { id: 'trend', glyph: '📈', key: 'tab_trend' },
  { id: 'history', glyph: '🕘', key: 'tab_history' },
];
type Status = 'loading' | 'ready' | 'problem';
interface HistoryState {
  items: Item[];
  total: number;
  sum: number;
  category: string;
  q: string;
  loading: boolean;
}
interface SheetState {
  mode: 'add' | 'edit';
  item: Item | null;
  error: string;
  saving: boolean;
  confirmDelete: boolean;
}

export function MiniApp() {
  const toast = useToast();
  const params = useMemo(() => new URLSearchParams(location.search), []);
  const bridge = useMemo<Bridge>(() => createBridge(window), []);
  const demoMode = params.get('demo') === '1' && !bridge.isTelegram;

  const [lang, setLang] = useState<Lang>(() => asLang(bridge.user?.language_code || navigator.language || 'en'));
  const [tab, setTab] = useState<Tab>(() => (demoMode && (['overview', 'days', 'budgets', 'trend', 'history'] as const).find((id) => id === params.get('tab'))) || 'overview');
  const [offset, setOffset] = useState(0);
  const [month, setMonth] = useState<MonthData | null>(null);
  const [categories, setCategories] = useState<Choice[]>([]);
  const [payments, setPayments] = useState<Choice[]>([]);
  const [today, setToday] = useState(() => dayKey(new Date().toISOString()));
  const [maxOffset, setMaxOffset] = useState(60);
  const [maxDaysBack, setMaxDaysBack] = useState(400);
  const [status, setStatus] = useState<Status>('loading');
  const [problem, setProblem] = useState<ErrorCode | 'open_telegram'>('open_telegram');
  const [history, setHistory] = useState<HistoryState>({ items: [], total: 0, sum: 0, category: '', q: '', loading: false });
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [searchText, setSearchText] = useState('');
  const apiRef = useRef<MiniApi | null>(null);
  const monthToken = useRef(0);
  const historyToken = useRef(0);

  const i18n = useI18n();
  const { setLang: setSharedLang } = i18n;
  const t = useCallback((key: MiniKey, vars?: Record<string, string | number>) => translate(lang, key, vars), [lang]);

  // The language and title follow the person; the theme follows Telegram's colours
  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : lang;
    document.title = translate(lang, 'app_title');
    setSharedLang(lang); // the shared sheet and toast words follow the same language
  }, [lang, setSharedLang]);

  const fail = useCallback((error: unknown) => {
    setProblem(error instanceof MiniApiError ? error.code : 'unavailable');
    setStatus('problem');
  }, []);

  const loadMonth = useCallback(
    async (target: number, quiet: boolean) => {
      const api = apiRef.current;
      if (!api) return;
      const token = (monthToken.current += 1);
      try {
        const reply = await api.month(target);
        if (token !== monthToken.current) return;
        setMonth(reply.data);
        setStatus('ready');
      } catch (error) {
        if (token !== monthToken.current) return;
        if (quiet) toast.show('error', translate(lang, error instanceof MiniApiError && error.code === 'network' ? 'err_network' : 'err_generic'));
        else fail(error);
      }
    },
    [fail, lang, toast],
  );

  const loadHistory = useCallback(
    async (target: number, filters: { category: string; q: string }, append: boolean, skip: number) => {
      const api = apiRef.current;
      if (!api) return;
      const token = (historyToken.current += 1);
      setHistory((h) => ({ ...h, ...filters, loading: true, ...(append ? {} : { items: [], total: 0, sum: 0 }) }));
      try {
        const reply = await api.transactions({ offset: target, category: filters.category, q: filters.q, skip, limit: 50 });
        if (token !== historyToken.current) return;
        setHistory((h) => ({ ...h, items: append ? [...h.items, ...reply.items] : reply.items, total: reply.total, sum: reply.sum, loading: false }));
      } catch (error) {
        if (token !== historyToken.current) return;
        setHistory((h) => ({ ...h, loading: false }));
        toast.show('error', translate(lang, error instanceof MiniApiError && error.code === 'network' ? 'err_network' : 'err_generic'));
      }
    },
    [lang, toast],
  );

  const start = useCallback(async () => {
    setStatus('loading');
    setMonth(null);
    bridge.applyTheme(document.documentElement);
    bridge.start();
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    if (/^#[0-9a-f]{6}$/i.test(bg)) bridge.setColors(bg);
    if (!demoMode && (!bridge.isTelegram || !frameAllowed(window))) {
      setProblem('open_telegram');
      setStatus('problem');
      return;
    }
    if (!demoMode && !envResult.ok) {
      setProblem('unavailable');
      setStatus('problem');
      return;
    }
    if (!apiRef.current) apiRef.current = demoMode ? createDemo({ lang }) : createApi({ baseUrl: envResult.ok ? envResult.env.supabaseUrl : '', anonKey: envResult.ok ? envResult.env.supabaseAnonKey : '', getInitData: () => bridge.initData });
    try {
      const boot = await apiRef.current.bootstrap();
      setLang(asLang(boot.lang || lang));
      setToday(boot.today || today);
      setCategories(boot.categories || []);
      setPayments(boot.payments || []);
      setMaxOffset(boot.maxOffset || 60);
      setMaxDaysBack(boot.maxDaysBack || 400);
      await loadMonth(0, false);
      if (demoMode && params.get('sheet') === 'add') setSheet({ mode: 'add', item: null, error: '', saving: false, confirmDelete: false });
    } catch (error) {
      fail(error);
    }
    // starting runs once, when the page opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // opening the page starts it once; the first screen is the loading state, so setting state here is the point
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void start();
  }, [start]);

  // a history tab opened for the first time, or after a month change, loads its list
  useEffect(() => {
    if (status === 'ready' && tab === 'history') void loadHistory(offset, { category: history.category, q: history.q }, false, 0);
    // only when the tab or month changes; the filters call loadHistory themselves
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, offset, status === 'ready']);

  // Telegram changes its theme while the page is open
  useEffect(() => {
    bridge.onTheme(() => bridge.applyTheme(document.documentElement));
  }, [bridge]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSheet(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const refreshAll = async () => {
    await loadMonth(offset, true);
    if (tab === 'history') await loadHistory(offset, { category: history.category, q: history.q }, false, 0);
  };

  const changeMonth = (delta: number) => {
    const next = offset + delta;
    if (next < 0 || next > maxOffset) return;
    bridge.haptic('select');
    setOffset(next);
    setMonth(null);
    setStatus('loading');
    void loadMonth(next, false);
  };

  const pickTab = (id: Tab) => {
    if (id === tab) return;
    bridge.haptic('select');
    setTab(id);
    window.scrollTo(0, 0);
  };

  const category = (key: string) => {
    const found = categories.find((c) => c.key === key);
    return { key, label: found?.label ?? key, color: safeColor(found?.color, Object.prototype.hasOwnProperty.call(COLORS, key) ? (COLORS[key] as string) : (PALETTE[7] as string)), glyph: emojiFor(key) };
  };
  const paymentLabel = (key: string) => payments.find((p) => p.key === key)?.label ?? key;

  // ---- screens ----
  const problemView = () => {
    const map: Record<string, [string, MiniKey, MiniKey]> = {
      open_telegram: ['🔒', 'err_open_telegram', 'err_open_telegram_hint'],
      unauthorized: ['🔒', 'err_open_telegram', 'err_open_telegram_hint'],
      expired: ['⏳', 'err_expired', 'err_expired_hint'],
      not_linked: ['🔗', 'err_not_linked', 'err_not_linked_hint'],
      limit: ['⛔', 'err_limit', 'err_limit'],
      network: ['📶', 'err_network', 'err_generic'],
    };
    const entry = map[problem] ?? ['⚠️', 'err_generic', 'err_generic'];
    const retry = problem === 'network' || (!map[problem] && problem !== 'open_telegram');
    return (
      <section className={styles.card} role="alert">
        <div className={styles.emptyIcon} aria-hidden="true">
          {entry[0]}
        </div>
        <h2>{t(entry[1])}</h2>
        <p>{t(entry[2])}</p>
        <div className={styles.btnRow}>
          {retry ? <Button onClick={() => void start()}>{t('retry')}</Button> : null}
          {problem === 'expired' || problem === 'unauthorized' ? (
            <Button variant="outline" onClick={() => bridge.close()}>
              {t('close')}
            </Button>
          ) : null}
          {problem === 'not_linked' || problem === 'open_telegram' ? (
            <Button onClick={() => bridge.openLink(`${location.origin}/`)}>{t('open_website')}</Button>
          ) : null}
          {problem === 'open_telegram' ? (
            <Button variant="outline" onClick={() => (location.search = '?demo=1')}>
              {t('try_preview')}
            </Button>
          ) : null}
        </div>
      </section>
    );
  };

  const emptyMonth = () => (
    <section className={styles.card}>
      <div className={styles.emptyIcon} aria-hidden="true">
        🌱
      </div>
      <h2>{t('no_data')}</h2>
      <p>{t('no_data_hint')}</p>
      <Button onClick={() => setSheet({ mode: 'add', item: null, error: '', saving: false, confirmDelete: false })}>{t('add_expense')}</Button>
    </section>
  );

  const insightText = (i: Insight): { glyph: string; text: string } => {
    if (i.kind === 'cat') return { glyph: category(i.key).glyph, text: t(i.up ? 'ins_cat_up' : 'ins_cat_down', { cat: category(i.key).label, pct: `${i.pct}%` }) };
    if (i.kind === 'weekend') return { glyph: i.weekendHeavy ? '🥂' : '💼', text: t(i.weekendHeavy ? 'ins_weekend_heavy' : 'ins_weekday_heavy', { x: i.ratio }) };
    const name = i.key === 'all' ? t('budget_overall') : category(i.key).label;
    return i.warn ? { glyph: '⚠️', text: t('ins_pace_warn', { name, pct: `${Math.round(i.projected * 100)}%` }) } : { glyph: '🎯', text: t('ins_pace_ok', { name, used: `${Math.round(i.used * 100)}%`, day: i.day }) };
  };

  const slices = (data: MonthData) => {
    const top = data.byCategory.slice(0, 6).map(([key, amount], i) => ({ ...category(key), amount, fallback: PALETTE[i % PALETTE.length] as string, count: 0 }));
    const rest = data.byCategory.slice(6);
    if (rest.length) top.push({ key: '', label: t('others'), color: PALETTE[7] as string, glyph: '⋯', amount: rest.reduce((s, e) => s + e[1], 0), count: rest.length, fallback: PALETTE[7] as string });
    return top;
  };

  const overview = (data: MonthData) => {
    if (!data.count) return emptyMonth();
    const change = data.previousCount ? trend(data.total, data.previousTotal) : null;
    const list = slices(data);
    return (
      <>
        <section className={styles.hero} aria-label={t('spent')}>
          <div className={styles.heroTop}>
            <span>{t('spent')}</span>
            <span className={styles.pills}>
              {change ? <span className={styles.pill}>{`${change.arrow} ${change.text} ${t('vs_last')}`}</span> : null}
              {data.streak >= 2 ? <span className={styles.pill}>🔥 {t('streak', { n: data.streak })}</span> : null}
            </span>
          </div>
          <p className={styles.amount} data-testid="mini-total">
            {money(data.total)}
          </p>
          {data.income > 0 ? (
            <div className={styles.meta}>
              <span className={styles.pill}>
                {t('income')} <b>{money(data.income)}</b>
              </span>
              <span className={styles.pill}>
                {t('net')} <b>{money(data.income - data.total)}</b>
              </span>
              <span className={styles.pill}>
                {t('saved')} <b>{percent(Math.max(0, (data.income - data.total) / data.income))}</b>
              </span>
            </div>
          ) : null}
        </section>
        <section className={styles.card} aria-labelledby="mini-where">
          <h2 id="mini-where" className={styles.h2}>
            {t('where_it_went')}
          </h2>
          <Donut slices={list.map((s) => ({ key: s.key || 'others', color: safeColor(s.color, s.fallback), percent: data.total > 0 ? (s.amount / data.total) * 100 : 0, label: s.label }))} centre={compactMoney(data.total)} caption={t('categories_count', { n: data.byCategory.length })} label={t('chart_donut')} />
          <ul className={styles.catList}>
            {list.map((s) => {
              const share = data.total > 0 ? s.amount / data.total : 0;
              const body = (
                <>
                  <span className={styles.catGlyph} aria-hidden="true">
                    {s.glyph}
                  </span>
                  <span className={styles.catName}>{s.key ? s.label : `${s.label}${s.count ? ` (${s.count})` : ''}`}</span>
                  <span className={styles.catAmount}>
                    <b>{money(s.amount)}</b>
                    <small>{percent(share)}</small>
                  </span>
                </>
              );
              return (
                <li key={s.key || 'others'}>
                  {s.key ? (
                    <button
                      type="button"
                      className={styles.catRow}
                      data-category={s.key}
                      onClick={() => {
                        bridge.haptic('select');
                        setHistory((h) => ({ ...h, category: s.key }));
                        setTab('history');
                        void loadHistory(offset, { category: s.key, q: history.q }, false, 0);
                        window.scrollTo(0, 0);
                      }}
                    >
                      {body}
                    </button>
                  ) : (
                    <div className={styles.catRow}>{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
          <p className={styles.hint}>{t('ranked')}</p>
        </section>
        {data.insights.length ? (
          <ul className={styles.insights}>
            {data.insights.slice(0, 3).map((i, index) => {
              const x = insightText(i);
              return (
                <li key={index} className={styles.insight}>
                  <span aria-hidden="true">{x.glyph}</span>
                  <span>{x.text}</span>
                </li>
              );
            })}
          </ul>
        ) : null}
      </>
    );
  };

  const days = (data: MonthData) => {
    if (!data.count) return emptyMonth();
    const passed = data.todayIndex === null ? data.days : data.todayIndex + 1;
    const active = data.daily.slice(0, passed).filter((v) => v > 0).length;
    const top = data.daily.reduce((best, v, i) => (v > (data.daily[best] as number) ? i : best), 0);
    const busiest = (data.daily[top] as number) > 0 ? `${formatKey(keyOfMonthDay(data.start, top), lang, { weekday: 'short', day: 'numeric', month: 'short' })} · ${money(data.daily[top])}` : '–';
    const max = Math.max(1, ...data.daily.slice(0, passed));
    const positives = data.daily.slice(0, passed).filter((v) => v > 0).sort((a, b) => a - b);
    const columns = Math.ceil((data.firstWeekday + data.days) / 7);
    const weekend = data.insights.filter((i) => i.kind === 'weekend').map(insightText);
    return (
      <>
        <section className={styles.stats}>
          <Stat glyph="🏆" label={t('busiest')} value={busiest} />
          <Stat glyph="🧮" label={t('average_day')} value={money(data.total / Math.max(1, passed))} />
          <Stat glyph="📆" label={t('active_days')} value={`${active} / ${passed}`} />
          <Stat glyph="🔥" label={t('streak', { n: data.streak >= 2 ? data.streak : 0 })} value={data.streak >= 2 ? String(data.streak) : '–'} />
        </section>
        <section className={styles.card} aria-labelledby="mini-daily">
          <h2 id="mini-daily" className={styles.h2}>
            {t('daily_spending')}
          </h2>
          <div className={styles.bars} role="img" aria-label={t('chart_days')}>
            {data.daily.slice(0, passed).map((v, i) => (
              <span key={i} className={styles.bar} data-h={Math.max(0, Math.min(100, Math.round((v / max) * 20) * 5))} />
            ))}
          </div>
          {weekend.map((w, i) => (
            <p key={i} className={styles.hint}>
              {w.glyph} {w.text}
            </p>
          ))}
        </section>
        <section className={styles.card} aria-labelledby="mini-heat">
          <h2 id="mini-heat" className={styles.h2}>
            {t('daily_spending')}
          </h2>
          <div className={styles.heat} role="group" aria-label={t('daily_spending')}>
            {Array.from({ length: 7 }, (_, weekday) => (
              <div className={styles.heatRow} key={weekday}>
                <span className={styles.heatDay} aria-hidden="true">
                  {weekdayShort(weekday, lang)}
                </span>
                {Array.from({ length: columns }, (_, week) => {
                  const index = week * 7 + weekday - data.firstWeekday;
                  if (index < 0 || index >= data.days) return <span key={week} className={styles.cell} data-level="blank" aria-hidden="true" />;
                  const future = data.todayIndex !== null && index > data.todayIndex;
                  const value = data.daily[index] ?? 0;
                  const level = future ? 0 : heatLevel(value, positives);
                  const label = `${formatKey(keyOfMonthDay(data.start, index), lang, { weekday: 'short', day: 'numeric', month: 'short' })}: ${money(value)}`;
                  return (
                    <button key={week} type="button" className={styles.cell} data-level={level} data-today={index === data.todayIndex} aria-label={label} disabled={future} onClick={() => setHeat(`${formatKey(keyOfMonthDay(data.start, index), lang, { weekday: 'long', day: 'numeric', month: 'long' })} · ${money(value)}`)}>
                      {index + 1}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          <p className={styles.hint} aria-live="polite" data-testid="mini-heat-detail">
            {heat || t('heat_legend')}
          </p>
        </section>
      </>
    );
  };
  const [heat, setHeat] = useState('');

  const budgets = (data: MonthData) => {
    if (!data.budgets.length) {
      return (
        <section className={styles.card}>
          <div className={styles.emptyIcon} aria-hidden="true">
            🎯
          </div>
          <h2>{t('no_budgets')}</h2>
          <p>{t('no_budgets_hint')}</p>
          <Button variant="outline" onClick={() => bridge.openLink(`${location.origin}/`)}>
            {t('open_website')}
          </Button>
        </section>
      );
    }
    const list = data.budgets.map((b) => ({ ...b, ratio: b.limit > 0 ? b.used / b.limit : 0 })).sort((a, b) => b.ratio - a.ratio);
    return (
      <>
        {list.map((b) => {
          const level = b.ratio > 1 ? 'over' : b.ratio >= 0.8 ? 'watch' : 'ok';
          const info = b.key === 'all' ? { glyph: '🎯', label: t('budget_overall') } : category(b.key);
          const note = b.ratio > 1 ? t('budget_over', { amount: money(b.used - b.limit) }) : t('budget_left', { amount: money(b.limit - b.used) });
          return (
            <article key={b.key} className={styles.card} data-budget={b.key} data-level={level}>
              <div className={styles.budgetTop}>
                <span aria-hidden="true">{info.glyph}</span>
                <b>{info.label}</b>
                <span className={styles.pct}>{percent(b.ratio)}</span>
              </div>
              <progress className={`${styles.track} ${styles[level]}`} max={100} value={Math.min(100, Math.round(b.ratio * 100))} aria-label={`${info.label} ${percent(b.ratio)}`} />
              <div className={styles.budgetFoot}>
                <span>{`${money(b.used)} / ${money(b.limit)}`}</span>
                <span>{note}</span>
              </div>
            </article>
          );
        })}
      </>
    );
  };

  const trendView = (data: MonthData) => {
    const totals = data.monthTotals;
    if (!totals.some((v) => v > 0)) return emptyMonth();
    const best = totals.reduce((b, v, i) => (v > (totals[b] as number) ? i : b), 0);
    const average = totals.reduce((s, v) => s + v, 0) / totals.length;
    const max = Math.max(1, ...totals);
    return (
      <>
        <section className={styles.stats}>
          <Stat glyph="📊" label={t('average_month')} value={money(average)} />
          <Stat glyph="📈" label={t('highest_month')} value={`${monthShort(data.monthStarts[best] as string, lang)} · ${money(totals[best])}`} />
        </section>
        <section className={styles.card} aria-labelledby="mini-trend">
          <h2 id="mini-trend" className={styles.h2}>
            {t('trend_title')}
          </h2>
          <div className={styles.bars} role="img" aria-label={t('chart_trend')}>
            {totals.map((v, i) => (
              <span key={i} className={`${styles.bar} ${i === totals.length - 1 ? styles.current : ''}`} data-h={Math.max(0, Math.min(100, Math.round((v / max) * 20) * 5))} />
            ))}
          </div>
          <ul className={styles.trendList}>
            {totals.map((v, i) => {
              const change = i > 0 ? trend(v, totals[i - 1]) : null;
              return (
                <li key={i} className={`${styles.trendRow} ${i === totals.length - 1 ? styles.current : ''}`}>
                  <span>{monthShort(data.monthStarts[i] as string, lang)}</span>
                  <b>{money(v)}</b>
                  {change && !change.flat ? <span className={styles.chip}>{`${change.arrow} ${change.text}`}</span> : null}
                </li>
              );
            })}
          </ul>
        </section>
      </>
    );
  };

  const historyView = () => {
    const groups: { key: string; items: Item[] }[] = [];
    for (const item of history.items) {
      const key = dayKey(item.created_at);
      const last = groups[groups.length - 1];
      if (last && last.key === key) last.items.push(item);
      else groups.push({ key, items: [item] });
    }
    return (
      <>
        <div className={styles.overviewBar}>
          <span>{t('total')}</span>
          <strong>{money(history.sum)}</strong>
          <span>{t(history.total === 1 ? 'expense_count_one' : 'expense_count_many', { n: history.total })}</span>
        </div>
        <input
          type="search"
          className={styles.search}
          placeholder={t('search')}
          aria-label={t('search')}
          value={searchText}
          maxLength={60}
          autoComplete="off"
          onChange={(event) => setSearchText(event.target.value)}
        />
        <div className={styles.chips} role="group" aria-label={t('category')}>
          <button type="button" className={styles.chipBtn} aria-pressed={!history.category} onClick={() => void loadHistory(offset, { category: '', q: history.q }, false, 0)}>
            {t('all_categories')}
          </button>
          {categories
            .filter((c) => c.active || c.key === history.category)
            .map((c) => (
              <button key={c.key} type="button" className={styles.chipBtn} aria-pressed={history.category === c.key} onClick={() => void loadHistory(offset, { category: c.key, q: history.q }, false, 0)}>
                {category(c.key).glyph} {truncate(c.label, 16)}
              </button>
            ))}
        </div>
        {history.loading && !history.items.length ? (
          <p className={styles.hint} role="status">
            {t('loading')}
          </p>
        ) : history.items.length ? (
          groups.map((g) => (
            <div key={g.key}>
              <h3 className={styles.dayHead}>
                <span>{dayLabel(g.key, today, lang, { today: t('today'), yesterday: t('yesterday') })}</span>
                <span>{money(g.items.reduce((s, i) => s + Math.round(Number(i.amount) * 100), 0) / 100)}</span>
              </h3>
              <ul className={styles.dayGroup}>
                {g.items.map((item) => {
                  const info = category(item.category);
                  return (
                    <li key={item.id}>
                      <button type="button" className={styles.item} data-item={item.merchant || info.label} onClick={() => setSheet({ mode: 'edit', item, error: '', saving: false, confirmDelete: false })}>
                        <span className={styles.itemGlyph} aria-hidden="true">
                          {info.glyph}
                        </span>
                        <span className={styles.itemText}>
                          <b>{truncate(item.merchant || info.label, 40)}</b>
                          <small>{`${info.label} · ${paymentLabel(item.payment)}`}</small>
                        </span>
                        <span className={styles.itemAmount}>{money(item.amount)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        ) : (
          <section className={styles.card}>
            <div className={styles.emptyIcon} aria-hidden="true">
              🌱
            </div>
            <h2>{t('no_data')}</h2>
          </section>
        )}
        {history.items.length < history.total ? (
          <Button variant="outline" block disabled={history.loading} onClick={() => void loadHistory(offset, { category: history.category, q: history.q }, true, history.items.length)}>
            {t('load_more')}
          </Button>
        ) : null}
      </>
    );
  };

  // the search waits a moment after typing stops
  useEffect(() => {
    if (tab !== 'history' || status !== 'ready' || searchText === history.q) return undefined;
    const timer = setTimeout(() => void loadHistory(offset, { category: history.category, q: searchText.slice(0, 60) }, false, 0), 350);
    return () => clearTimeout(timer);
    // the list reloads when the typed text settles
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText]);

  const body = () => {
    if (status === 'problem') return problemView();
    if (status === 'loading' || !month) {
      return (
        <div className={styles.skeleton} aria-busy="true" aria-label={t('loading')}>
          <span className="sr-only">{t('loading')}</span>
        </div>
      );
    }
    return tab === 'overview' ? overview(month) : tab === 'days' ? days(month) : tab === 'budgets' ? budgets(month) : tab === 'trend' ? trendView(month) : historyView();
  };

  const ready = status === 'ready';
  return (
    <div className={styles.root}>
      {demoMode ? <div className={styles.banner}>{t('preview_banner')}</div> : null}
      {ready && month ? (
        <header className={styles.monthBar}>
          <div className={styles.selector}>
            <button type="button" className={styles.nav} onClick={() => changeMonth(1)} disabled={offset >= maxOffset} aria-label={t('prev_month')}>
              ‹
            </button>
            <h1 className={styles.month}>{monthTitle(month.start, lang)}</h1>
            <button type="button" className={styles.nav} onClick={() => changeMonth(-1)} disabled={offset <= 0} aria-label={t('next_month')}>
              ›
            </button>
          </div>
        </header>
      ) : null}
      <main className={styles.main} aria-live="polite">
        {body()}
      </main>
      {ready ? (
        <>
          <button type="button" className={styles.fab} onClick={() => setSheet({ mode: 'add', item: null, error: '', saving: false, confirmDelete: false })} aria-label={t('add_expense')} hidden={Boolean(sheet)}>
            +
          </button>
          <nav className={styles.tabs} aria-label={t('nav_label')}>
            {TABS.map((item) => (
              <button key={item.id} type="button" className={styles.tab} aria-current={tab === item.id ? 'page' : undefined} onClick={() => pickTab(item.id)}>
                <span aria-hidden="true">{item.glyph}</span>
                <span>{t(item.key)}</span>
              </button>
            ))}
          </nav>
        </>
      ) : null}

      <ExpenseSheet
        sheet={sheet}
        categories={categories}
        payments={payments}
        today={today}
        maxDaysBack={maxDaysBack}
        t={t}
        onClose={() => setSheet(null)}
        onSaved={async (message) => {
          setSheet(null);
          bridge.haptic('success');
          toast.show('success', message);
          await refreshAll();
        }}
        onHaptic={(kind) => bridge.haptic(kind)}
        api={apiRef}
      />
    </div>
  );
}

function Stat({ glyph, label, value }: { glyph: string; label: string; value: string }) {
  return (
    <div className={styles.stat}>
      <span aria-hidden="true">{glyph}</span>
      <span>
        <span className={styles.statLabel}>{label}</span>
        <b>{value}</b>
      </span>
    </div>
  );
}

interface SheetProps {
  sheet: SheetState | null;
  categories: Choice[];
  payments: Choice[];
  today: string;
  maxDaysBack: number;
  t: (key: MiniKey, vars?: Record<string, string | number>) => string;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
  onHaptic: (kind: 'success' | 'error' | 'warning' | 'select' | 'light') => void;
  api: { current: MiniApi | null };
}

function ExpenseSheet({ sheet, categories, payments, today, maxDaysBack, t, onClose, onSaved, onHaptic, api }: SheetProps) {
  if (!sheet) return null;
  return <ExpenseBody key={sheet.item?.id ?? 'new'} sheet={sheet} categories={categories} payments={payments} today={today} maxDaysBack={maxDaysBack} t={t} onClose={onClose} onSaved={onSaved} onHaptic={onHaptic} api={api} />;
}

const NOTE_NOISE = new Set(['via Telegram', 'via Mini App']);

function ExpenseBody({ sheet, categories, payments, today, maxDaysBack, t, onClose, onSaved, onHaptic, api }: SheetProps & { sheet: SheetState }) {
  const item = sheet.item;
  const editing = sheet.mode === 'edit';
  const activeCategories = categories.filter((c) => c.active || c.key === item?.category);
  const activePayments = payments.filter((p) => p.active || p.key === item?.payment);
  const [amount, setAmount] = useState(editing && item ? Number(item.amount).toFixed(2) : '');
  const [merchant, setMerchant] = useState(item?.merchant ?? '');
  const [categoryKey, setCategoryKey] = useState(item?.category ?? '');
  const [paymentKey, setPaymentKey] = useState(item?.payment ?? (payments.find((p) => p.active)?.key ?? ''));
  const [date, setDate] = useState(editing && item ? dayKey(item.created_at) : today);
  const [note, setNote] = useState(item?.note && !NOTE_NOISE.has(item.note) ? item.note : '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const validate = (): { field: string; message: string } | null => {
    const clean = amount.trim().replace(',', '.');
    if (!/^\d{1,7}(\.\d{1,2})?$/.test(clean) || Number(clean) < 0.01 || Number(clean) > 1000000) return { field: 'amount', message: t('v_amount') };
    if (!categories.some((c) => c.key === categoryKey)) return { field: 'category', message: t('v_category') };
    if (!payments.some((p) => p.key === paymentKey)) return { field: 'payment', message: t('v_payment') };
    if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today || date < minDate(today, maxDaysBack))) return { field: 'date', message: t('v_date') };
    return null;
  };

  const serverMessage = (failure: unknown): string => {
    if (!(failure instanceof MiniApiError)) return t('err_generic');
    if (failure.code === 'invalid') return ['amount', 'category', 'payment', 'date'].includes(failure.field) ? t(`v_${failure.field}` as MiniKey) : t('v_server');
    return failure.code === 'network' ? t('err_network') : failure.code === 'limit' ? t('err_limit') : t('err_generic');
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || !api.current) return;
    const problem = validate();
    if (problem) {
      setError(problem.message);
      onHaptic('error');
      return;
    }
    setError('');
    const clean = amount.trim().replace(',', '.');
    let payload: Record<string, string> = { amount: clean, merchant: merchant.trim(), category: categoryKey, payment: paymentKey, note: note.trim() };
    if (date) payload.date = date;
    if (editing && item) {
      // send only what changed, so an item whose category was later disabled can still be edited
      const diff: Record<string, string> = {};
      if (Number(payload.amount) !== Number(item.amount)) diff.amount = payload.amount as string;
      if (payload.merchant !== (item.merchant || '')) diff.merchant = payload.merchant as string;
      if (payload.category !== item.category) diff.category = payload.category as string;
      if (payload.payment !== item.payment) diff.payment = payload.payment as string;
      const oldNote = item.note && !NOTE_NOISE.has(item.note) ? item.note : '';
      if (payload.note !== oldNote) diff.note = payload.note as string;
      if (payload.date && payload.date !== dayKey(item.created_at)) diff.date = payload.date;
      if (!Object.keys(diff).length) return onClose();
      payload = diff;
    }
    setSaving(true);
    try {
      if (editing && item) await api.current.updateExpense(item.id, payload);
      else await api.current.addExpense(payload);
      await onSaved(t('saved_toast'));
    } catch (failure) {
      setSaving(false);
      setError(serverMessage(failure));
      onHaptic('error');
    }
  };

  const remove = async () => {
    if (!item || saving || !api.current) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      onHaptic('warning');
      return;
    }
    setSaving(true);
    try {
      await api.current.deleteExpense(item.id);
      await onSaved(t('deleted_toast'));
    } catch (failure) {
      setSaving(false);
      setConfirmDelete(false);
      setError(serverMessage(failure));
    }
  };

  return (
    <Sheet open onClose={onClose} title={t(editing ? 'edit_expense' : 'add_expense')}>
      <form onSubmit={(event) => void save(event)} noValidate className={styles.form}>
        <Field big label={t('amount')} inputMode="decimal" autoComplete="off" placeholder="0.00" maxLength={10} data-autofocus data-len={amountSize(amount)} value={amount} onChange={(event) => setAmount(event.target.value)} />
        <Field label={t('merchant')} maxLength={80} autoComplete="off" placeholder={t('merchant_placeholder')} value={merchant} onChange={(event) => setMerchant(event.target.value)} />
        <ChipGroup legend={t('category')} options={activeCategories.map((c) => ({ value: c.key, label: truncate(c.label, 14), glyph: emojiFor(c.key) }))} value={categoryKey} onChange={setCategoryKey} />
        <ChipGroup legend={t('payment')} options={activePayments.map((p) => ({ value: p.key, label: truncate(p.label, 16) }))} value={paymentKey} onChange={setPaymentKey} />
        <div className={styles.two}>
          <Field label={t('date')} type="date" min={minDate(today, maxDaysBack)} max={today} value={date} onChange={(event) => setDate(event.target.value)} />
          <Field label={t('note')} maxLength={200} autoComplete="off" value={note} onChange={(event) => setNote(event.target.value)} />
        </div>
        <p className={styles.formError} role="alert">
          {error}
        </p>
        <div className={styles.actions}>
          {editing ? (
            <Button variant="danger" disabled={saving} onClick={() => void remove()}>
              {confirmDelete ? t('delete_confirm') : t('delete')}
            </Button>
          ) : null}
          <Button type="submit" loading={saving}>
            {t('save')}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
