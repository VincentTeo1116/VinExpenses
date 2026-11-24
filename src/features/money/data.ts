// Loading and saving the person's money records. Every read and write is limited to the signed-in person by the database
// (row-level security); the app also sends their id, which the database checks against the sign-in.
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useAuth } from '@/app/AuthProvider';
import { useToast } from '@/components/Toast';
import { useI18n } from '@/lib/i18n';
import { todayYmd, ymdToNoonIso, type DateFormat } from '@/lib/dates';
import { byDateDesc, planDue, resumeDate } from './calc';
import { mergeCategories, mergePayments } from './taxonomy';
import { clearQueue, enqueue, readQueue, removeFromQueue, type QueuedRow } from './offlineQueue';
import type { Budget, CategoryRow, Expense, Income, PaymentRow, RecurringExpense, RecurringIncome } from './types';

const PAGE = 1000;

export class DataError extends Error {
  readonly offline: boolean;
  constructor(message: string, offline = false) {
    super(message);
    this.name = 'DataError';
    this.offline = offline;
  }
}

/** Reads every row of a table, 1,000 at a time, so a long history is never cut off at the first page. */
async function fetchAll<T>(client: SupabaseClient, table: string, order: { column: string; ascending: boolean }): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < 200_000; from += PAGE) {
    const { data, error } = await client.from(table).select('*').order(order.column, { ascending: order.ascending }).range(from, from + PAGE - 1);
    if (error) throw new DataError(error.message, /fetch|network/i.test(error.message));
    const page = (data ?? []) as T[];
    out.push(...page);
    if (page.length < PAGE) break;
  }
  return out;
}

const keys = (userId: string) => ({
  expenses: ['expenses', userId] as const,
  incomes: ['incomes', userId] as const,
  recurring: ['recurring', userId] as const,
  recurringIncomes: ['recurring-incomes', userId] as const,
  budgets: ['budgets', userId] as const,
  categories: ['categories', userId] as const,
  payments: ['payments', userId] as const,
  prefs: ['prefs', userId] as const,
});

export interface MoneyData {
  userId: string;
  loading: boolean;
  /** At least one list could not be loaded. */
  failed: boolean;
  reload: () => void;
  expenses: (Expense & { pending?: boolean })[];
  incomes: (Income & { pending?: boolean })[];
  recurring: RecurringExpense[];
  recurringIncomes: RecurringIncome[];
  budgets: Budget[];
  categoryRows: CategoryRow[];
  paymentRows: PaymentRow[];
  dateFormat: DateFormat;
  /** Rows saved on this device that are still waiting for a connection. */
  pendingCount: number;
}

