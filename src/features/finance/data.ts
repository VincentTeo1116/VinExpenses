// PL-03: saved fixed deposits and loans. Same rules as the money data: every read and write is limited to the signed-in person.
import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useAuth } from '@/app/AuthProvider';
import { ymdToNoonIso } from '@/lib/dates';
import { DataError, useMoneyActions } from '@/features/money/data';
import { calcFd, fdInputFromRow, type DepositRow, type LoanSaved } from './finance';

const isNetworkProblem = (message: string) => /failed to fetch|network|load failed|timeout|offline/i.test(message);

export interface FinanceData {
  loading: boolean;
  failed: boolean;
  reload: () => void;
  deposits: DepositRow[];
  loans: LoanSaved[];
}
const EMPTY: never[] = [];

export function useFinanceData(): FinanceData {
  const { client, session } = useAuth();
  const userId = session?.user?.id ?? '';
  const c = client as SupabaseClient;
  const enabled = Boolean(userId && client);
  const read = async <T,>(table: string, column: string): Promise<T[]> => {
    const { data, error } = await c.from(table).select('*').order(column, { ascending: true }).limit(1000);
    if (error) throw new DataError(error.message, isNetworkProblem(error.message));
    return (data ?? []) as T[];
  };
  const deposits = useQuery({ queryKey: ['deposits', userId], enabled, queryFn: () => read<DepositRow>('fixed_deposits', 'maturity_date') });
  const loans = useQuery({ queryKey: ['loans', userId], enabled, queryFn: () => read<LoanSaved>('loans', 'first_payment_date') });
  return {
    loading: enabled && (deposits.isPending || loans.isPending),
    failed: deposits.isError || loans.isError,
    reload: () => {
      void deposits.refetch();
      void loans.refetch();
    },
    deposits: deposits.data ?? EMPTY,
    loans: loans.data ?? EMPTY,
  };
}

export type DepositToSave = Omit<DepositRow, 'user_id'>;
export type LoanToSave = Omit<LoanSaved, 'user_id'> & { instalment: number };

export function useFinanceActions() {
  const { client, session } = useAuth();
  const queryClient = useQueryClient();
  const money = useMoneyActions();
  const userId = session?.user?.id ?? '';
  const c = client as SupabaseClient;
  const keyOf = useMemo(() => ({ fixed_deposits: ['deposits', userId] as const, loans: ['loans', userId] as const }), [userId]);

  const fail = (error: { message: string }): never => {
    throw new DataError(error.message, isNetworkProblem(error.message) || !navigator.onLine);
  };

  const put = useCallback(
    <T extends { id: string }>(table: 'fixed_deposits' | 'loans', row: T) => {
      queryClient.setQueryData<T[]>(keyOf[table], (list) => {
        const rows = list ?? [];
        return rows.some((r) => r.id === row.id) ? rows.map((r) => (r.id === row.id ? row : r)) : [...rows, row];
      });
    },
    [keyOf, queryClient],
  );

  /** Adds a new item, or replaces one with the same id (an edit). */
  const save = useCallback(
    async <T extends { id: string }>(table: 'fixed_deposits' | 'loans', row: T): Promise<T> => {
      const { data, error } = await c.from(table).upsert({ ...row, user_id: userId, updated_at: new Date().toISOString() }, { onConflict: 'id' }).select().single();
      if (error) fail(error);
      put(table, data as T);
      return data as T;
    },
    [c, put, userId],
  );

  const setStatus = useCallback(
    async (table: 'fixed_deposits' | 'loans', id: string, status: 'open' | 'closed') => {
      const { data, error } = await c.from(table).update({ status, updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', userId).select().single();
      if (error) fail(error);
      put(table, data as { id: string });
    },
    [c, put, userId],
  );

  const remove = useCallback(
    async (table: 'fixed_deposits' | 'loans', id: string) => {
      const { error } = await c.from(table).delete().eq('id', id).eq('user_id', userId);
      if (error) fail(error);
      queryClient.setQueryData<{ id: string }[]>(keyOf[table], (list) => (list ?? []).filter((r) => r.id !== id));
    },
    [c, keyOf, queryClient, userId],
  );

  /** Marks every instalment up to and including this date as paid (or clears it with null). */
  const markPaidThrough = useCallback(
    async (id: string, paidThrough: string | null) => {
      const { data, error } = await c.from('loans').update({ paid_through: paidThrough, updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', userId).select().single();
      if (error) fail(error);
      put('loans', data as LoanSaved);
    },
    [c, put, userId],
  );

  /** Adds the interest of a matured deposit to income, once. The flag is claimed first, so a second device cannot add it again. */
  const recordInterest = useCallback(
    async (row: DepositRow): Promise<'recorded' | 'already' | 'nothing'> => {
      const calc = calcFd(fdInputFromRow(row));
      if (!calc.ok || calc.netInterest <= 0) return 'nothing';
      if (!navigator.onLine) throw new DataError('offline', true);
      const claim = await c.from('fixed_deposits').update({ interest_recorded: true, updated_at: new Date().toISOString() }).eq('id', row.id).eq('user_id', userId).eq('interest_recorded', false).select();
      if (claim.error) fail(claim.error);
      if (!claim.data || claim.data.length === 0) {
        put('fixed_deposits', { ...row, interest_recorded: true });
        return 'already';
      }
      try {
        await money.addTransaction('income', { amount: calc.netInterest.toFixed(2), source: `FD interest: ${row.name}`.slice(0, 60), created_at: ymdToNoonIso(row.maturity_date) });
      } catch (error) {
        await c.from('fixed_deposits').update({ interest_recorded: false }).eq('id', row.id).eq('user_id', userId); // put it back so it can be tried again
        throw error;
      }
      put('fixed_deposits', claim.data[0] as DepositRow);
      return 'recorded';
    },
    [c, money, put, userId],
  );

  return { save, setStatus, remove, markPaidThrough, recordInterest };
}
