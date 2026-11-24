// The rows as the database stores them. Amounts arrive as text ("12.50"); they are only ever added up as whole cents.
import type { Frequency } from '@/lib/dates';

export interface Expense {
  id: string;
  user_id: string;
  amount: string;
  category: string;
  payment: string;
  merchant: string | null;
  note: string | null;
  created_at: string;
}

export interface Income {
  id: string;
  user_id: string;
  amount: string;
  source: string;
  created_at: string;
}

export interface RecurringExpense {
  id: string;
  user_id: string;
  name: string;
  amount: string;
  category: string;
  payment: string;
  frequency: Frequency;
  start_date: string;
  next_due: string;
  end_date: string | null;
  loan_id: string | null;
  active: boolean;
}

export interface RecurringIncome {
  id: string;
  user_id: string;
  source: string;
  amount: string;
  frequency: Frequency;
  start_date: string;
  next_due: string;
  active: boolean;
}

export interface Budget {
  id: string;
  user_id: string;
  /** A category key, or "all" for the overall monthly limit. */
  category: string;
  amount: string;
}

export interface TaxonomyRow {
  user_id: string;
  label: string;
  icon: string;
  color: string;
  active: boolean;
  is_builtin: boolean;
  sort_order: number;
}
export interface CategoryRow extends TaxonomyRow {
  category_key: string;
}
export interface PaymentRow extends TaxonomyRow {
  payment_key: string;
}

/** What the add sheet and the lists work with: one shape for both kinds of money. */
export type Kind = 'expense' | 'income';
