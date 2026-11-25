// TX-01 … TX-05: one sheet to add or change an expense or an income: amount first, then what it was for, then when.
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/Button';
import { ChipGroup } from '@/components/ChipGroup';
import { amountSize, Field } from '@/components/Field';
import { Icon } from '@/components/Icon';
import { Notice } from '@/components/Notice';
import { Sheet, type SheetHandle } from '@/components/Sheet';
import { prefersReducedMotion } from '@/lib/motion';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/app/AuthProvider';
import { envResult } from '@/lib/env';
import { useI18n, type MessageKey } from '@/lib/i18n';
import { buildMerchantMemory, suggestCategory } from '@/features/entry/smartEntry';
import { scanReceipt, ScanError } from '@/features/receipts/scan';
import { NearbyLocate, NearbyResults, useNearby } from './NearbyPicker';
import type { Candidate } from '@/features/receipts/receiptParser';
import { formatDate, isoToYmd, isYmd, todayYmd, ymdToNoonIso } from '@/lib/dates';
import { formatMoney, toCents } from '@/lib/money';
import { budgetFor, crossedLimit, findDuplicate, inMonth, sumCents } from './calc';
import { INCOME_SOURCES } from './taxonomy';
import { useMoney, type AddRequest } from './MoneyContext';
import type { Expense, Income, Kind } from './types';
import styles from './AddSheet.module.css';

const AMOUNT = /^\d{1,9}(\.\d{1,2})?$/;

function buildSchema(t: (key: MessageKey) => string) {
  return z.object({
    amount: z
      .string()
      .trim()
      .refine((v) => AMOUNT.test(v.replace(/,/g, '')) && toCents(v) > 0, t('v.amountInvalid')),
    category: z.string(),
    payment: z.string(),
    source: z.string(),
    date: z.string().refine(isYmd, t('v.dateInvalid')),
    merchant: z.string().trim().max(80, t('v.nameInvalid')),
    note: z.string().trim().max(200, t('v.noteLong')),
  });
}
type Values = z.infer<ReturnType<typeof buildSchema>>;

export function AddSheet({ request, onClose }: { request: AddRequest | null; onClose: () => void }) {
  return request ? <AddBody request={request} onClose={onClose} /> : null;
}

