// PL-02, PL-03, PL-05: the loan calculator (works offline) and the person's saved loans.
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { Field, SelectField } from '@/components/Field';
import { Notice } from '@/components/Notice';
import { Sheet } from '@/components/Sheet';
import { useToast } from '@/components/Toast';
import { useI18n } from '@/lib/i18n';
import { formatDate, todayYmd } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { useMoney } from '@/features/money/MoneyContext';
import { DataError } from '@/features/money/data';
import { useFinanceActions, useFinanceData } from './data';
import { calcLoan, DEFAULT_LOAN_LEADS, lastDueBefore, LIMITS, loanProgress, loanSchedule, readLeadDays, type FieldError, type LoanInput, type LoanSaved } from './finance';
import { errorText } from './format';
import styles from './finance.module.css';

interface Form {
  amount: string;
  rate: string;
  termValue: string;
  termUnit: string;
  method: string;
  firstPaymentDate: string;
  fees: string;
  name: string;
  lender: string;
  remindOn: boolean;
  remindDays: string;
}
const nextMonth = (): string => {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const blank = (): Form => ({ amount: '', rate: '', termValue: '5', termUnit: 'years', method: 'reducing', firstPaymentDate: nextMonth(), fees: '', name: '', lender: '', remindOn: true, remindDays: DEFAULT_LOAN_LEADS.join(', ') });
const asInput = (f: Form): LoanInput => ({ amount: f.amount, rate: f.rate, termValue: f.termValue, termUnit: f.termUnit, method: f.method, firstPaymentDate: f.firstPaymentDate, fees: f.fees });

export function LoansPanel() {
  const { t } = useI18n();
  const toast = useToast();
  const { data: money } = useMoney();
  const finance = useFinanceData();
  const actions = useFinanceActions();
  const today = todayYmd();

  const [form, setForm] = useState<Form>(blank);
  const [submitted, setSubmitted] = useState(false);
  const [editing, setEditing] = useState<LoanSaved | null>(null);
  const [removing, setRemoving] = useState<LoanSaved | null>(null);
  const [view, setView] = useState<'monthly' | 'yearly'>('monthly');
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const top = useRef<HTMLDivElement>(null);
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));

  const result = useMemo(() => calcLoan(asInput(form)), [form]);
  const schedule = useMemo(() => loanSchedule(result, view, page), [result, view, page]);

  const errors = result.ok ? {} : result.errors;
  const shown = (field: string, value: string): string | undefined => {
    const error: FieldError | undefined = errors[field];
    if (!error) return undefined;
    return submitted || value.trim() !== '' ? errorText(t, error) : undefined;
  };
  const lead = readLeadDays(form.remindDays, DEFAULT_LOAN_LEADS);
  const saveErrors = {
    name: form.name.trim() === '' ? t('fin.e.name') : form.name.trim().length > LIMITS.nameMax ? t('fin.e.nameLong') : undefined,
    days: form.remindOn && lead.error ? errorText(t, lead.error) : undefined,
  };

  // "This loan against all loans": the monthly cost of every other loan still being repaid
  const others = useMemo(
    () =>
      finance.loans
        .filter((row) => row.id !== editing?.id)
        .reduce((sum, row) => {
          const progress = loanProgress(row, today);
          return progress.ok && (progress.status === 'active' || progress.status === 'upcoming') ? sum + progress.result.instalment : sum;
        }, 0),
    [finance.loans, editing, today],
  );

  const reset = () => {
    setForm(blank());
    setSubmitted(false);
    setEditing(null);
    setPage(0);
  };
  const load = (row: LoanSaved) => {
    setForm({
      amount: String(row.principal),
      rate: String(row.rate),
      termValue: String(row.term_months),
      termUnit: 'months',
      method: row.method,
      firstPaymentDate: row.first_payment_date,
      fees: row.fees && Number(row.fees) > 0 ? String(row.fees) : '',
      name: row.name,
      lender: row.lender ?? '',
      remindOn: row.reminders_on,
      remindDays: (row.reminder_days?.length ? row.reminder_days : DEFAULT_LOAN_LEADS).join(', '),
    });
    setSubmitted(false);
    setEditing(row);
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
      const row: LoanSaved & { instalment: number } = {
        id: editing?.id ?? crypto.randomUUID(),
        name: form.name.trim().slice(0, LIMITS.nameMax),
        lender: form.lender.trim().slice(0, LIMITS.nameMax) || null,
        principal: result.principal,
        rate: result.rate,
        method: result.method,
        term_months: result.months,
        first_payment_date: result.firstPaymentDate,
        fees: result.fees,
        instalment: result.instalment,
        reminders_on: form.remindOn,
        reminder_days: form.remindOn ? (lead.days as number[]) : (editing?.reminder_days ?? DEFAULT_LOAN_LEADS),
        status: editing?.status ?? 'open',
        paid_through: editing?.paid_through ?? null,
      };
      // A loan that began before today: earlier payments count as already paid, so it does not open as "overdue"
      if (!editing) row.paid_through = lastDueBefore(row, today) || null;
      await actions.save('loans', row);
      toast.show('success', editing ? t('save.loanUpdated') : row.paid_through ? t('save.loanSavedPast') : t('save.loanSaved'));
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
  const confirmRemove = async () => {
    const row = removing;
    if (!row) return;
    setRemoving(null);
    await run(async () => {
      await actions.remove('loans', row.id);
      if (editing?.id === row.id) reset();
    }, t('item.deleted'));
  };

  const methodWord = (method: string) => (method === 'flat' ? t('ln.flat') : t('ln.reducing'));

  return (
    <div className={styles.stack} ref={top}>
      <div className={styles.layout}>
        <section className={styles.card} aria-labelledby="ln-title">
          <h2 id="ln-title" className={styles.h2}>
            {t('ln.title')}
          </h2>
          <p className={styles.muted}>{t('ln.sub')}</p>
          <form className={styles.form} onSubmit={onSave} noValidate>
            <div className={styles.two}>
              <Field label={t('ln.amount')} inputMode="decimal" autoComplete="off" value={form.amount} onChange={(e) => set('amount', e.target.value)} error={shown('amount', form.amount)} />
              <Field label={t('ln.rate')} inputMode="decimal" autoComplete="off" value={form.rate} onChange={(e) => set('rate', e.target.value)} error={shown('rate', form.rate)} />
            </div>
            <div className={styles.two}>
              <Field label={t('ln.term')} inputMode="numeric" autoComplete="off" value={form.termValue} onChange={(e) => set('termValue', e.target.value)} error={shown('termValue', form.termValue)} />
              <SelectField label={t('ln.termUnit')} value={form.termUnit} onChange={(e) => set('termUnit', e.target.value)}>
                <option value="years">{t('fd.unit.years')}</option>
                <option value="months">{t('fd.unit.months')}</option>
              </SelectField>
            </div>
            <div className={styles.two}>
              <SelectField label={t('ln.method')} value={form.method} onChange={(e) => set('method', e.target.value)}>
                <option value="reducing">{t('ln.reducing')}</option>
                <option value="flat">{t('ln.flat')}</option>
              </SelectField>
              <Field label={t('ln.first')} type="date" value={form.firstPaymentDate} onChange={(e) => set('firstPaymentDate', e.target.value)} error={shown('firstPaymentDate', form.firstPaymentDate)} />
            </div>
            <Field label={t('ln.fees')} inputMode="decimal" autoComplete="off" value={form.fees} onChange={(e) => set('fees', e.target.value)} error={shown('fees', form.fees)} />

            <div className={styles.card} role="group" aria-labelledby="ln-save-title">
              <h3 id="ln-save-title" className={styles.h3}>
                {t('save.title')}
              </h3>
              <p className={styles.muted}>{t('save.sub')}</p>
              {editing ? <p className={styles.editing}>{t('save.editing', { name: editing.name })}</p> : null}
              <div className={styles.two}>
                <Field label={t('save.name')} maxLength={80} value={form.name} onChange={(e) => set('name', e.target.value)} error={submitted ? saveErrors.name : undefined} />
                <Field label={t('save.lender')} maxLength={80} value={form.lender} onChange={(e) => set('lender', e.target.value)} />
              </div>
              <label className={styles.remind}>
                <input type="checkbox" checked={form.remindOn} onChange={(e) => set('remindOn', e.target.checked)} />
                {t('save.remind')}
              </label>
              {form.remindOn ? <Field label={t('save.days')} autoComplete="off" value={form.remindDays} onChange={(e) => set('remindDays', e.target.value)} hint={t('save.daysHint')} error={saveErrors.days} /> : null}
              <div className={styles.actions}>
                <Button type="submit" loading={busy}>
                  {editing ? t('save.changes') : t('save.loan')}
                </Button>
                {editing ? (
                  <Button variant="outline" onClick={reset}>
                    {t('save.cancelEdit')}
                  </Button>
                ) : null}
              </div>
            </div>
          </form>
        </section>

        <section className={styles.card} aria-labelledby="ln-res" aria-live="polite">
          <h2 id="ln-res" className={styles.h2}>
            {t('fd.res.title')}
          </h2>
          {result.ok ? (
            <div className={styles.result} data-testid="ln-result">
              <div className={styles.big}>
                <span>{t('ln.res.instalment')}</span>
                <strong data-testid="ln-instalment">{formatMoney(result.instalment)}</strong>
              </div>
              <p className={styles.muted}>{result.lastInstalment !== result.instalment ? t('ln.res.last', { amount: formatMoney(result.lastInstalment) }) : formatDate(result.lastPaymentDate, money.dateFormat)}</p>
              <div className={styles.facts}>
                <div className={styles.fact}>
                  <span>{t('ln.res.interest')}</span>
                  <strong data-testid="ln-interest">{formatMoney(result.totalInterest)}</strong>
                </div>
                <div className={styles.fact}>
                  <span>{t('ln.res.repaid')}</span>
                  <strong>{formatMoney(result.totalPayments)}</strong>
                </div>
                <div className={styles.fact}>
                  <span>{t('ln.res.cost')}</span>
                  <strong>{formatMoney(result.totalCost)}</strong>
                </div>
                <div className={styles.fact}>
                  <span>{t('ln.res.real')}</span>
                  <strong data-testid="ln-real">{result.effectiveRate.toFixed(2)}%</strong>
                </div>
                <div className={styles.fact}>
                  <span>{t('ln.res.perDay')}</span>
                  <strong>{formatMoney(result.costPerDay)}</strong>
                </div>
                <div className={styles.fact}>
                  <span>{t('ln.res.perYear')}</span>
                  <strong>{formatMoney(result.costPerYear)}</strong>
                </div>
              </div>
              {result.method === 'flat' ? <p className={styles.muted}>{t('ln.res.realNote')}</p> : null}
              <h3 className={styles.h3}>{t('ln.all')}</h3>
              <p className={styles.muted} data-testid="ln-all">
                {others > 0 ? t('ln.allThis', { amount: formatMoney(others + result.instalment) }) : t('ln.allOnly')}
              </p>
              <p className={styles.muted}>{t('fin.estimate')}</p>
            </div>
          ) : (
            <p className={styles.muted}>{t('ln.sub')}</p>
          )}
        </section>
      </div>

      {result.ok ? (
        <section className={styles.card} aria-labelledby="ln-table">
          <h2 id="ln-table" className={styles.h2}>
            {t('ln.schedule')}
          </h2>
          <div className={styles.seg} role="group" aria-label={t('fd.view')}>
            {(['monthly', 'yearly'] as const).map((value) => (
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
          <div className={styles.tableWrap} tabIndex={0} role="region" aria-label={t('ln.schedule')}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">{t('tbl.no')}</th>
                  <th scope="col">{t('tbl.date')}</th>
                  <th scope="col">{t('tbl.payment')}</th>
                  <th scope="col">{t('tbl.principal')}</th>
                  <th scope="col">{t('tbl.interest')}</th>
                  <th scope="col">{t('tbl.balance')}</th>
                </tr>
              </thead>
              <tbody>
                {schedule.view === 'monthly'
                  ? schedule.rows.map((row) => (
                      <tr key={row.n}>
                        <th scope="row">{row.n}</th>
                        <td>{formatDate(row.date, money.dateFormat)}</td>
                        <td>{formatMoney(row.payment)}</td>
                        <td>{formatMoney(row.principal)}</td>
                        <td>{formatMoney(row.interest)}</td>
                        <td>{formatMoney(row.balance)}</td>
                      </tr>
                    ))
                  : schedule.rows.map((row) => (
                      <tr key={row.n}>
                        <th scope="row">{`${t('view.yearly')} ${row.n}`}</th>
                        <td>{formatDate(row.to, money.dateFormat)}</td>
                        <td>{formatMoney(row.payment)}</td>
                        <td>{formatMoney(row.principal)}</td>
                        <td>{formatMoney(row.interest)}</td>
                        <td>{formatMoney(row.balance)}</td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
          {schedule.pageCount > 1 ? (
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

      <section className={styles.card} aria-labelledby="ln-saved">
        <h2 id="ln-saved" className={styles.h2}>
          {t('ln.saved')}
        </h2>
        {finance.failed ? <Notice kind="warn">{t('money.loadFailed')}</Notice> : null}
        {finance.loans.length === 0 && !finance.loading ? (
          <EmptyState icon="info" title={t('ln.saved')}>
            {t('ln.savedEmpty')}
          </EmptyState>
        ) : (
          <ul className={styles.items} aria-label={t('ln.saved')}>
            {finance.loans.map((row) => {
              const progress = loanProgress(row, today);
              if (!progress.ok) return null;
              const dates = progress.result.schedule.map((r) => r.date);
              const tone = progress.status === 'finished' ? 'good' : progress.overdue.length ? 'bad' : progress.status === 'active' ? 'warn' : undefined;
              const percent = Math.round((progress.paidCount / Math.max(1, progress.total)) * 100);
              const days = row.reminder_days?.length ? row.reminder_days : DEFAULT_LOAN_LEADS;
              return (
                <li key={row.id} className={styles.item} data-loan={row.name}>
                  <div className={styles.itemHead}>
                    <span className={styles.itemName}>{row.name}</span>
                    <span className={styles.badge} data-tone={tone}>
                      {t(`ln.status.${progress.status}`)}
                    </span>
                  </div>
                  <p className={styles.small}>
                    {row.lender ? `${row.lender} · ` : ''}
                    {t('ln.instalmentOf', { amount: formatMoney(progress.result.instalment), rate: Number(row.rate), method: methodWord(row.method) })}
                  </p>
                  <progress className={styles.bar} max={100} value={percent} aria-label={t('ln.paidOf', { paid: progress.paidCount, total: progress.total })} />
                  <p className={styles.small}>
                    {t('ln.paidOf', { paid: progress.paidCount, total: progress.total })} · {t('ln.balanceLeft', { amount: formatMoney(progress.balance) })}
                  </p>
                  {progress.overdue.length > 0 ? <p className={styles.bad}>{t('ln.overdue', { n: progress.overdue.length, date: formatDate(progress.overdue[0] as string, money.dateFormat) })}</p> : null}
                  {progress.nextDue && progress.status !== 'closed' ? <p className={styles.small}>{t('ln.nextDue', { date: formatDate(progress.nextDue, money.dateFormat), amount: formatMoney(progress.nextAmount) })}</p> : null}
                  <p className={styles.small}>{row.reminders_on === false || progress.status === 'closed' ? t('fd.reminderOff') : t('fd.reminderOn', { days: days.map((d) => (d === 0 ? t('fd.onTheDay') : t('fd.dBefore', { n: d }))).join(', ') })}</p>
                  <div className={styles.itemActions}>
                    {progress.status !== 'closed' && progress.status !== 'finished' && progress.firstUnpaid ? (
                      <button type="button" onClick={() => void run(() => actions.markPaidThrough(row.id, progress.firstUnpaid), t('ln.paidToast'))} aria-label={t('act.openFor', { action: t('act.markNext'), name: row.name })}>
                        {t('act.markNext')}
                      </button>
                    ) : null}
                    {progress.paidCount > 0 && progress.status !== 'closed' ? (
                      <button type="button" onClick={() => void run(() => actions.markPaidThrough(row.id, progress.paidCount > 1 ? (dates[progress.paidCount - 2] as string) : null))} aria-label={t('act.openFor', { action: t('act.undoPaid'), name: row.name })}>
                        {t('act.undoPaid')}
                      </button>
                    ) : null}
                    {progress.status !== 'closed' ? (
                      <>
                        <button type="button" onClick={() => load(row)} aria-label={t('act.openFor', { action: t('act.edit'), name: row.name })}>
                          {t('act.edit')}
                        </button>
                        <button type="button" onClick={() => void run(() => actions.setStatus('loans', row.id, 'closed'), t('item.closedToast'))} aria-label={t('act.openFor', { action: t('act.close'), name: row.name })}>
                          {t('act.close')}
                        </button>
                      </>
                    ) : (
                      <button type="button" onClick={() => void run(() => actions.setStatus('loans', row.id, 'open'), t('item.reopenedToast'))} aria-label={t('act.openFor', { action: t('act.reopen'), name: row.name })}>
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