export function useMoneyData(): MoneyData {
  const { client, session } = useAuth();
  const userId = session?.user?.id ?? '';
  const enabled = Boolean(client && userId);
  const k = keys(userId);
  const c = client as SupabaseClient;

  const expenses = useQuery({ queryKey: k.expenses, enabled, queryFn: () => fetchAll<Expense>(c, 'expenses', { column: 'created_at', ascending: false }) });
  const incomes = useQuery({ queryKey: k.incomes, enabled, queryFn: () => fetchAll<Income>(c, 'incomes', { column: 'created_at', ascending: false }) });
  const recurring = useQuery({ queryKey: k.recurring, enabled, queryFn: () => fetchAll<RecurringExpense>(c, 'recurring_expenses', { column: 'next_due', ascending: true }) });
  const recurringIncomes = useQuery({ queryKey: k.recurringIncomes, enabled, queryFn: () => fetchAll<RecurringIncome>(c, 'recurring_incomes', { column: 'next_due', ascending: true }) });
  const budgets = useQuery({ queryKey: k.budgets, enabled, queryFn: () => fetchAll<Budget>(c, 'budgets', { column: 'category', ascending: true }) });
  const categories = useQuery({ queryKey: k.categories, enabled, queryFn: () => fetchAll<CategoryRow>(c, 'user_categories', { column: 'sort_order', ascending: true }) });
  const payments = useQuery({ queryKey: k.payments, enabled, queryFn: () => fetchAll<PaymentRow>(c, 'user_payment_methods', { column: 'sort_order', ascending: true }) });
  const prefs = useQuery({
    queryKey: k.prefs,
    enabled,
    queryFn: async () => {
      const { data, error } = await c.from('user_preferences').select('date_format').eq('user_id', userId).maybeSingle();
      if (error) throw new DataError(error.message);
      return ((data as { date_format?: DateFormat } | null)?.date_format ?? 'dmy_short') as DateFormat;
    },
  });

  const queries = [expenses, incomes, recurring, recurringIncomes, budgets, categories, payments, prefs];
  // the queue is read fresh whenever it changes (the number is only there to make the screen redraw)
  const queueVersion = useQueueVersion();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const pending = useMemo(() => readQueue(userId), [userId, queueVersion]);

  const queued = useMemo(() => {
    const pe: (Expense & { pending?: boolean })[] = pending.filter((q) => q.kind === 'expense').map((q) => ({ ...(q.row as Omit<Expense, 'id' | 'created_at' | 'user_id'>), user_id: userId, id: q.tempId, created_at: q.createdAt, pending: true }));
    const pi: (Income & { pending?: boolean })[] = pending.filter((q) => q.kind === 'income').map((q) => ({ ...(q.row as Omit<Income, 'id' | 'created_at' | 'user_id'>), user_id: userId, id: q.tempId, created_at: q.createdAt, pending: true }));
    return { pe, pi };
  }, [pending, userId]);

  return {
    userId,
    loading: enabled && queries.some((q) => q.isPending),
    failed: queries.some((q) => q.isError),
    reload: () => queries.forEach((q) => void q.refetch()),
    expenses: useMemo(() => [...queued.pe, ...(expenses.data ?? [])].sort(byDateDesc), [queued.pe, expenses.data]),
    incomes: useMemo(() => [...queued.pi, ...(incomes.data ?? [])].sort(byDateDesc), [queued.pi, incomes.data]),
    recurring: recurring.data ?? EMPTY,
    recurringIncomes: recurringIncomes.data ?? EMPTY,
    budgets: budgets.data ?? EMPTY,
    categoryRows: categories.data ?? EMPTY,
    paymentRows: payments.data ?? EMPTY,
    dateFormat: prefs.data ?? 'dmy_short',
    pendingCount: pending.length,
  };
}
const EMPTY: never[] = [];

// ---- a tiny change counter so the "waiting to sync" list redraws when the queue changes ----
const queueListeners = new Set<() => void>();
let queueTick = 0;
export function notifyQueue() {
  queueTick += 1;
  for (const listener of queueListeners) listener();
}
function useQueueVersion(): number {
  return useSyncExternalStore(
    (listener) => {
      queueListeners.add(listener);
      return () => queueListeners.delete(listener);
    },
    () => queueTick,
    () => 0,
  );
}

// ---- writing ----
export type NewExpense = { amount: string; category: string; payment: string; merchant: string | null; note: string | null; created_at: string };
export type NewIncome = { amount: string; source: string; created_at: string };

const isNetworkProblem = (message: string) => /failed to fetch|network|load failed|timeout|offline/i.test(message);

