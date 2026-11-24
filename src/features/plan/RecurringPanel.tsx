// RC-01 … RC-04: bills, subscriptions and regular income. They post themselves; the summary counts income as plus and bills as minus.
import { useMemo, useState, type FormEvent } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/Button';
import { CatIcon } from '@/components/CatIcon';
import { ChipGroup } from '@/components/ChipGroup';
import { EmptyState } from '@/components/EmptyState';
import { Field, SelectField } from '@/components/Field';
import { Icon } from '@/components/Icon';
import { Notice } from '@/components/Notice';
import { Sheet } from '@/components/Sheet';
import { useToast } from '@/components/Toast';
import { useI18n, type MessageKey } from '@/lib/i18n';
import { formatDate, isYmd, todayYmd, type Frequency } from '@/lib/dates';
import { formatSigned, toCents } from '@/lib/money';
import { dueWording, recurringTotals } from '@/features/money/calc';
import { useMoney } from '@/features/money/MoneyContext';
import { INCOME_SOURCES } from '@/features/money/taxonomy';
import type { Kind, RecurringExpense, RecurringIncome } from '@/features/money/types';
import styles from './RecurringPanel.module.css';

const FREQUENCIES: Frequency[] = ['weekly', 'monthly', 'yearly'];
const AMOUNT = /^\d{1,9}(\.\d{1,2})?$/;

function schemaFor(t: (key: MessageKey) => string) {
  return z.object({
    name: z.string().trim().min(1, t('v.nameRequiredShort')).max(40, t('v.labelLong')),
    amount: z.string().trim().refine((v) => AMOUNT.test(v.replace(/,/g, '')) && toCents(v) > 0, t('v.amountInvalid')),
    category: z.string(),
    payment: z.string(),
    frequency: z.enum(['weekly', 'monthly', 'yearly']),
    date: z.string().refine(isYmd, t('v.dateInvalid')),
    endDate: z.string().refine((v) => v === '' || isYmd(v), t('v.dateInvalid')),
  });
}
type Values = z.infer<ReturnType<typeof schemaFor>>;
type Item = { kind: 'expense'; row: RecurringExpense } | { kind: 'income'; row: RecurringIncome };

export function RecurringPanel() {
  const { t } = useI18n();
  const { data } = useMoney();
  const [editing, setEditing] = useState<Item | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [adding, setAdding] = useState(false);
  const closeForm = () => {
    setEditing(null);
    setAdding(false);
    setFormKey((n) => n + 1);
  };
  const [removing, setRemoving] = useState<Item | null>(null);

  const totals = useMemo(() => recurringTotals(data.recurring, data.recurringIncomes), [data.recurring, data.recurringIncomes]);
  const items = useMemo<Item[]>(() => [...data.recurring.map((row) => ({ kind: 'expense' as const, row })), ...data.recurringIncomes.map((row) => ({ kind: 'income' as const, row }))].sort((a, b) => a.row.next_due.localeCompare(b.row.next_due)), [data.recurring, data.recurringIncomes]);

  return (
    <>
      <div className={styles.topRow}>
        <p className={styles.intro}>{t('rec.sub')}</p>
        <Button onClick={() => setAdding(true)}>
          <Icon name="plus" size={18} />
          {t('rec.new')}
        </Button>
      </div>
      <div className={styles.layout}>
        <div className={styles.side}>
          {items.length > 0 ? (
            <dl className={styles.totals} aria-label={t('rec.title')} data-testid="rec-totals">
              <div>
                <dt>{t('rec.totalMonth')}</dt>
                <dd data-testid="rec-net">{formatSigned(totals.netPerMonth / 100)}</dd>
              </div>
              <div>
                <dt>{t('rec.totalYear')}</dt>
                <dd data-testid="rec-net-year">{formatSigned(totals.netPerYear / 100)}</dd>
              </div>
            </dl>
          ) : null}
          {items.length === 0 ? (
            <EmptyState icon="plan" title={t('rec.title')}>
              {t('rec.empty')}
            </EmptyState>
          ) : (
            <ul className={styles.list} aria-label={t('rec.active', { n: totals.active })}>
              {items.map((item) => (
                <RecurringRow key={`${item.kind}-${item.row.id}`} item={item} onEdit={() => setEditing(item)} onDelete={() => setRemoving(item)} />
              ))}
            </ul>
          )}
        </div>
      </div>

      <Sheet open={adding || editing !== null} onClose={closeForm} title={editing ? t('rec.edit') : t('rec.new')}>
        <div className={styles.flat}>
          <RecurringForm key={`${formKey}-${editing?.row.id ?? 'new'}`} editing={editing} onDone={closeForm} />
        </div>
      </Sheet>
      <RemoveSheet item={removing} onClose={() => setRemoving(null)} />
    </>
  );
}

