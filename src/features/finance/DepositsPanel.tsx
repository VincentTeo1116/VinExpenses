// PL-01, PL-03, PL-05: the fixed deposit calculator (works offline) and the person's saved deposits.
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { amountSize, Field, SelectField } from '@/components/Field';
import { Notice } from '@/components/Notice';
import { Sheet } from '@/components/Sheet';
import { useToast } from '@/components/Toast';
import { useI18n } from '@/lib/i18n';
import { formatDate, todayYmd } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { CountMoney } from '@/lib/motion';
import { useMoney } from '@/features/money/MoneyContext';
import { DataError } from '@/features/money/data';
import { useFinanceActions, useFinanceData } from './data';
import { calcFd, DEFAULT_FD_LEADS, fdAutoMaturity, fdChartSeries, fdInputFromRow, fdSchedule, fdStatus, LIMITS, readLeadDays, type DepositRow, type FdInput, type FdView, type FieldError } from './finance';
import { errorText } from './format';
import { GrowthChart } from './GrowthChart';
import styles from './finance.module.css';

interface Form {
  amount: string;
  rate: string;
  tenureValue: string;
  tenureUnit: string;
  startDate: string;
  maturityDate: string;
  payout: string;
  taxRate: string;
  dayBasis: string;
  name: string;
  bank: string;
  remindOn: boolean;
  remindDays: string;
}
const blank = (): Form => ({ amount: '', rate: '', tenureValue: '12', tenureUnit: 'months', startDate: todayYmd(), maturityDate: '', payout: 'maturity', taxRate: '', dayBasis: '365', name: '', bank: '', remindOn: true, remindDays: DEFAULT_FD_LEADS.join(', ') });
const asInput = (f: Form): FdInput => ({ amount: f.amount, rate: f.rate, tenureValue: f.tenureValue, tenureUnit: f.tenureUnit, startDate: f.startDate, maturityDate: f.maturityDate, payout: f.payout, taxRate: f.taxRate, dayBasis: f.dayBasis });