export function useMoneyActions() {
  const { client, session } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { t } = useI18n();
  const userId = session?.user?.id ?? '';
  const k = useMemo(() => keys(userId), [userId]);
  const c = client as SupabaseClient;

  const patchList = useCallback(
    <T extends { id: string }>(key: readonly unknown[], update: (list: T[]) => T[]) => queryClient.setQueryData<T[]>(key, (list) => update(list ?? [])),
    [queryClient],
  );

  const insert = useCallback(
    async <T,>(table: string, row: Record<string, unknown>): Promise<T> => {
      const { data, error } = await c.from(table).insert({ ...row, user_id: userId }).select().single();
      if (error) throw new DataError(error.message, isNetworkProblem(error.message) || !navigator.onLine);
      return data as T;
    },
    [c, userId],
  );

  /** Saves an expense or income. Offline, it is kept on this device and sent later (TX-06). Resolves to "saved" or "queued". */
  const addTransaction = useCallback(
    async (kind: 'expense' | 'income', row: NewExpense | NewIncome): Promise<'saved' | 'queued'> => {
      const table = kind === 'expense' ? 'expenses' : 'incomes';
      const keep = (): 'queued' => {
        enqueue(userId, { kind, row: row as unknown as Record<string, unknown>, createdAt: row.created_at });
        notifyQueue();
        return 'queued';
      };
      if (!navigator.onLine) return keep();
      try {
        const saved = await insert<Expense & Income>(table, row as unknown as Record<string, unknown>);
        if (kind === 'expense') patchList<Expense>(k.expenses, (list) => [saved as Expense, ...list].sort(byDateDesc));
        else patchList<Income>(k.incomes, (list) => [saved as Income, ...list].sort(byDateDesc));
        return 'saved';
      } catch (error) {
        if (error instanceof DataError && error.offline) return keep();
        throw error;
      }
    },
    [insert, k, patchList, userId],
  );

  const updateTransaction = useCallback(
    async (kind: 'expense' | 'income', id: string, fields: Partial<NewExpense> | Partial<NewIncome>) => {
      const table = kind === 'expense' ? 'expenses' : 'incomes';
      const { data, error } = await c.from(table).update(fields).eq('id', id).eq('user_id', userId).select().single();
      if (error) throw new DataError(error.message, isNetworkProblem(error.message));
      if (kind === 'expense') patchList<Expense>(k.expenses, (list) => list.map((row) => (row.id === id ? (data as Expense) : row)).sort(byDateDesc));
      else patchList<Income>(k.incomes, (list) => list.map((row) => (row.id === id ? (data as Income) : row)).sort(byDateDesc));
    },
    [c, k, patchList, userId],
  );

  const deleteTransaction = useCallback(
    async (kind: 'expense' | 'income', id: string) => {
      if (id.startsWith('queued-')) {
        removeFromQueue(userId, id);
        notifyQueue();
        return;
      }
      const table = kind === 'expense' ? 'expenses' : 'incomes';
      const { error } = await c.from(table).delete().eq('id', id).eq('user_id', userId);
      if (error) throw new DataError(error.message, isNetworkProblem(error.message));
      if (kind === 'expense') patchList<Expense>(k.expenses, (list) => list.filter((row) => row.id !== id));
      else patchList<Income>(k.incomes, (list) => list.filter((row) => row.id !== id));
    },
    [c, k, patchList, userId],
  );

  /** Puts back a record that was just deleted (the Undo button). It keeps its date and values. */
  const restoreTransaction = useCallback(
    async (kind: 'expense' | 'income', row: Expense | Income) => {
      const copy: Record<string, unknown> = { ...row };
      delete copy.id;
      delete copy.user_id;
      await addTransaction(kind, copy as unknown as NewExpense | NewIncome);
    },
    [addTransaction],
  );

  // ---- recurring (RC-01, RC-03) ----
  const saveRecurring = useCallback(
    async (kind: 'expense' | 'income', id: string | null, fields: Record<string, unknown>) => {
      const table = kind === 'expense' ? 'recurring_expenses' : 'recurring_incomes';
      const key = kind === 'expense' ? k.recurring : k.recurringIncomes;
      if (id) {
        const { data, error } = await c.from(table).update(fields).eq('id', id).eq('user_id', userId).select().single();
        if (error) throw new DataError(error.message, isNetworkProblem(error.message));
        patchList<{ id: string; next_due: string }>(key, (list) => list.map((row) => (row.id === id ? (data as { id: string; next_due: string }) : row)).sort((a, b) => a.next_due.localeCompare(b.next_due)));
      } else {
        const saved = await insert<{ id: string; next_due: string }>(table, fields);
        patchList<{ id: string; next_due: string }>(key, (list) => [...list, saved].sort((a, b) => a.next_due.localeCompare(b.next_due)));
      }
    },
    [c, insert, k, patchList, userId],
  );

  const deleteRecurring = useCallback(
    async (kind: 'expense' | 'income', id: string) => {
      const table = kind === 'expense' ? 'recurring_expenses' : 'recurring_incomes';
      const { error } = await c.from(table).delete().eq('id', id).eq('user_id', userId);
      if (error) throw new DataError(error.message, isNetworkProblem(error.message));
      patchList<{ id: string }>(kind === 'expense' ? k.recurring : k.recurringIncomes, (list) => list.filter((row) => row.id !== id));
    },
    [c, k, patchList, userId],
  );

  const toggleRecurring = useCallback(
    async (kind: 'expense' | 'income', item: RecurringExpense | RecurringIncome) => {
      const fields: Record<string, unknown> = { active: !item.active };
      if (!item.active) fields.next_due = resumeDate(item, todayYmd()); // resuming skips what was missed while paused
      await saveRecurring(kind, item.id, fields);
    },
    [saveRecurring],
  );

  // ---- budgets (BU-01) ----
  const saveBudgets = useCallback(
    async (limits: Record<string, number>) => {
      const existing = queryClient.getQueryData<Budget[]>(k.budgets) ?? [];
      const toKeep = Object.entries(limits).filter(([, cents]) => cents > 0);
      const toRemove = existing.filter((row) => !((limits[row.category] ?? 0) > 0));
      if (toKeep.length) {
        const rows = toKeep.map(([category, cents]) => ({ user_id: userId, category, amount: (cents / 100).toFixed(2) }));
        const { error } = await c.from('budgets').upsert(rows, { onConflict: 'user_id,category' });
        if (error) throw new DataError(error.message, isNetworkProblem(error.message));
      }
      for (const row of toRemove) {
        const { error } = await c.from('budgets').delete().eq('id', row.id).eq('user_id', userId);
        if (error) throw new DataError(error.message, isNetworkProblem(error.message));
      }
      await queryClient.invalidateQueries({ queryKey: k.budgets });
    },
    [c, k, queryClient, userId],
  );

  // ---- categories and payment methods (AC-06) ----
  const saveTaxonomy = useCallback(
    async (kind: 'category' | 'payment', row: Record<string, unknown>) => {
      const table = kind === 'category' ? 'user_categories' : 'user_payment_methods';
      const conflict = kind === 'category' ? 'user_id,category_key' : 'user_id,payment_key';
      const { error } = await c.from(table).upsert({ ...row, user_id: userId }, { onConflict: conflict });
      if (error) {
        if (error.code === '23505') throw new DataError('duplicate');
        throw new DataError(error.message, isNetworkProblem(error.message));
      }
      await queryClient.invalidateQueries({ queryKey: kind === 'category' ? k.categories : k.payments });
    },
    [c, k, queryClient, userId],
  );

  const saveDateFormat = useCallback(
    async (format: DateFormat) => {
      const { error } = await c.from('user_preferences').upsert({ user_id: userId, date_format: format }, { onConflict: 'user_id' });
      if (error) throw new DataError(error.message, isNetworkProblem(error.message));
      queryClient.setQueryData(k.prefs, format);
    },
    [c, k, queryClient, userId],
  );

  // ---- keeping things in step ----
  const flushQueue = useCallback(async (): Promise<number> => {
    if (!navigator.onLine || !userId) return 0;
    let sent = 0;
    for (const item of readQueue(userId)) {
      try {
        const saved = await insert<Expense & Income>(item.kind === 'expense' ? 'expenses' : 'incomes', item.row);
        removeFromQueue(userId, item.tempId);
        if (item.kind === 'expense') patchList<Expense>(k.expenses, (list) => [saved as Expense, ...list].sort(byDateDesc));
        else patchList<Income>(k.incomes, (list) => [saved as Income, ...list].sort(byDateDesc));
        sent += 1;
      } catch (error) {
        if (error instanceof DataError && error.offline) break; // still no connection: try again later
        // The server refused this one (for example a value it does not accept): keep it out of the way so the rest can go
        removeFromQueue(userId, item.tempId);
      }
    }
    if (sent > 0) {
      notifyQueue();
      toast.show('success', t('money.synced', { n: sent }));
    }
    return sent;
  }, [insert, k, patchList, t, toast, userId]);

  /** RC-02: posts schedules that are due (including missed days), once, safely even with several devices open. */
  const processRecurring = useCallback(async (): Promise<number> => {
    if (!navigator.onLine || !userId) return 0;
    const today = todayYmd();
    let added = 0;
    const dueExpenses = (queryClient.getQueryData<RecurringExpense[]>(k.recurring) ?? []).filter((r) => r.active && r.next_due <= today);
    for (const r of dueExpenses) {
      const plan = planDue(r, today);
      if (!plan.dues.length && !plan.finished) continue;
      // Claim the dates first: only one device can move "next due" forward, so a bill is never posted twice
      const claim = await c.from('recurring_expenses').update(plan.finished ? { next_due: plan.next, active: false } : { next_due: plan.next }).eq('id', r.id).eq('next_due', r.next_due).eq('user_id', userId).select();
      if (claim.error || !claim.data || claim.data.length === 0) continue;
      if (plan.dues.length) {
        const rows = plan.dues.map((due) => ({ user_id: userId, amount: r.amount, category: r.category, payment: r.payment, merchant: r.name, note: r.name, created_at: ymdToNoonIso(due) }));
        const inserted = await c.from('expenses').insert(rows).select();
        if (inserted.error) {
          await c.from('recurring_expenses').update({ next_due: r.next_due, active: true }).eq('id', r.id); // put it back
          continue;
        }
        patchList<Expense>(k.expenses, (list) => [...((inserted.data ?? []) as Expense[]), ...list].sort(byDateDesc));
        added += plan.dues.length;
      }
      patchList<RecurringExpense>(k.recurring, (list) => list.map((row) => (row.id === r.id ? { ...row, next_due: plan.next, active: !plan.finished } : row)));
    }
    const dueIncomes = (queryClient.getQueryData<RecurringIncome[]>(k.recurringIncomes) ?? []).filter((r) => r.active && r.next_due <= today);
    for (const r of dueIncomes) {
      const plan = planDue(r, today);
      if (!plan.dues.length) continue;
      const claim = await c.from('recurring_incomes').update({ next_due: plan.next }).eq('id', r.id).eq('next_due', r.next_due).eq('user_id', userId).select();
      if (claim.error || !claim.data || claim.data.length === 0) continue;
      const rows = plan.dues.map((due) => ({ user_id: userId, amount: r.amount, source: r.source, created_at: ymdToNoonIso(due) }));
      const inserted = await c.from('incomes').insert(rows).select();
      if (inserted.error) {
        await c.from('recurring_incomes').update({ next_due: r.next_due }).eq('id', r.id);
        continue;
      }
      patchList<Income>(k.incomes, (list) => [...((inserted.data ?? []) as Income[]), ...list].sort(byDateDesc));
      patchList<RecurringIncome>(k.recurringIncomes, (list) => list.map((row) => (row.id === r.id ? { ...row, next_due: plan.next } : row)));
      added += plan.dues.length;
    }
    if (added > 0) toast.show('info', t('money.recurringPosted', { n: added }));
    return added;
  }, [c, k, patchList, queryClient, t, toast, userId]);

  /** CS-01: adds many records from an import, 200 at a time. Needs a connection (an offline import would overflow the offline queue). */
  const importRows = useCallback(
    async (expenseRows: NewExpense[], incomeRows: NewIncome[]): Promise<number> => {
      if (!navigator.onLine) throw new DataError('offline', true);
      let added = 0;
      for (let start = 0; start < expenseRows.length; start += 200) {
        const chunk = expenseRows.slice(start, start + 200).map((row) => ({ ...row, user_id: userId }));
        const { data, error } = await c.from('expenses').insert(chunk).select();
        if (error) throw new DataError(error.message, isNetworkProblem(error.message));
        patchList<Expense>(k.expenses, (list) => [...((data ?? []) as Expense[]), ...list].sort(byDateDesc));
        added += chunk.length;
      }
      for (let start = 0; start < incomeRows.length; start += 200) {
        const chunk = incomeRows.slice(start, start + 200).map((row) => ({ ...row, user_id: userId }));
        const { data, error } = await c.from('incomes').insert(chunk).select();
        if (error) throw new DataError(error.message, isNetworkProblem(error.message));
        patchList<Income>(k.incomes, (list) => [...((data ?? []) as Income[]), ...list].sort(byDateDesc));
        added += chunk.length;
      }
      return added;
    },
    [c, k, patchList, userId],
  );

  return { addTransaction, updateTransaction, deleteTransaction, restoreTransaction, saveRecurring, deleteRecurring, toggleRecurring, saveBudgets, saveTaxonomy, saveDateFormat, flushQueue, processRecurring, importRows };
}

/** Keeps the app in step with the outside world: sends saved-offline records when the connection returns, and posts due schedules. */
export function useKeepInStep(data: MoneyData, actions: ReturnType<typeof useMoneyActions>) {
  const ready = !data.loading && data.userId !== '';
  const running = useRef(false);
  const { flushQueue, processRecurring } = actions;

  const run = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      await flushQueue();
      await processRecurring();
    } finally {
      running.current = false;
    }
  }, [flushQueue, processRecurring]);

  useEffect(() => {
    if (!ready) return undefined;
    void run();
    const onVisible = () => {
      if (!document.hidden) void run();
    };
    window.addEventListener('online', run);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', run);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [ready, run]);
}

export { clearQueue, mergeCategories, mergePayments };
export type { QueuedRow };