function RecurringRow({ item, onEdit, onDelete }: { item: Item; onEdit: () => void; onDelete: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const { data, actions, categoryOf } = useMoney();
  const [busy, setBusy] = useState(false);
  const row = item.row;
  const title = item.kind === 'expense' ? item.row.name : item.row.source;
  const finished = item.kind === 'expense' && item.row.end_date !== null && row.next_due > item.row.end_date;
  const today = todayYmd();
  const wording = dueWording(row.next_due, today);
  const due = wording.kind === 'today' ? t('due.today') : wording.kind === 'tomorrow' ? t('due.tomorrow') : t('due.inDays', { n: wording.days });
  const toggle = async () => {
    setBusy(true);
    try {
      await actions.toggleRecurring(item.kind, row);
      toast.show('success', row.active ? t('rec.paused') : t('rec.resumed'));
    } catch {
      toast.show('error', t('add.failed'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className={`${styles.item} ${row.active ? '' : styles.paused}`} data-kind={item.kind}>
      <div className={styles.itemMain}>
        <span className={styles.glyph}>
          {item.kind === 'expense' ? <CatIcon name={item.row.category} color={categoryOf(item.row.category).color} glyph={categoryOf(item.row.category).glyph} /> : <CatIcon name="income" color="#059669" />}
        </span>
        <div className={styles.itemText}>
          <p className={styles.itemTitle}>
            {title}
            {item.kind === 'expense' && item.row.loan_id ? <span className={styles.badge}>{t('rec.loan')}</span> : null}
          </p>
          <p className={styles.itemSub}>
            {t(`freq.${row.frequency}` as const)} · {finished ? t('rec.finished') : row.active ? `${t('rec.next', { date: formatDate(row.next_due, data.dateFormat) })} · ${due}` : t('rec.paused')}
            {item.kind === 'expense' && item.row.end_date ? ` · ${t('rec.ends', { date: formatDate(item.row.end_date, data.dateFormat) })}` : ''}
          </p>
        </div>
        <p className={`${styles.itemAmount} ${item.kind === 'income' ? styles.in : ''}`}>{formatSigned((item.kind === 'income' ? 1 : -1) * (toCents(row.amount) / 100))}</p>
      </div>
      <div className={styles.itemTools}>
        <button type="button" className={styles.iconBtn} disabled={busy || finished} onClick={() => void toggle()} aria-label={row.active ? t('rec.pause') : t('rec.resume')} title={row.active ? t('rec.pause') : t('rec.resume')}>
          <Icon name={row.active ? 'pause' : 'play'} size={18} />
        </button>
        <button type="button" className={styles.iconBtn} onClick={onEdit} aria-label={`${t('rec.edit')} ${title}`} title={t('rec.edit')}>
          <Icon name="edit" size={18} />
        </button>
        <button type="button" className={`${styles.iconBtn} ${styles.iconDanger}`} onClick={onDelete} aria-label={`${t('rec.delete')} ${title}`} title={t('rec.delete')}>
          <Icon name="trash" size={18} />
        </button>
      </div>
    </li>
  );
}

function RecurringForm({ editing, onDone }: { editing: Item | null; onDone: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const { actions, activeCategories, activePayments } = useMoney();
  const [kind, setKind] = useState<Kind>(editing?.kind ?? 'expense');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const schema = useMemo(() => schemaFor(t), [t]);
  const defaults: Values = useMemo(() => {
    const row = editing?.row;
    return {
      name: editing ? (editing.kind === 'expense' ? editing.row.name : editing.row.source) : '',
      amount: row ? String(toCents(row.amount) / 100) : '',
      category: editing?.kind === 'expense' ? editing.row.category : (activeCategories[0]?.key ?? ''),
      payment: editing?.kind === 'expense' ? editing.row.payment : (activePayments[0]?.key ?? ''),
      frequency: row?.frequency ?? 'monthly',
      date: row?.next_due ?? todayYmd(),
      endDate: editing?.kind === 'expense' ? (editing.row.end_date ?? '') : '',
    };
    // starting values are taken when the form is created (it is re-created for each item)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const { register, control, handleSubmit, formState, reset } = useForm<Values>({ resolver: zodResolver(schema), mode: 'onTouched', defaultValues: defaults });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    void handleSubmit(async (values) => {
      setProblem('');
      setBusy(true);
      try {
        const amount = (toCents(values.amount) / 100).toFixed(2);
        const id = editing?.row.id ?? null;
        const changedDate = !editing || editing.row.next_due !== values.date;
        if (kind === 'expense') {
          const fields: Record<string, unknown> = { name: values.name.trim(), amount, category: values.category, payment: values.payment, frequency: values.frequency, next_due: values.date, end_date: values.endDate || null };
          if (changedDate) fields.start_date = values.date; // a new date becomes the day of the month it repeats on
          await actions.saveRecurring('expense', id, fields);
        } else {
          const fields: Record<string, unknown> = { source: values.name.trim(), amount, frequency: values.frequency, next_due: values.date };
          if (changedDate) fields.start_date = values.date;
          await actions.saveRecurring('income', id, fields);
        }
        toast.show('success', t('rec.saved'));
        reset({ ...defaults, name: '', amount: '', endDate: '' });
        onDone();
        await actions.processRecurring(); // a date in the past is posted at once
      } catch {
        setProblem(t('add.failed'));
      } finally {
        setBusy(false);
      }
    })(event);
  };

  return (
    <section className={styles.card} aria-labelledby="rec-form">
      <h2 id="rec-form" className={styles.h2}>
        {editing ? t('rec.edit') : t('rec.new')}
      </h2>
      <form onSubmit={submit} noValidate className={styles.form}>
        {editing ? null : (
          <div className={styles.kind} role="group" aria-label={t('rec.kind')}>
            {(['expense', 'income'] as const).map((value) => (
              <button key={value} type="button" className={`${styles.kindBtn} ${kind === value ? styles.kindOn : ''}`} aria-pressed={kind === value} onClick={() => setKind(value)}>
                {t(value === 'expense' ? 'add.expense' : 'add.income')}
              </button>
            ))}
          </div>
        )}
        <Field label={kind === 'expense' ? t('rec.name') : t('add.source')} list={kind === 'income' ? 'rec-sources' : undefined} autoComplete="off" error={formState.errors.name?.message} {...register('name')} />
        {kind === 'income' ? (
          <datalist id="rec-sources">
            {INCOME_SOURCES.map((item) => (
              <option key={item.key} value={t(item.label)} />
            ))}
          </datalist>
        ) : null}
        <Field label={t('add.amount')} inputMode="decimal" autoComplete="off" placeholder="0.00" error={formState.errors.amount?.message} {...register('amount')} />
        {kind === 'expense' ? (
          <>
            <Controller name="category" control={control} render={({ field }) => <ChipGroup legend={t('add.category')} options={activeCategories.map((c) => ({ value: c.key, label: c.label, glyph: c.glyph, icon: c.key, color: c.color }))} value={field.value} onChange={field.onChange} />} />
            <Controller name="payment" control={control} render={({ field }) => <ChipGroup legend={t('add.payment')} options={activePayments.map((p) => ({ value: p.key, label: p.label, glyph: p.glyph, icon: p.key, color: p.color }))} value={field.value} onChange={field.onChange} />} />
          </>
        ) : null}
        <div className={styles.two}>
          <SelectField label={t('rec.frequency')} error={formState.errors.frequency?.message} {...register('frequency')}>
            {FREQUENCIES.map((value) => (
              <option key={value} value={value}>
                {t(`freq.${value}` as const)}
              </option>
            ))}
          </SelectField>
          <Field label={t('rec.date')} type="date" error={formState.errors.date?.message} {...register('date')} />
        </div>
        {kind === 'expense' ? <Field label={t('rec.endDate')} type="date" error={formState.errors.endDate?.message} {...register('endDate')} /> : null}
        {problem ? <Notice kind="bad">{problem}</Notice> : null}
        <div className={styles.actions}>
          <Button type="submit" loading={busy}>
            {t('rec.save')}
          </Button>
          {editing ? (
            <Button variant="outline" onClick={onDone}>
              {t('rec.cancelEdit')}
            </Button>
          ) : null}
        </div>
      </form>
    </section>
  );
}

function RemoveSheet({ item, onClose }: { item: Item | null; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const { actions } = useMoney();
  const [busy, setBusy] = useState(false);
  if (!item) return null;
  const name = item.kind === 'expense' ? item.row.name : item.row.source;
  const confirm = async () => {
    setBusy(true);
    try {
      await actions.deleteRecurring(item.kind, item.row.id);
      toast.show('success', t('rec.deleted'));
      onClose();
    } catch {
      toast.show('error', t('add.failed'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open onClose={onClose} title={t('rec.deleteTitle')}>
      <div className={styles.form}>
        <p className={styles.muted}>{t('rec.deleteBody', { name })}</p>
        <Button variant="danger" block loading={busy} onClick={() => void confirm()}>
          {t('rec.delete')}
        </Button>
        <Button variant="outline" block onClick={onClose}>
          {t('common.cancel')}
        </Button>
      </div>
    </Sheet>
  );
}