function AddBody({ request, onClose }: { request: AddRequest; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const { data, actions, activeCategories, activePayments, categoryOf, paymentOf, openAdd } = useMoney();
  const editing = request.edit;
  const source = request.edit ?? request.copy;
  const [kind, setKind] = useState<Kind>(source?.kind ?? request.kind ?? 'expense');
  const sheetRef = useRef<SheetHandle>(null);
  const closeSheet = () => sheetRef.current?.close();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [repeat, setRepeat] = useState<Expense | null>(null);
  const confirmed = useRef(false);
  const [categoryTouched, setCategoryTouched] = useState(false); // the person picked a category themselves: never override it
  const { session } = useAuth();
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState<{ text: string; bad: boolean } | null>(null);
  const [candidates, setCandidates] = useState<{ list: Candidate[]; unsure: boolean }>({ list: [], unsure: false });
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const [chooser, setChooser] = useState(false);
  // Phones and tablets get the Take a photo / Choose a file choice; a computer goes straight to the file picker.
  const hasCamera = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  const categoryBox = useRef<HTMLDivElement>(null);
  const [scanInfo, setScanInfo] = useState(false);

  const first = (rows: { key: string }[]) => rows[0]?.key ?? '';
  const initial = useMemo<Values>(() => {
    const row = source?.row;
    const expense = row && source?.kind === 'expense' ? (row as Expense) : null;
    const income = row && source?.kind === 'income' ? (row as Income) : null;
    const copying = Boolean(request.copy);
    return {
      amount: row ? toCents(row.amount) / 100 + '' : '',
      category: expense?.category ?? '', // a new expense starts with no category: the person (or the place they type) chooses it
      payment: expense?.payment ?? first(activePayments),
      source: income?.source ?? 'Salary',
      date: row && !copying ? isoToYmd(row.created_at) : todayYmd(),
      merchant: expense?.merchant ?? '',
      note: expense?.note ?? '',
    };
    // the starting values are taken once, when the sheet opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const schema = useMemo(() => buildSchema(t), [t]);
  const { register, control, handleSubmit, formState, setValue, setError, clearErrors } = useForm<Values>({ resolver: zodResolver(schema), mode: 'onTouched', defaultValues: initial });
  const amountText = useWatch({ control, name: 'amount' });
  const merchantText = useWatch({ control, name: 'merchant' });
  const categoryValue = useWatch({ control, name: 'category' });
  // a category chosen any way (a tap, a typed or nearby place, a scanned receipt) answers the "choose a category" message
  useEffect(() => {
    if (categoryValue) clearErrors('category');
  }, [categoryValue, clearErrors]);

  // TX-02: a category suggestion with its reason, from the person's own history first, then the built-in merchant lists
  const memory = useMemo(() => buildMerchantMemory(data.expenses), [data.expenses]);
  const lite = useMemo(() => activeCategories.map((c) => ({ key: c.key, label: c.label, active: true, is_builtin: c.builtin })), [activeCategories]);
  const suggestion = useMemo(() => (kind === 'expense' && merchantText.trim().length >= 2 ? suggestCategory({ merchant: merchantText, memory, categories: lite }) : null), [kind, merchantText, memory, lite]);
  /** A place chosen from the nearby list fills the merchant and suggests a category, like typing it would. */
  const onNearby = (name: string) => {
    setValue('merchant', name, { shouldDirty: true, shouldValidate: true });
    if (editing || categoryTouched) return;
    const found = suggestCategory({ merchant: name, memory, categories: lite });
    if (found && found.confidence !== 'low') setValue('category', found.key);
  };
  const nearby = useNearby(onNearby);
  const onMerchantChange =(event: ChangeEvent<HTMLInputElement>) => {
    if (editing || categoryTouched) return;
    const found = suggestCategory({ merchant: event.target.value, memory, categories: lite });
    if (found && found.confidence !== 'low') setValue('category', found.key);
  };

  /** Reads the chosen receipt and fills the form, leaving a category the person already chose alone. */
  const onReceipt = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !envResult.ok) return;
    setScanning(true);
    setCandidates({ list: [], unsure: false });
    const steps = { pdf: 'scan.step.pdf', scan: 'scan.step.scan', image: 'scan.step.image', text: 'scan.step.text' } as const;
    setScanNote({ text: t('scan.reading'), bad: false });
    try {
      const parsed = await scanReceipt(file, { baseUrl: envResult.env.supabaseUrl, anonKey: envResult.env.supabaseAnonKey, accessToken: session?.access_token }, (step) => setScanNote({ text: t(steps[step]), bad: false }));
      const found: string[] = [];
      if (parsed.amount > 0) {
        setValue('amount', parsed.amount.toFixed(2), { shouldValidate: true });
        found.push(t('scan.found.amount'));
      }
      if (parsed.merchant) {
        setValue('merchant', parsed.merchant);
        found.push(t('scan.found.merchant'));
      }
      if (parsed.date) {
        setValue('date', parsed.date, { shouldValidate: true });
        found.push(t('scan.found.date'));
      }
      const guess = categoryTouched ? null : suggestCategory({ merchant: parsed.merchant, text: parsed.text, memory, categories: lite, hint: parsed.hints });
      if (guess && guess.confidence !== 'low') {
        setValue('category', guess.key);
        found.push(t('scan.found.category'));
      }
      const options = parsed.amountCandidates.filter((c) => !c.currency || c.currency === 'MYR');
      const unsure = parsed.amountConfidence !== 'high';
      setCandidates({ list: unsure || options.length > 1 ? options : [], unsure });
      let text: string;
      if (parsed.amountConfidence === 'high') text = t('scan.filled', { found: found.join(', ') });
      else if (parsed.amountConfidence === 'medium') text = t('scan.unsureTotal', { found: found.join(', '), amount: formatMoney(parsed.amount) });
      else text = `${found.length ? `${t('scan.filled', { found: found.join(', ') })} ` : ''}${t('scan.noTotal')} ${options.length ? t('scan.tapRight') : t('scan.enterManual')}`;
      if (parsed.warnings.length) text += ` ${parsed.warnings.join(' ')}`;
      setScanNote({ text, bad: parsed.amountConfidence === 'low' || parsed.amountConfidence === 'none' });
    } catch (error) {
      const known = error instanceof ScanError;
      const text = known ? (error.problem === 'service' && error.serverText ? error.serverText : t(`scan.e.${error.problem}` as MessageKey)) : t('scan.e.service');
      setScanNote({ text, bad: true });
    } finally {
      setScanning(false);
    }
  };

  const save = (event: FormEvent<HTMLFormElement>) => {
    void handleSubmit(async (values) => {
      setProblem('');
      const createdAt = ymdToNoonIso(values.date);
      const amount = (toCents(values.amount) / 100).toFixed(2);
      setBusy(true);
      try {
        if (kind === 'expense') {
          if (!activeCategories.length) return setProblem(t('add.noCategories'));
          if (!values.category) {
            setError('category', { message: t('add.chooseCategory') });
            categoryBox.current?.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
            categoryBox.current?.querySelector<HTMLInputElement>('input[type="radio"]')?.focus({ preventScroll: true });
            return;
          }
          const row = { amount, category: values.category, payment: values.payment || first(activePayments), merchant: values.merchant.trim() || null, note: values.note.trim() || null, created_at: createdAt };
          if (!confirmed.current) {
            const duplicate = findDuplicate(row, data.expenses, editing?.row.id);
            if (duplicate) {
              setRepeat(duplicate);
              return;
            }
          }
          const monthBefore = sumCents(inMonth(data.expenses, createdAt.slice(0, 7)));
          const categoryBefore = sumCents(inMonth(data.expenses, createdAt.slice(0, 7)).filter((r) => r.category === row.category));
          if (editing) {
            await actions.updateTransaction('expense', editing.row.id, row);
            toast.show('success', t('add.updated'));
          } else {
            const result = await actions.addTransaction('expense', row);
            toast.show('success', result === 'queued' ? t('add.savedOffline') : t('add.saved'));
            if (result === 'saved') {
              const cents = toCents(amount);
              const lines: [string, number, number, number][] = [
                [categoryOf(row.category).label, budgetFor(data.budgets, row.category), categoryBefore, categoryBefore + cents],
                [t('add.overall'), budgetFor(data.budgets, 'all'), monthBefore, monthBefore + cents],
              ];
              for (const [name, limit, before, after] of lines) {
                const crossed = crossedLimit(limit, before, after);
                if (crossed === 'over') toast.show('info', t('add.budgetOver', { name }));
                else if (crossed === 'warn') toast.show('info', t('add.budgetWarn', { name, percent: Math.round((after / limit) * 100) }));
              }
            }
          }
        } else {
          const row = { amount, source: values.source || 'Salary', created_at: createdAt };
          if (editing) {
            await actions.updateTransaction('income', editing.row.id, row);
            toast.show('success', t('add.updated'));
          } else {
            const result = await actions.addTransaction('income', row);
            toast.show('success', result === 'queued' ? t('add.savedOffline') : t('add.saved'));
          }
        }
        closeSheet();
      } catch {
        setProblem(t('add.failed'));
      } finally {
        setBusy(false);
      }
    })(event);
  };

  const remove = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      const row = editing.row;
      await actions.deleteTransaction(editing.kind, row.id);
      closeSheet();
      toast.show('success', t('add.deleted'), { label: t('add.undo'), onClick: () => void actions.restoreTransaction(editing.kind, row).then(() => toast.show('info', t('add.restored'))) });
    } catch {
      setProblem(t('add.failed'));
    } finally {
      setBusy(false);
    }
  };

  const incomeOptions = INCOME_SOURCES.map((item) => ({ value: item.key, label: t(item.label), glyph: '💰', icon: 'income', color: '#059669' }));
  const title = editing ? t('add.edit') : t('add.title');
  const currentAmount = amountText ? formatMoney(toCents(amountText) / 100) : '';

  return (
    <Sheet ref={sheetRef} open onClose={onClose} title={title} dismissible={!busy && !scanning}>
      <form onSubmit={save} noValidate className={styles.form} data-kind={kind}>
        <div className={styles.hero} data-kind={kind}>
          {editing ? null : (
            <div className={styles.kind} role="group" aria-label={t('add.kind')}>
              {(['expense', 'income'] as const).map((value) => (
                <button key={value} type="button" className={`${styles.kindBtn} ${kind === value ? styles.kindOn : ''}`} aria-pressed={kind === value} onClick={() => setKind(value)}>
                  {t(value === 'expense' ? 'add.expense' : 'add.income')}
                </button>
              ))}
            </div>
          )}
          <Field big={kind === 'income' ? 'income' : true} label={t('add.amount')} inputMode="decimal" autoComplete="off" placeholder="0.00" data-autofocus data-len={amountSize(amountText)} className={styles.amount} error={formState.errors.amount?.message} hint={currentAmount} {...register('amount')} />
        </div>

        {kind === 'expense' ? (
          <>
            {editing ? null : (
              <div className={styles.scan}>
                <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className={styles.fileInput} tabIndex={-1} aria-hidden="true" data-testid="receipt-file" onChange={(event) => void onReceipt(event)} />
                <div className={styles.scanRow}>
                  <input ref={cameraInput} type="file" accept="image/*" capture="environment" className={styles.fileInput} tabIndex={-1} aria-hidden="true" data-testid="receipt-camera" onChange={(event) => void onReceipt(event)} />
                  <Button variant="outline" block loading={scanning} aria-expanded={hasCamera ? chooser : undefined} onClick={() => (hasCamera ? setChooser((open) => !open) : fileInput.current?.click())}>
                    {scanning ? t('scan.reading') : t('scan.button')}
                  </Button>
                  {/* how scanning treats the file, one tap away instead of three lines on every visit */}
                  <button type="button" className={styles.infoBtn} aria-label={t('scan.info')} aria-expanded={scanInfo} aria-controls="scan-hint" onClick={() => setScanInfo((open) => !open)}>
                    <Icon name="info" size={20} />
                  </button>
                </div>
                {chooser && hasCamera ? (
                  <div className={styles.chooser} role="group" aria-label={t('scan.button')}>
                    <button type="button" className={styles.chooseBtn} onClick={() => { setChooser(false); cameraInput.current?.click(); }}>
                      <Icon name="camera" size={22} />
                      <span><b>{t('scan.takePhoto')}</b><small>{t('scan.takePhotoHint')}</small></span>
                    </button>
                    <button type="button" className={styles.chooseBtn} onClick={() => { setChooser(false); fileInput.current?.click(); }}>
                      <Icon name="receipt" size={22} />
                      <span><b>{t('scan.chooseFile')}</b><small>{t('scan.chooseFileHint')}</small></span>
                    </button>
                  </div>
                ) : null}
                <p id="scan-hint" className={styles.scanHint} hidden={!scanInfo}>
                  {t('scan.hint')}
                </p>
                {scanNote ? (
                  <p className={`${styles.scanNote} ${scanNote.bad ? styles.scanBad : ''}`} role="status" data-testid="scan-note">
                    {scanNote.text}
                  </p>
                ) : null}
                {candidates.list.length > 0 ? (
                  <div className={styles.cands} role="group" aria-label={candidates.unsure ? t('scan.which') : t('scan.others')}>
                    <span className={styles.candLabel}>{candidates.unsure ? t('scan.which') : t('scan.others')}</span>
                    {candidates.list.map((c) => (
                      <button key={`${c.amount}-${c.label}`} type="button" className={styles.cand} aria-pressed={toCents(amountText) === Math.round(c.amount * 100)} onClick={() => setValue('amount', c.amount.toFixed(2), { shouldValidate: true })}>
                        <b>{formatMoney(c.amount)}</b>
                        {c.label ? <small>{c.label}</small> : null}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            )}
            <div ref={categoryBox}>
              <Controller
                name="category"
                control={control}
                render={({ field }) => (
                  <ChipGroup
                    legend={t('add.category')}
                    options={activeCategories.map((c) => ({ value: c.key, label: c.label, glyph: c.glyph, icon: c.key, color: c.color }))}
                    value={field.value}
                    error={formState.errors.category?.message}
                    onChange={(value) => {
                      setCategoryTouched(true);
                      clearErrors('category');
                      field.onChange(value);
                    }}
                  />
                )}
              />
            </div>
            {suggestion ? (
              suggestion.key === categoryValue ? (
                categoryTouched ? null : (
                  <p className={styles.suggest} data-testid="suggestion">
                    {t('add.suggestUsing', { label: suggestion.label, reason: suggestion.reason })}
                  </p>
                )
              ) : (
                <div className={styles.suggest} data-testid="suggestion">
                  <span>{t('add.suggestOffer', { label: suggestion.label, reason: suggestion.reason })}</span>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setCategoryTouched(false);
                      setValue('category', suggestion.key);
                    }}
                  >
                    {t('add.suggestUse', { label: suggestion.label })}
                  </Button>
                </div>
              )
            ) : null}
            <Controller name="payment" control={control} render={({ field }) => <ChipGroup legend={t('add.payment')} options={activePayments.map((p) => ({ value: p.key, label: p.label, glyph: p.glyph, icon: p.key, color: p.color }))} value={field.value} onChange={field.onChange} />} />
            <Field label={t('add.merchant')} autoComplete="off" error={formState.errors.merchant?.message} hint={editing ? undefined : t('nearby.hint')} trailing={editing ? undefined : <NearbyLocate nearby={nearby} />} {...register('merchant', { onChange: onMerchantChange })} />
            {editing ? null : <NearbyResults nearby={nearby} />}
            <Field label={t('add.note')} autoComplete="off" error={formState.errors.note?.message} {...register('note')} />
          </>
        ) : (
          <Controller name="source" control={control} render={({ field }) => <ChipGroup legend={t('add.source')} options={incomeOptions} value={field.value} onChange={field.onChange} />} />
        )}

        <Field label={t('add.date')} type="date" error={formState.errors.date?.message} {...register('date')} />

        {repeat ? (
          <Notice kind="warn">
            <strong>{t('add.duplicateTitle')}</strong>
            <br />
            {t('add.duplicateBody', {
              amount: (toCents(repeat.amount) / 100).toFixed(2),
              place: repeat.merchant ? `@ ${repeat.merchant}` : `(${categoryOf(repeat.category).label}, ${paymentOf(repeat.payment).label})`,
              date: formatDate(isoToYmd(repeat.created_at), data.dateFormat),
            })}
            <div className={styles.dup}>
              <Button
                variant="outline"
                onClick={() => {
                  confirmed.current = true;
                  setRepeat(null);
                  (document.getElementById('add-form-submit') as HTMLButtonElement | null)?.click();
                }}
              >
                {t('add.saveAnyway')}
              </Button>
              <Button variant="ghost" onClick={() => setRepeat(null)}>
                {t('common.cancel')}
              </Button>
            </div>
          </Notice>
        ) : null}
        {problem ? <Notice kind="bad">{problem}</Notice> : null}

        {/* a direct child of the form, so it can stay pinned to the bottom of the pop-up while the form scrolls */}
        <div className={styles.saveBar}>
          <Button id="add-form-submit" type="submit" block loading={busy}>
            {busy ? t('add.saving') : t('add.save')}
          </Button>
        </div>
        {editing ? (
          <div className={styles.more}>
            <Button variant="outline" block disabled={busy} onClick={() => { sheetRef.current?.close(() => openAdd({ copy: editing })); }}>
              {t('history.duplicate')}
            </Button>
            <Button variant="danger" block disabled={busy} onClick={() => void remove()}>
              {t('add.delete')}
            </Button>
          </div>
        ) : null}
      </form>
    </Sheet>
  );
}
