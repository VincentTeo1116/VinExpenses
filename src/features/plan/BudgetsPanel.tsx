// BU-01: a monthly limit overall and per category, with progress for this month (amber from 80%, red when over).
import { useMemo, useState, type FormEvent } from 'react';
import { Button } from '@/components/Button';
import { CatIcon } from '@/components/CatIcon';
import { Icon } from '@/components/Icon';
import { Notice } from '@/components/Notice';
import { useToast } from '@/components/Toast';
import { useI18n } from '@/lib/i18n';
import { monthKey, todayYmd } from '@/lib/dates';
import { formatMoney, toCents } from '@/lib/money';
import { budgetFor, budgetStatus, inMonth, sumCents } from '@/features/money/calc';
import { useMoney } from '@/features/money/MoneyContext';
import styles from './BudgetsPanel.module.css';

const AMOUNT = /^\d{1,9}(\.\d{1,2})?$/;

export function BudgetsPanel() {
  const { t } = useI18n();
  const toast = useToast();
  const { data, actions, categories } = useMoney();
  const month = monthKey(todayYmd());
  const rows = useMemo(() => [{ key: 'all', label: t('bud.overall'), glyph: '', color: '' }, ...categories.filter((item) => item.active || budgetFor(data.budgets, item.key) > 0).map((item) => ({ key: item.key, label: item.label, glyph: item.glyph, color: item.color }))], [categories, data.budgets, t]);
  const thisMonth = useMemo(() => inMonth(data.expenses, month), [data.expenses, month]);

  const initial = useMemo(() => Object.fromEntries(rows.map((row) => [row.key, budgetFor(data.budgets, row.key) > 0 ? String(budgetFor(data.budgets, row.key) / 100) : ''])), [rows, data.budgets]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const valueOf = (key: string) => edits[key] ?? initial[key] ?? '';

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setProblem('');
    const found: Record<string, string> = {};
    const limits: Record<string, number> = {};
    for (const row of rows) {
      const text = valueOf(row.key).trim().replace(/,/g, '');
      if (text === '') {
        limits[row.key] = 0;
      } else if (!AMOUNT.test(text) || toCents(text) <= 0) {
        found[row.key] = t('v.amountInvalid');
      } else {
        limits[row.key] = toCents(text);
      }
    }
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      await actions.saveBudgets(limits);
      setEdits({});
      toast.show('success', t('bud.saved'));
    } catch {
      setProblem(t('add.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.card} aria-labelledby="bud-title">
      <h2 id="bud-title" className={styles.h2}>
        {t('bud.title')} · {t('bud.thisMonth')}
      </h2>
      <p className={styles.muted}>{t('bud.sub')}</p>
      <form onSubmit={(event) => void save(event)} noValidate className={styles.form}>
        <ul className={styles.list}>
          {rows.map((row) => {
            const spent = row.key === 'all' ? sumCents(thisMonth) : sumCents(thisMonth.filter((expense) => expense.category === row.key));
            const limit = toCents(valueOf(row.key).replace(/,/g, '') || '0') || budgetFor(data.budgets, row.key);
            const saved = budgetFor(data.budgets, row.key);
            const status = saved > 0 ? budgetStatus(saved, spent) : null;
            const id = `bud-${row.key}`;
            return (
              <li key={row.key} className={styles.row} data-budget={row.key}>
                <div className={styles.head}>
                  {/* the same drawn icons as the Add pop-up's category chips, never an emoji */}
                  {row.key === 'all' ? (
                    <span className={styles.glyph} aria-hidden="true">
                      <Icon name="target" size={22} />
                    </span>
                  ) : (
                    <CatIcon name={row.key} color={row.color} glyph={row.glyph} size={36} />
                  )}
                  <label htmlFor={id} className={styles.label}>
                    {row.label}
                  </label>
                  <input id={id} className={`${styles.input} ${errors[row.key] ? styles.bad : ''}`} inputMode="decimal" placeholder={t('bud.limit')} autoComplete="off" aria-invalid={errors[row.key] ? true : undefined} aria-describedby={`${id}-info`} value={valueOf(row.key)} onChange={(event) => setEdits((current) => ({ ...current, [row.key]: event.target.value }))} />
                </div>
                <div id={`${id}-info`} className={styles.info}>
                  {errors[row.key] ? <p className={styles.error}>{errors[row.key]}</p> : null}
                  {status ? (
                    <>
                      <progress className={`${styles.bar} ${styles[status.level]}`} max={100} value={Math.min(100, Math.round(status.percent))} aria-label={`${row.label}: ${Math.round(status.percent)}%`} />
                      <p className={styles.sub}>
                        {t('bud.spent', { amount: formatMoney(spent / 100) })} · {status.left >= 0 ? t('bud.left', { amount: formatMoney(status.left / 100) }) : <strong className={styles.overText}>{t('bud.over', { amount: formatMoney(-status.left / 100) })}</strong>}
                      </p>
                    </>
                  ) : (
                    <p className={styles.sub}>{limit > 0 ? '' : t('bud.spent', { amount: formatMoney(spent / 100) })}</p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {problem ? <Notice kind="bad">{problem}</Notice> : null}
        <Button type="submit" loading={busy}>
          {t('bud.save')}
        </Button>
      </form>
    </section>
  );
}
