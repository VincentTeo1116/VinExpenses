// AC-07 (export and import), HI-02: take every record out as a CSV, or bring a CSV or bank statement in after a summary.
import { useRef, useState, type ChangeEvent } from 'react';
import { Button } from '@/components/Button';
import { Notice } from '@/components/Notice';
import { Sheet } from '@/components/Sheet';
import { useToast } from '@/components/Toast';
import { useI18n, type MessageKey } from '@/lib/i18n';
import { isoToYmd, todayYmd } from '@/lib/dates';
import { DataError } from '@/features/money/data';
import { useMoney } from '@/features/money/MoneyContext';
import type { Expense, Income } from '@/features/money/types';
import { EXPORT_HEADER, importRecords, MAX_BYTES, MAX_ROWS, toCsv, type ImportResult } from './csv';
import { planImport, type ImportPlan } from './plan';
import styles from './DataCard.module.css';

export type Entry = { kind: 'expense'; row: Expense } | { kind: 'income'; row: Income };

export function downloadCsv(text: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The app's own CSV: one line per record, labels (not codes) for categories and payment methods. */
export function entriesToCsv(entries: Entry[], labels: { category: (key: string) => string; payment: (key: string) => string }): string {
  const rows: unknown[][] = [EXPORT_HEADER];
  for (const entry of entries) {
    if (entry.kind === 'expense') {
      const r = entry.row;
      rows.push([isoToYmd(r.created_at), 'expense', r.merchant ?? '', labels.category(r.category), labels.payment(r.payment), '', r.note ?? '', Number(r.amount).toFixed(2)]);
    } else {
      const r = entry.row;
      rows.push([isoToYmd(r.created_at), 'income', '', '', '', r.source || 'Salary', '', Number(r.amount).toFixed(2)]);
    }
  }
  return toCsv(rows);
}

export function DataCard() {
  const { t } = useI18n();
  const toast = useToast();
  const { data, actions, categoryOf, paymentOf, activeCategories, activePayments } = useMoney();
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ parsed: ImportResult; plan: ImportPlan } | null>(null);
  const [problem, setProblem] = useState<{ title: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const exportAll = () => {
    const entries: Entry[] = [...data.expenses.map((row) => ({ kind: 'expense' as const, row })), ...data.incomes.map((row) => ({ kind: 'income' as const, row }))].filter((e) => !e.row.id.startsWith('queued-'));
    if (!entries.length) return toast.show('info', t('data.nothingExport'));
    entries.sort((a, b) => b.row.created_at.localeCompare(a.row.created_at));
    downloadCsv(entriesToCsv(entries, { category: (k) => categoryOf(k).label, payment: (k) => paymentOf(k).label }), `vinexpenses-all-${todayYmd()}.csv`);
    toast.show('success', t('data.exported', { n: entries.length }));
  };

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setProblem(null);
    if (file.size > MAX_BYTES) return setProblem({ title: t('import.cantTitle'), text: t('import.tooBig') });
    let parsed: ImportResult;
    try {
      parsed = importRecords(await file.text());
    } catch {
      return setProblem({ title: t('import.cantTitle'), text: t('import.readFail') });
    }
    if (parsed.error) return setProblem({ title: t('import.cantTitle'), text: t(`import.e.${parsed.error}` as MessageKey) });
    const plan = planImport(parsed.records, { categories: activeCategories, payments: activePayments, expenses: data.expenses, incomes: data.incomes });
    setPending({ parsed, plan });
  };

  const summary = (parsed: ImportResult, plan: ImportPlan): string => {
    const first = parsed.skipped[0];
    return [
      t('import.willAdd', { e: plan.expenses.length, i: plan.incomes.length }),
      plan.duplicates ? t('import.dupes', { n: plan.duplicates }) : '',
      first ? t('import.skippedRows', { n: parsed.skipped.length, line: first.line, reason: t(`import.r.${first.reason}` as MessageKey) }) : '',
      parsed.tooMany ? t('import.tooMany', { n: MAX_ROWS }) : '',
      parsed.convention ? t(`import.c.${parsed.convention}` as MessageKey) : '',
    ]
      .filter(Boolean)
      .join(' ');
  };

  const confirm = async () => {
    if (!pending) return;
    const { plan } = pending;
    setBusy(true);
    try {
      const n = await actions.importRows(plan.expenses, plan.incomes);
      setPending(null);
      toast.show('success', t('import.done', { n }));
    } catch (error) {
      setPending(null);
      toast.show('error', error instanceof DataError && error.offline ? t('import.offline') : t('import.failed'));
    } finally {
      setBusy(false);
    }
  };

  const count = pending ? pending.plan.expenses.length + pending.plan.incomes.length : 0;
  return (
    <section className={styles.card} aria-labelledby="acc-data">
      <h2 id="acc-data" className={styles.h2}>
        {t('data.title')}
      </h2>
      <p className={styles.muted}>{t('data.sub')}</p>
      <div className={styles.actions}>
        <Button variant="outline" onClick={exportAll}>
          {t('data.export')}
        </Button>
        <input ref={fileInput} type="file" accept=".csv,text/csv" className={styles.file} tabIndex={-1} aria-hidden="true" data-testid="csv-file" onChange={(event) => void onFile(event)} />
        <Button variant="outline" onClick={() => fileInput.current?.click()}>
          {t('data.import')}
        </Button>
      </div>
      <p className={styles.muted}>{t('data.importHint')}</p>
      {problem ? (
        <Notice kind="warn">
          <strong>{problem.title}</strong> {problem.text}
        </Notice>
      ) : null}

      <Sheet open={pending !== null} onClose={() => setPending(null)} title={count ? t('import.title', { n: count }) : t('import.nothingTitle')}>
        {pending ? (
          <div className={styles.summary}>
            <p data-testid="import-summary">{summary(pending.parsed, pending.plan)}</p>
            <div className={styles.actions}>
              {count > 0 ? (
                <Button loading={busy} onClick={() => void confirm()}>
                  {t('import.confirm', { n: count })}
                </Button>
              ) : null}
              <Button variant="outline" onClick={() => setPending(null)}>
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        ) : null}
      </Sheet>
    </section>
  );
}
