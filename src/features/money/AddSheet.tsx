// TX-01 … TX-05: one sheet to add or change an expense or an income: amount first, then what it was for, then when.
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';
import '@/lib/zodSetup'; // zod must be set up (no eval) before any schema below is made
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
import { placedWords, rememberScan } from '@/features/split/lastScan';
import { CameraSheet, cameraAvailable, isTouchDevice, ReceiptPreview, ScanChooser } from '@/features/receipts/ScanPopups';
import type { OcrWord } from '@/features/receipts/highlight';
import { formatRate, lookupRate, originalNote, toRinggit, withOriginal } from '@/features/receipts/fx';
import { NearbyLocate, NearbyResults, useNearby } from './NearbyPicker';
import type { Candidate } from '@/features/receipts/receiptParser';
import { formatDate, isoToYmd, isYmd, todayYmd, ymdToNoonIso } from '@/lib/dates';
import { formatMoney, toCents } from '@/lib/money';
import { budgetFor, crossedLimit, findDuplicate, inMonth, sumCents } from './calc';
import { INCOME_SOURCES } from './taxonomy';
import { useMoney, type AddRequest } from './MoneyContext';
import type { Expense, Income, Kind } from './types';
import { SplitCard } from '@/features/split/SplitCard';
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
  const navigate = useNavigate();
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
  const [cameraOpen, setCameraOpen] = useState(false);
  const [fxAlert, setFxAlert] = useState<string | null>(null); // a receipt in another currency: what was done, and to check it
  const [preview, setPreview] = useState<{ src: string; words: OcrWord[]; amount: number; merchantLine: string; dateLine: string } | null>(null);
  const categoryBox = useRef<HTMLDivElement>(null);
  const [scanInfo, setScanInfo] = useState(false);

  const first = (rows: { key: string }[]) => rows[0]?.key ?? '';
  const initial = useMemo<Values>(() => {
    const row = source?.row;
    const expense = row && source?.kind === 'expense' ? (row as Expense) : null;
    const income = row && source?.kind === 'income' ? (row as Income) : null;
    const copying = Boolean(request.copy);
    return {
      amount: row ? toCents(row.amount) / 100 + '' : request.prefill ? request.prefill.amount.toFixed(2) : '',
      category: expense?.category ?? '', // a new expense starts with no category: the person (or the place they type) chooses it
      payment: expense?.payment ?? first(activePayments),
      source: income?.source ?? 'Salary',
      date: row && !copying ? isoToYmd(row.created_at) : request.prefill?.date ?? todayYmd(),
      merchant: expense?.merchant ?? request.prefill?.merchant ?? '',
      note: expense?.note ?? request.prefill?.note ?? '',
    };
    // the starting values are taken once, when the sheet opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const schema = useMemo(() => buildSchema(t), [t]);
  const { register, control, handleSubmit, formState, setValue, getValues, setError, clearErrors } = useForm<Values>({ resolver: zodResolver(schema), mode: 'onTouched', defaultValues: initial });
  const amountText = useWatch({ control, name: 'amount' });
  const merchantText = useWatch({ control, name: 'merchant' });
  const categoryValue = useWatch({ control, name: 'category' });
  const dateValue = useWatch({ control, name: 'date' });
  // a record dated after today is allowed, but the person is warned beside the date and asked once more when saving
  const isFuture = isYmd(dateValue) && dateValue > todayYmd();
  const [futureAsk, setFutureAsk] = useState(false);
  const futureOk = useRef(false);
  useEffect(() => {
    futureOk.current = false; // a different date needs its own yes
  }, [dateValue]);
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
  /** The note (remarks) helps pick the category too, with the same rules as the merchant: the person's own history first, then the built-in keywords. */
  const onNoteChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (editing || categoryTouched) return;
    const found = suggestCategory({ merchant: getValues('merchant'), text: event.target.value, memory, categories: lite });
    if (found && found.confidence !== 'low') setValue('category', found.key);
  };
  const onMerchantChange =(event: ChangeEvent<HTMLInputElement>) => {
    if (editing || categoryTouched) return;
    const found = suggestCategory({ merchant: event.target.value, memory, categories: lite });
    if (found && found.confidence !== 'low') setValue('category', found.key);
  };

  /** Reads the chosen receipt and fills the form, leaving a category the person already chose alone. */
  const onReceipt = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void onReceiptFile(file);
  };
  const onReceiptFile = async (file: File) => {
    if (!envResult.ok) return;
    setScanning(true);
    // what was in the form when the scan began: a field the person changed while it was reading is theirs, and the scan leaves it alone
    const startValues = { amount: getValues('amount'), merchant: getValues('merchant'), date: getValues('date') };
    const untouched = (name: keyof typeof startValues) => getValues(name) === startValues[name];
    setCandidates({ list: [], unsure: false });
    setPreview(null);
    setFxAlert(null);
    const steps = { pdf: 'scan.step.pdf', scan: 'scan.step.scan', image: 'scan.step.image', text: 'scan.step.text', local: 'scan.step.local' } as const;
    const context = { baseUrl: envResult.env.supabaseUrl, anonKey: envResult.env.supabaseAnonKey, accessToken: session?.access_token };
    setScanNote({ text: t('scan.reading'), bad: false });
    try {
      let shown = '';
      const parsed = await scanReceipt(file, context, (step) => setScanNote({ text: t(steps[step]), bad: false }), (src) => {
        shown = src;
        setPreview({ src, words: [], amount: 0, merchantLine: '', dateLine: '' });
      });
      // A receipt whose only clear total is in another currency is turned into ringgit at the rate of the receipt's own day (today's rate if
      // that day is unavailable). A bare "$" is never guessed. If no rate can be had, the person is asked for the ringgit amount.
      const foreign = parsed.amount === 0 && parsed.foreignTotal ? parsed.foreignTotal : null;
      let converted = 0;
      let alertText: string | null = null;
      if (foreign) {
        const label = `${foreign.currency} ${foreign.amount.toFixed(2)}`;
        if (!foreign.ambiguous) setScanNote({ text: t('scan.step.fx'), bad: false });
        // the rate of the receipt's own day; a missing or future date cannot be trusted, so today's rate is used and the alert says so
        const receiptDay = parsed.date && parsed.date <= todayYmd() ? parsed.date : '';
        const quote = foreign.ambiguous ? null : await lookupRate(context, foreign.currency, receiptDay || todayYmd());
        if (quote) {
          converted = toRinggit(foreign.amount, quote.rate);
          const original = originalNote(foreign.currency, foreign.amount, quote);
          setValue('note', withOriginal(getValues('note'), original), { shouldDirty: true, shouldValidate: true });
          const why = quote.fallback ? `${t('scan.fx.fallback')} ` : !receiptDay ? `${t('scan.fx.noDate')} ` : '';
          alertText = `${t('scan.fx.converted', { orig: label, amount: formatMoney(converted), rate: formatRate(quote.rate), date: quote.date })} ${why}${t('scan.fx.check')}`;
        } else {
          alertText = t('scan.fx.manual', { orig: label });
        }
      } else if (parsed.amount > 0 && parsed.otherCurrencies.length) {
        alertText = `${t('scan.fx.mixed', { currencies: parsed.otherCurrencies.join(', ') })} ${t('scan.fx.check')}`;
      }
      setFxAlert(alertText);
      rememberScan({ text: parsed.text, words: placedWords(parsed.words), merchant: parsed.merchant, date: parsed.date, image: shown || undefined });
      setPreview((p) => (p ? { src: p.src, words: parsed.words, amount: converted && foreign ? foreign.amount : parsed.amount, merchantLine: parsed.merchantEvidence, dateLine: parsed.dateEvidence } : p));
      const found: string[] = [];
      const amountNow = converted || parsed.amount;
      if (amountNow > 0 && untouched('amount')) {
        setValue('amount', amountNow.toFixed(2), { shouldValidate: true });
        found.push(t('scan.found.amount'));
      }
      if (parsed.merchant && untouched('merchant')) {
        setValue('merchant', parsed.merchant);
        found.push(t('scan.found.merchant'));
      }
      if (parsed.date && untouched('date')) {
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
      if (converted) text = t('scan.filled', { found: found.join(', ') });
      else if (parsed.amountConfidence === 'high') text = t('scan.filled', { found: found.join(', ') });
      else if (parsed.amountConfidence === 'medium') text = t('scan.unsureTotal', { found: found.join(', '), amount: formatMoney(parsed.amount) });
      else text = `${found.length ? `${t('scan.filled', { found: found.join(', ') })} ` : ''}${t('scan.noTotal')} ${options.length ? t('scan.tapRight') : t('scan.enterManual')}`;
      // the parser's own English warnings about other currencies are replaced by the clearer translated alert below the note
      if (parsed.warnings.length && !alertText) text += ` ${parsed.warnings.join(' ')}`;
      setScanNote({ text, bad: !converted && (parsed.amountConfidence === 'low' || parsed.amountConfidence === 'none') });
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
      // an existing future-dated record is only questioned again when its date was changed
      if (isYmd(values.date) && values.date > todayYmd() && !futureOk.current && (!editing || values.date !== isoToYmd(editing.row.created_at))) {
        setFutureAsk(true);
        return;
      }
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
            request.onSaved?.();
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
    <Sheet
      ref={sheetRef}
      open
      onClose={onClose}
      title={title}
      dismissible={!busy && !scanning}
      footer={
        <Button id="add-form-submit" type="submit" form="add-form" block loading={busy} disabled={scanning}>
          {busy ? t('add.saving') : t('add.save')}
        </Button>
      }
    >
      <form id="add-form" onSubmit={save} noValidate className={styles.form} data-kind={kind}>
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
                <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className={styles.fileInput} tabIndex={-1} aria-hidden="true" data-testid="receipt-file" onChange={onReceipt} />
                <div className={styles.scanRow}>
                  <input ref={cameraInput} type="file" accept="image/*" capture="environment" className={styles.fileInput} tabIndex={-1} aria-hidden="true" data-testid="receipt-camera" onChange={onReceipt} />
                  <Button variant="outline" block loading={scanning} onClick={() => setChooser(true)} data-tour="scan">
                    {scanning ? t('scan.reading') : t('scan.button')}
                  </Button>
                  {/* how scanning treats the file, one tap away instead of three lines on every visit */}
                  <button type="button" className={styles.infoBtn} aria-label={t('scan.info')} aria-expanded={scanInfo} aria-controls="scan-hint" onClick={() => setScanInfo((open) => !open)}>
                    <Icon name="info" size={20} />
                  </button>
                </div>
                {preview ? <ReceiptPreview src={preview.src} words={preview.words} amount={preview.amount} merchantLine={preview.merchantLine} dateLine={preview.dateLine} onClose={() => setPreview(null)} /> : null}
                <p id="scan-hint" className={styles.scanHint} hidden={!scanInfo}>
                  {t('scan.hint')}
                </p>
                {request.prefill ? null : <SplitCard variant="sheet" onOpen={() => sheetRef.current?.close(() => navigate('/app/split'))} />}
                <ScanChooser
                  open={chooser}
                  onClose={() => setChooser(false)}
                  onFile={() => {
                    fileInput.current?.click();
                    setChooser(false);
                  }}
                  onCamera={() => {
                    if (isTouchDevice() || !cameraAvailable()) cameraInput.current?.click();
                    else setCameraOpen(true);
                    setChooser(false);
                  }}
                />
                <CameraSheet
                  open={cameraOpen}
                  onClose={() => setCameraOpen(false)}
                  onFallback={() => {
                    setCameraOpen(false);
                    fileInput.current?.click();
                  }}
                  onCapture={(file) => {
                    setCameraOpen(false);
                    void onReceiptFile(file);
                  }}
                />
                {fxAlert ? (
                  <Notice kind="warn">
                    <span data-testid="fx-alert">{fxAlert}</span>
                  </Notice>
                ) : null}
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
            <Field label={t('add.note')} autoComplete="off" error={formState.errors.note?.message} {...register('note', { onChange: onNoteChange })} />
          </>
        ) : (
          <Controller name="source" control={control} render={({ field }) => <ChipGroup legend={t('add.source')} options={incomeOptions} value={field.value} onChange={field.onChange} />} />
        )}

        <Field label={t('add.date')} type="date" error={formState.errors.date?.message} {...register('date')} />
        {isFuture ? (
          <Notice kind="warn">
            <span data-testid="future-hint">{t('add.future.hint')}</span>
          </Notice>
        ) : null}

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
      <Sheet open={futureAsk} onClose={() => setFutureAsk(false)} title={t('add.future.title')} dismissible={false}>
        <p>{t('add.future.body', { date: formatDate(dateValue, data.dateFormat) })}</p>
        <div className={styles.actions}>
          <Button
            data-testid="future-yes"
            onClick={() => {
              futureOk.current = true;
              setFutureAsk(false);
              document.getElementById('add-form-submit')?.click();
            }}
          >
            {t('add.future.yes')}
          </Button>
          <Button variant="outline" onClick={() => setFutureAsk(false)}>
            {t('add.future.change')}
          </Button>
        </div>
      </Sheet>
    </Sheet>
  );
}
