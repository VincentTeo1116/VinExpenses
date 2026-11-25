// One place that loads the person's money records and offers the actions on them, so every screen shares the same data.
import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useI18n } from '@/lib/i18n';
import { mergeCategories, mergePayments, type TaxonomyItem } from './taxonomy';
import { useKeepInStep, useMoneyActions, useMoneyData, type MoneyData } from './data';
import type { Expense, Income, Kind } from './types';
// The add sheet (and the form library it needs) is only downloaded the first time it is opened
const AddSheet = lazy(() => import('./AddSheet').then((module) => ({ default: module.AddSheet })));

interface AddRequest {
  kind?: Kind;
  edit?: { kind: Kind; row: Expense | Income };
  /** A record to start from (the Duplicate button): its values, dated today. */
  copy?: { kind: Kind; row: Expense | Income };
}

interface MoneyValue {
  data: MoneyData;
  actions: ReturnType<typeof useMoneyActions>;
  categories: TaxonomyItem[];
  payments: TaxonomyItem[];
  /** The ones that can be chosen for a new record (hidden ones are left out). */
  activeCategories: TaxonomyItem[];
  activePayments: TaxonomyItem[];
  categoryOf: (key: string) => TaxonomyItem;
  paymentOf: (key: string) => TaxonomyItem;
  openAdd: (request?: AddRequest) => void;
  closeAdd: () => void;
}

const MoneyContext = createContext<MoneyValue | null>(null);

export function MoneyProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const data = useMoneyData();
  const actions = useMoneyActions();
  useKeepInStep(data, actions);
  const [request, setRequest] = useState<AddRequest | null>(null);

  const categories = useMemo(() => mergeCategories(data.categoryRows, t), [data.categoryRows, t]);
  const payments = useMemo(() => mergePayments(data.paymentRows, t), [data.paymentRows, t]);
  const openAdd = useCallback((next: AddRequest = {}) => setRequest(next), []);
  const closeAdd = useCallback(() => setRequest(null), []);

  const value = useMemo<MoneyValue>(() => {
    const unknown = (key: string): TaxonomyItem => ({ key, label: key, color: '#6b7280', glyph: '🏷️', active: false, builtin: false, renamed: false });
    return {
      data,
      actions,
      categories,
      payments,
      activeCategories: categories.filter((item) => item.active),
      activePayments: payments.filter((item) => item.active),
      categoryOf: (key) => categories.find((item) => item.key === key) ?? unknown(key),
      paymentOf: (key) => payments.find((item) => item.key === key) ?? unknown(key),
      openAdd,
      closeAdd,
    };
  }, [data, actions, categories, payments, openAdd, closeAdd]);

  // Adding must also work offline, so the add sheet's code is fetched quietly soon after the app has loaded
  // (it is not part of the first download), and is then kept by the browser and the offline cache.
  useEffect(() => {
    const timer = setTimeout(() => void import('./AddSheet').catch(() => undefined), 1500);
    return () => clearTimeout(timer);
  }, []);

  // "N" opens the add sheet from anywhere, unless the person is typing or a dialog is already open
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'n' || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      setRequest({});
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <MoneyContext.Provider value={value}>
      {children}
      {request ? (
        <Suspense fallback={null}>
          <AddSheet request={request} onClose={() => setRequest(null)} />
        </Suspense>
      ) : null}
    </MoneyContext.Provider>
  );
}

export function useMoney(): MoneyValue {
  const value = useContext(MoneyContext);
  if (!value) throw new Error('useMoney must be used inside MoneyProvider');
  return value;
}

export type { AddRequest };