export function DepositsPanel() {
  const { t } = useI18n();
  const toast = useToast();
  const { data: money } = useMoney();
  const finance = useFinanceData();
  const actions = useFinanceActions();
  const today = todayYmd();

  const [form, setForm] = useState<Form>(blank);
  const [submitted, setSubmitted] = useState(false);
  const [editing, setEditing] = useState<DepositRow | null>(null);
  const [renewing, setRenewing] = useState<DepositRow | null>(null);
  const [removing, setRemoving] = useState<DepositRow | null>(null);
  const [view, setView] = useState<FdView>('monthly');
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const top = useRef<HTMLDivElement>(null);
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));

  const result = useMemo(() => calcFd(asInput(form), { today }), [form, today]);
  const schedule = useMemo(() => fdSchedule(result, view, page), [result, view, page]);
  const series = useMemo(() => fdChartSeries(result, 48), [result]);
  const auto = useMemo(() => {
    const n = Number(form.tenureValue);
    return fdAutoMaturity(form.startDate, n, (['days', 'months', 'years'].includes(form.tenureUnit) ? form.tenureUnit : 'months') as 'days' | 'months' | 'years');
  }, [form.startDate, form.tenureValue, form.tenureUnit]);

  // A mistake is shown once the person has typed in that field, or pressed Save (an empty untouched field is not "wrong" yet)
  const errors = result.ok ? {} : result.errors;
  const shown = (field: string, value: string): string | undefined => {
    const error: FieldError | undefined = errors[field];
    if (!error) return undefined;
    return submitted || value.trim() !== '' ? errorText(t, error) : undefined;
  };
  const lead = readLeadDays(form.remindDays, DEFAULT_FD_LEADS);
  const saveErrors = {
    name: form.name.trim() === '' ? t('fin.e.name') : form.name.trim().length > LIMITS.nameMax ? t('fin.e.nameLong') : undefined,
    days: form.remindOn && lead.error ? errorText(t, lead.error) : undefined,
  };

  const reset = () => {
    setForm(blank());
    setSubmitted(false);
    setEditing(null);
    setRenewing(null);
    setPage(0);
  };

  const load = (row: DepositRow, mode: 'edit' | 'renew') => {
    const next: Form = {
      amount: String(row.principal),
      rate: String(row.rate),
      tenureValue: String(row.tenure_value),
      tenureUnit: row.tenure_unit,
      startDate: mode === 'renew' ? row.maturity_date : row.start_date,
      maturityDate: '',
      payout: row.payout,
      taxRate: row.tax_rate && Number(row.tax_rate) > 0 ? String(row.tax_rate) : '',
      dayBasis: String(row.day_basis),
      name: mode === 'renew' ? `${row.name}` : row.name,
      bank: row.bank ?? '',
      remindOn: row.reminders_on,
      remindDays: (row.reminder_days?.length ? row.reminder_days : DEFAULT_FD_LEADS).join(', '),
    };
    if (mode === 'edit') {
      const autoDate = fdAutoMaturity(next.startDate, row.tenure_value, row.tenure_unit);
      next.maturityDate = autoDate === row.maturity_date ? '' : row.maturity_date;
    }
    setForm(next);
    setSubmitted(false);
    setEditing(mode === 'edit' ? row : null);
    setRenewing(mode === 'renew' ? row : null);
    top.current?.scrollIntoView({ block: 'start' });
  };

  const onSave = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (!result.ok || saveErrors.name || saveErrors.days) {
      toast.show('error', t('save.fixFirst'));
      return;
    }
    if (!navigator.onLine) {
      toast.show('error', t('save.offline'));
      return;
    }
    setBusy(true);
    try {
      const row = {
        id: editing?.id ?? crypto.randomUUID(),
        name: form.name.trim().slice(0, LIMITS.nameMax),
        bank: form.bank.trim().slice(0, LIMITS.nameMax) || null,
        principal: result.principal,
        rate: result.rate,
        start_date: result.startDate,
        tenure_value: result.tenureValue,
        tenure_unit: result.tenureUnit,
        maturity_date: result.maturityDate,
        payout: result.payout,
        tax_rate: result.taxRate,
        day_basis: result.dayBasis,
        reminders_on: form.remindOn,
        reminder_days: form.remindOn ? (lead.days as number[]) : (editing?.reminder_days ?? DEFAULT_FD_LEADS),
        status: editing?.status ?? ('open' as const),
        // changing the amount or dates after the interest was recorded must not allow a second recording
        interest_recorded: editing?.interest_recorded ?? false,
      };
      await actions.save('fixed_deposits', row as unknown as DepositRow);
      if (renewing) await actions.setStatus('fixed_deposits', renewing.id, 'closed');
      toast.show('success', renewing ? t('save.fdRenewed') : editing ? t('save.fdUpdated') : t('save.fdSaved'));
      reset();
    } catch (error) {
      toast.show('error', error instanceof DataError && error.offline ? t('save.offline') : t('save.failed'));
    } finally {
      setBusy(false);
    }
  };

  const run = async (job: () => Promise<void>, ok?: string) => {
    try {
      await job();
      if (ok) toast.show('success', ok);
    } catch (error) {
      toast.show('error', error instanceof DataError && error.offline ? t('save.offline') : t('save.failed'));
    }
  };

  const record = (row: DepositRow) =>
    run(async () => {
      const outcome = await actions.recordInterest(row);
      const calc = calcFd(fdInputFromRow(row));
      if (outcome === 'already') toast.show('info', t('fd.alreadyRecorded'));
      else if (outcome === 'recorded' && calc.ok) toast.show('success', t('fd.recorded', { amount: formatMoney(calc.netInterest), date: formatDate(row.maturity_date, money.dateFormat) }));
    });

  const confirmRemove = async () => {
    const row = removing;
    if (!row) return;
    setRemoving(null);
    await run(async () => {
      await actions.remove('fixed_deposits', row.id);
      if (editing?.id === row.id || renewing?.id === row.id) reset();
    }, t('item.deleted'));
  };

  const pager = schedule.pageCount > 1;
  const periodLabel = (row: (typeof schedule.rows)[number]) => (view === 'daily' ? `${t('view.daily')} ${row.n}` : view === 'yearly' ? `${t('view.yearly')} ${row.n}` : `${t('view.monthly')} ${row.n}`);

  return (
    <div className={styles.stack} ref={top}>
      <div className={styles.layout}>
        <section className={styles.card} aria-labelledby="fd-title">
          <h2 id="fd-title" className={styles.h2}>
            {t('fd.title')}
          </h2>
          <p className={styles.muted}>{t('fd.sub')}</p>
          <form className={styles.form} onSubmit={onSave} noValidate>
            <Field big showLabel label={t('fd.amount')} inputMode="decimal" autoComplete="off" placeholder="0.00" data-len={amountSize(form.amount)} value={form.amount} onChange={(e) => set('amount', e.target.value)} error={shown('amount', form.amount)} />
            <div className={styles.two}>
              <Field label={t('fd.rate')} inputMode="decimal" autoComplete="off" value={form.rate} onChange={(e) => set('rate', e.target.value)} error={shown('rate', form.rate)} />
              <Field label={t('fd.tax')} inputMode="decimal" autoComplete="off" value={form.taxRate} onChange={(e) => set('taxRate', e.target.value)} error={shown('taxRate', form.taxRate)} />
            </div>
            <div className={styles.two}>
              <Field label={t('fd.tenure')} inputMode="numeric" autoComplete="off" value={form.tenureValue} onChange={(e) => set('tenureValue', e.target.value)} error={shown('tenureValue', form.tenureValue)} />
              <SelectField label={t('fd.unit')} value={form.tenureUnit} onChange={(e) => set('tenureUnit', e.target.value)}>
                <option value="days">{t('fd.unit.days')}</option>
                <option value="months">{t('fd.unit.months')}</option>
                <option value="years">{t('fd.unit.years')}</option>
              </SelectField>
            </div>
            <div className={styles.two}>
              <Field label={t('fd.start')} type="date" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} error={shown('startDate', form.startDate)} />
              <SelectField label={t('fd.payout')} value={form.payout} onChange={(e) => set('payout', e.target.value)}>
                <option value="maturity">{t('fd.payout.maturity')}</option>
                <option value="monthly">{t('fd.payout.monthly')}</option>
                <option value="quarterly">{t('fd.payout.quarterly')}</option>
                <option value="yearly">{t('fd.payout.yearly')}</option>
              </SelectField>
            </div>
            <SelectField label={t('fd.dayBasis')} value={form.dayBasis} onChange={(e) => set('dayBasis', e.target.value)}>
              <option value="365">365</option>
              <option value="360">360</option>
            </SelectField>
            <Field label={t('fd.maturity')} type="date" value={form.maturityDate || auto} onChange={(e) => set('maturityDate', e.target.value === auto ? '' : e.target.value)} hint={t('fd.maturityHint')} error={shown('maturityDate', form.maturityDate)} />

            <div className={styles.card} role="group" aria-labelledby="fd-save-title">
              <h3 id="fd-save-title" className={styles.h3}>
                {t('save.title')}
              </h3>
              <p className={styles.muted}>{t('save.sub')}</p>
              {editing ? <p className={styles.editing}>{t('save.editing', { name: editing.name })}</p> : null}
              {renewing ? <p className={styles.editing}>{t('save.renewing', { name: renewing.name })}</p> : null}
              <div className={styles.two}>
                <Field label={t('save.name')} maxLength={80} value={form.name} onChange={(e) => set('name', e.target.value)} error={submitted ? saveErrors.name : undefined} />
                <Field label={t('save.bank')} maxLength={80} value={form.bank} onChange={(e) => set('bank', e.target.value)} />
              </div>
              <label className={styles.remind}>
                <input className="animated-switch" type="checkbox" role="switch" checked={form.remindOn} onChange={(e) => set('remindOn', e.target.checked)} />
                {t('save.remind')}
              </label>
              {form.remindOn ? <Field label={t('save.days')} autoComplete="off" value={form.remindDays} onChange={(e) => set('remindDays', e.target.value)} hint={t('save.daysHint')} error={saveErrors.days} /> : null}
              <div className={styles.actions}>
                <Button type="submit" loading={busy}>
                  {editing ? t('save.changes') : t('save.deposit')}
                </Button>
                {editing || renewing ? (
                  <Button variant="outline" onClick={reset}>
                    {t('save.cancelEdit')}
                  </Button>
                ) : null}
              </div>
            </div>
          </form>
        </section>

        <section className={styles.card} aria-labelledby="fd-res" aria-live="polite">
          <h2 id="fd-res" className={styles.h2}>
            {t('fd.res.title')}
          </h2>
          {result.ok ? (
            <div className={styles.result} data-testid="fd-result">
              <div className={styles.big}>
                <span>{t('fd.res.maturity')}</span>
                <strong data-testid="fd-maturity">
                  <CountMoney value={result.maturityAmount} />
                </strong>
              </div>
              <p className={styles.muted}>{t('fd.maturityNow', { date: formatDate(result.maturityDate, money.dateFormat), n: result.days })}</p>
              <div className={styles.facts}>
                <div className={styles.fact}>
                  <span>{t('fd.res.interest')}</span>
                  <strong data-testid="fd-interest">{formatMoney(result.grossInterest)}</strong>
                </div>
                <div className={styles.fact}>
                  <span>{t('fd.res.tax')}</span>
                  <strong>{formatMoney(result.tax)}</strong>
                </div>
                <div className={styles.fact}>
                  <span>{t('fd.res.net')}</span>
                  <strong data-testid="fd-net">{formatMoney(result.netInterest)}</strong>
                </div>
                <div className={styles.fact}>
                  <span>{t('fd.res.yield')}</span>
                  <strong>{result.effectiveYield.toFixed(2)}%</strong>
                </div>
              </div>
              <h3 className={styles.h3}>{t('fd.chart')}</h3>
              <GrowthChart points={series} label={t('fd.chartLabel', { from: formatDate(result.startDate, money.dateFormat), to: formatDate(result.maturityDate, money.dateFormat), amount: formatMoney(result.grossInterest) })} />
              {result.payout !== 'maturity' ? (
                <>
                  <h3 className={styles.h3}>{t('fd.payouts')}</h3>
                  <ul className={styles.list} aria-label={t('fd.payouts')}>
                    {result.payouts.slice(0, 12).map((p) => (
                      <li key={p.n}>
                        <span>{formatDate(p.date, money.dateFormat)}</span>
                        <strong>{formatMoney(p.net)}</strong>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              <p className={styles.muted}>{t('fin.estimate')}</p>
            </div>
          ) : (
            <p className={styles.muted}>{t('fd.sub')}</p>
          )}
        </section>
      </div>

      {result.ok ? (
        <section className={styles.card} aria-labelledby="fd-table">
          <h2 id="fd-table" className={styles.h2}>
            {t('fd.table')}
          </h2>
          <div className={styles.seg} role="group" aria-label={t('fd.view')}>
            {(['daily', 'monthly', 'yearly'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={view === value}
                onClick={() => {
                  setView(value);
                  setPage(0);
                }}
              >
                {t(`view.${value}`)}
              </button>
            ))}
          </div>
          {/* a table that scrolls sideways must be reachable by keyboard */}
          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
          <div className={styles.tableWrap} tabIndex={0} role="region" aria-label={t('fd.table')}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">{t('tbl.period')}</th>
                  <th scope="col">{t('tbl.date')}</th>
                  <th scope="col">{t('tbl.interest')}</th>
                  <th scope="col">{t('tbl.total')}</th>
                  <th scope="col">{t('tbl.paid')}</th>
                </tr>
              </thead>
              <tbody>
                {schedule.rows.map((row) => (
                  <tr key={row.n}>
                    <th scope="row">{periodLabel(row)}</th>
                    <td>{formatDate(row.to, money.dateFormat)}</td>
                    <td>{formatMoney(row.interest)}</td>
                    <td>{formatMoney(row.cumulative)}</td>
                    <td>{row.payout > 0 ? formatMoney(row.payout) : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pager ? (
            <div className={styles.pager}>
              <button type="button" disabled={schedule.page === 0} onClick={() => setPage(schedule.page - 1)}>
                {t('tbl.prev')}
              </button>
              <span className={styles.muted}>{t('tbl.page', { n: schedule.page + 1, m: schedule.pageCount })}</span>
              <button type="button" disabled={schedule.page >= schedule.pageCount - 1} onClick={() => setPage(schedule.page + 1)}>
                {t('tbl.next')}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className={styles.card} aria-labelledby="fd-saved">
        <h2 id="fd-saved" className={styles.h2}>
          {t('fd.saved')}
        </h2>
        {finance.failed ? <Notice kind="warn">{t('money.loadFailed')}</Notice> : null}
        {finance.deposits.length === 0 && !finance.loading ? (
          <EmptyState icon="info" title={t('fd.saved')}>
            {t('fd.savedEmpty')}
          </EmptyState>
        ) : (
          <ul className={styles.items} aria-label={t('fd.saved')}>
            {finance.deposits.map((row) => {
              const status = fdStatus(row, today);
              const calc = calcFd(fdInputFromRow(row), { today });
              const tone = status === 'matured' ? 'warn' : status === 'active' ? 'good' : undefined;
              const days = row.reminder_days?.length ? row.reminder_days : DEFAULT_FD_LEADS;
              return (
                <li key={row.id} className={styles.item} data-deposit={row.name}>
                  <div className={styles.itemHead}>
                    <span className={styles.itemName}>{row.name}</span>
                    <span className={styles.badge} data-tone={tone}>
                      {t(`fd.status.${status}`)}
                    </span>
                  </div>
                  <p className={styles.small}>
                    {row.bank ? `${row.bank} · ` : ''}
                    {formatMoney(Number(row.principal))} · {Number(row.rate)}% · {t('fd.maturesOn', { date: formatDate(row.maturity_date, money.dateFormat) })}
                  </p>
                  {calc.ok ? (
                    <>
                      <progress className={styles.bar} max={100} value={Math.round((calc.progress ?? 0) * 100)} aria-label={t('fd.progress', { percent: Math.round((calc.progress ?? 0) * 100), amount: formatMoney(calc.earnedSoFar ?? 0) })} />
                      <p className={styles.small}>
                        {t('fd.progress', { percent: Math.round((calc.progress ?? 0) * 100), amount: formatMoney(calc.earnedSoFar ?? 0) })}
                        {status === 'active' || status === 'upcoming' ? ` · ${t('fd.daysLeft', { n: Math.max(0, calc.daysLeft ?? 0) })}` : ''}
                      </p>
                      <p className={styles.small}>{t('fd.atMaturity', { amount: formatMoney(calc.maturityAmount) })}</p>
                    </>
                  ) : null}
                  <p className={styles.small}>{row.reminders_on === false || status === 'closed' ? t('fd.reminderOff') : t('fd.reminderOn', { days: days.map((d) => (d === 0 ? t('fd.onTheDay') : t('fd.dBefore', { n: d }))).join(', ') })}</p>
                  <div className={styles.itemActions}>
                    {status === 'matured' && !row.interest_recorded && calc.ok && calc.netInterest > 0 ? (
                      <button type="button" className={styles.good} onClick={() => void record(row)}>
                        {t('act.record')}
                      </button>
                    ) : null}
                    {status !== 'closed' ? (
                      <>
                        <button type="button" onClick={() => load(row, 'edit')} aria-label={t('act.openFor', { action: t('act.edit'), name: row.name })}>
                          {t('act.edit')}
                        </button>
                        {status === 'matured' ? (
                          <button type="button" onClick={() => load(row, 'renew')} aria-label={t('act.openFor', { action: t('act.renew'), name: row.name })}>
                            {t('act.renew')}
                          </button>
                        ) : null}
                        <button type="button" onClick={() => void run(() => actions.setStatus('fixed_deposits', row.id, 'closed'), t('item.closedToast'))} aria-label={t('act.openFor', { action: t('act.close'), name: row.name })}>
                          {t('act.close')}
                        </button>
                      </>
                    ) : (
                      <button type="button" onClick={() => void run(() => actions.setStatus('fixed_deposits', row.id, 'open'), t('item.reopenedToast'))} aria-label={t('act.openFor', { action: t('act.reopen'), name: row.name })}>
                        {t('act.reopen')}
                      </button>
                    )}
                    <button type="button" className={styles.danger} onClick={() => setRemoving(row)} aria-label={t('act.openFor', { action: t('act.delete'), name: row.name })}>
                      {t('act.delete')}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <Sheet open={removing !== null} onClose={() => setRemoving(null)} title={t('item.deleteTitle', { name: removing?.name ?? '' })}>
        <p>{t('item.deleteBody')}</p>
        <div className={styles.actions}>
          <Button variant="danger" onClick={() => void confirmRemove()}>
            {t('item.confirmDelete')}
          </Button>
          <Button variant="outline" onClick={() => setRemoving(null)}>
            {t('item.keep')}
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
