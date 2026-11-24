// Talks to the miniapp-api function. Every request carries Telegram's signed launch data; the page never sends a user id.
export const ERROR_CODES = ['unauthorized', 'expired', 'not_linked', 'limit', 'invalid', 'not_found', 'not_configured'] as const;
export type ErrorCode = (typeof ERROR_CODES)[number] | 'network' | 'unavailable';

export class MiniApiError extends Error {
  readonly code: ErrorCode;
  readonly field: string;
  readonly status: number;
  constructor(code: ErrorCode, field = '', status = 0) {
    super(code);
    this.name = 'MiniApiError';
    this.code = code;
    this.field = field;
    this.status = status;
  }
}

export interface Choice {
  key: string;
  label: string;
  color?: string;
  active: boolean;
}
export interface Bootstrap {
  ok: true;
  name: string;
  lang: string;
  today: string;
  categories: Choice[];
  payments: Choice[];
  maxOffset: number;
  maxAmount: number;
  maxDaysBack: number;
}
export type Insight = { kind: 'cat'; key: string; up: boolean; pct: number } | { kind: 'weekend'; weekendHeavy: boolean; ratio: number } | { kind: 'pace'; key: string; warn: boolean; projected: number; used: number; day: number };
export interface MonthData {
  offset: number;
  start: string;
  end: string;
  days: number;
  firstWeekday: number;
  total: number;
  count: number;
  previousTotal: number;
  previousCount: number;
  income: number;
  byCategory: [string, number][];
  daily: number[];
  todayIndex: number | null;
  budgets: { key: string; limit: number; used: number }[];
  monthTotals: number[];
  monthStarts: string[];
  streak: number;
  insights: Insight[];
}
export interface Item {
  id: string;
  amount: number | string;
  category: string;
  payment: string;
  merchant: string | null;
  note: string | null;
  created_at: string;
}
export interface Page {
  ok: true;
  items: Item[];
  total: number;
  sum: number;
}
export interface TransactionParams {
  offset: number;
  category: string;
  q: string;
  skip: number;
  limit: number;
}
export interface ExpenseValues {
  amount?: string;
  merchant?: string;
  category?: string;
  payment?: string;
  note?: string;
  date?: string;
}

/** The same calls whether the data is real or the sample preview. */
export interface MiniApi {
  demo?: boolean;
  bootstrap: () => Promise<Bootstrap>;
  month: (offset: number) => Promise<{ ok: true; data: MonthData }>;
  transactions: (params: TransactionParams) => Promise<Page>;
  addExpense: (values: ExpenseValues) => Promise<{ ok: true }>;
  updateExpense: (id: string, values: ExpenseValues) => Promise<{ ok: true }>;
  deleteExpense: (id: string) => Promise<{ ok: true }>;
}

export function createApi(options: { baseUrl: string; anonKey?: string; getInitData: () => string; fetchImpl?: typeof fetch; timeoutMs?: number }): MiniApi {
  const doFetch = options.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? 20000;
  const url = `${String(options.baseUrl || '').replace(/\/+$/, '')}/functions/v1/miniapp-api`;

  async function call<T>(body: Record<string, unknown>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': options.getInitData() || '' };
      if (options.anonKey) headers.apikey = options.anonKey; // the public key: some gateways expect it, it grants nothing here
      let response: Response;
      try {
        response = await doFetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
      } catch {
        throw new MiniApiError('network');
      }
      const data = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; field?: string };
      if (response.ok && data.ok !== false) return data as T;
      const known = (ERROR_CODES as readonly string[]).includes(String(data.error));
      const code: ErrorCode = known ? (data.error as ErrorCode) : response.status === 401 ? 'unauthorized' : response.status === 403 ? 'not_linked' : response.status === 429 ? 'limit' : 'unavailable';
      throw new MiniApiError(code, data.field, response.status);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    bootstrap: () => call<Bootstrap>({ action: 'bootstrap' }),
    month: (offset) => call({ action: 'month', offset }),
    transactions: (params) => call<Page>({ action: 'transactions', ...params }),
    addExpense: (values) => call({ action: 'expense_add', ...values }),
    updateExpense: (id, values) => call({ action: 'expense_update', id, ...values }),
    deleteExpense: (id) => call({ action: 'expense_delete', id }),
  };
}
