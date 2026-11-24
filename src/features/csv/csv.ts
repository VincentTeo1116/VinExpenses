// CS-01: reading a CSV export or a bank statement, and writing the app's own CSV. A typed port of legacy/csv-import.js (checked
// against it in tests/ports-parity.test.js). Problems are returned as codes so the screen can word them in the person's language.

export const MAX_ROWS = 2000;
export const MAX_BYTES = 2 * 1024 * 1024;

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const counts = [',', ';', '\t'].map((d): [string, number] => [d, firstLine.split(d).length - 1]);
  counts.sort((a, b) => b[1] - a[1]);
  return (counts[0] as [string, number])[1] > 0 ? (counts[0] as [string, number])[0] : ',';
}

/** RFC 4180 style: quoted cells, doubled quotes, newlines inside quotes. */
export function parseCsv(input: unknown): string[][] {
  const text = String(input || '').replace(/^\uFEFF/, '');
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

type Field = 'date' | 'type' | 'merchant' | 'category' | 'payment' | 'source' | 'note' | 'amount' | 'debit' | 'credit';
const COLUMN_NAMES: Record<Field, string[]> = {
  date: ['date', 'transaction date', 'trans date', 'posting date', 'tarikh', 'value date'],
  type: ['type', 'transaction type'],
  merchant: ['merchant', 'description', 'details', 'transaction description', 'payee', 'name', 'particulars', 'butiran', 'narration', 'reference'],
  category: ['category', 'kategori'],
  payment: ['payment', 'payment method', 'method', 'account'],
  source: ['income source', 'source'],
  note: ['note', 'notes', 'remarks', 'memo', 'catatan'],
  amount: ['amount (rm)', 'amount', 'amount rm', 'value', 'jumlah'],
  debit: ['debit', 'withdrawal', 'withdrawals', 'money out', 'debit amount', 'debit (rm)'],
  credit: ['credit', 'deposit', 'deposits', 'money in', 'credit amount', 'credit (rm)'],
};

export function detectColumns(header: string[]): Partial<Record<Field, number>> {
  const names = header.map((h) => String(h || '').trim().toLowerCase());
  const map: Partial<Record<Field, number>> = {};
  for (const [field, aliases] of Object.entries(COLUMN_NAMES) as [Field, string[]][]) {
    let at = -1;
    for (const alias of aliases) {
      // earlier alias = better match
      at = names.indexOf(alias);
      if (at >= 0) break;
    }
    if (at >= 0) map[field] = at;
  }
  return map;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, mei: 5, jun: 6, jul: 7, aug: 8, ogos: 8, sep: 9, sept: 9, oct: 10, okt: 10, nov: 11, dec: 12, dis: 12 };

function validYmd(y: number, m: number, d: number): boolean {
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}
const ymd = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Day first (Malaysia). Returns YYYY-MM-DD or ''. */
export function parseDate(value: unknown): string {
  const s = String(value || '').trim();
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/))) {
    return validYmd(+(m[1] as string), +(m[2] as string), +(m[3] as string)) ? ymd(+(m[1] as string), +(m[2] as string), +(m[3] as string)) : '';
  }
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:[T\s].*)?$/))) {
    const year = (m[3] as string).length === 2 ? 2000 + +(m[3] as string) : +(m[3] as string);
    return validYmd(year, +(m[2] as string), +(m[1] as string)) ? ymd(year, +(m[2] as string), +(m[1] as string)) : '';
  }
  if ((m = s.match(/^(\d{1,2})[\s-]+([A-Za-z]{3,5})\.?,?[\s-]+(\d{2}|\d{4})$/))) {
    const month = MONTHS[(m[2] as string).toLowerCase()];
    const year = (m[3] as string).length === 2 ? 2000 + +(m[3] as string) : +(m[3] as string);
    return month && validYmd(year, month, +(m[1] as string)) ? ymd(year, month, +(m[1] as string)) : '';
  }
  return '';
}

/** "RM 1,234.50", "(12.00)", "-12.00", "12.00 DR" -> number (sign kept), or NaN. */
export function parseAmount(value: unknown): number {
  let s = String(value ?? '').trim();
  if (!s) return NaN;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (/\bDR\b/i.test(s)) negative = true;
  s = s.replace(/\b(CR|DR)\b/gi, '').replace(/RM|MYR/gi, '').replace(/\s/g, '');
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith('+')) s = s.slice(1);
  if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.'); // 1.234,50
  else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.'); // 12,50
  else s = s.replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
  const n = parseFloat(s);
  return negative ? -n : n;
}

// Spreadsheet apps need a leading ' on text starting with = + - @; the export adds it, so remove it here
const unprotect = (v: unknown) => String(v || '').replace(/^'(?=[=+\-@])/, '').trim();

export interface ImportedRecord {
  line: number;
  type: 'expense' | 'income';
  amount: number;
  date: string;
  merchant: string;
  category: string;
  payment: string;
  source: string;
  note: string;
}
export type SkipReason = 'date' | 'amount' | 'range';
export type Convention = 'type' | 'debitCredit' | 'negative' | 'allIncome' | 'allExpense' | '';
export interface ImportResult {
  records: ImportedRecord[];
  skipped: { line: number; reason: SkipReason }[];
  convention: Convention;
  total: number;
  tooMany: boolean;
  error?: 'noRows' | 'noColumns';
}

/** `positiveIs` says what a plain positive amount means: auto, expense or income. */
export function importRecords(text: string, options: { positiveIs?: 'auto' | 'expense' | 'income' } = {}): ImportResult {
  const rows = parseCsv(text);
  const result: ImportResult = { records: [], skipped: [], convention: '', total: 0, tooMany: false };
  if (rows.length < 2) {
    result.error = 'noRows';
    return result;
  }
  const columns = detectColumns(rows[0] as string[]);
  const hasAmount = columns.amount !== undefined || columns.debit !== undefined || columns.credit !== undefined;
  if (columns.date === undefined || !hasAmount) {
    result.error = 'noColumns';
    return result;
  }

  let body = rows.slice(1);
  if (body.length > MAX_ROWS) {
    body = body.slice(0, MAX_ROWS);
    result.tooMany = true;
  }
  result.total = body.length;

  const cell = (r: string[], field: Field): string => (columns[field] === undefined ? '' : String(r[columns[field] as number] ?? ''));
  const singleAmount = columns.amount !== undefined && columns.debit === undefined && columns.credit === undefined;
  const hasNegatives = singleAmount && !columns.type && body.some((r) => parseAmount(cell(r, 'amount')) < 0);

  let positiveIs = options.positiveIs || 'auto';
  if (positiveIs === 'auto') positiveIs = hasNegatives ? 'income' : 'expense';

  if (columns.type !== undefined) result.convention = 'type';
  else if (!singleAmount) result.convention = 'debitCredit';
  else if (hasNegatives) result.convention = 'negative';
  else result.convention = positiveIs === 'income' ? 'allIncome' : 'allExpense';

  body.forEach((r, i) => {
    const line = i + 2;
    const date = parseDate(cell(r, 'date'));
    if (!date) {
      result.skipped.push({ line, reason: 'date' });
      return;
    }
    let type: 'expense' | 'income' = 'expense';
    let amount = 0;
    const fromDebitCredit = (): boolean => {
      const d = parseAmount(cell(r, 'debit'));
      const c = parseAmount(cell(r, 'credit'));
      if (!isNaN(d) && Math.abs(d) > 0) {
        type = 'expense';
        amount = Math.abs(d);
        return true;
      }
      if (!isNaN(c) && Math.abs(c) > 0) {
        type = 'income';
        amount = Math.abs(c);
        return true;
      }
      return false;
    };
    if (singleAmount || columns.type !== undefined) {
      const raw = parseAmount(cell(r, 'amount'));
      if (isNaN(raw) || raw === 0) {
        // a Debit/Credit file with a Type column is unusual, but try those columns before giving up
        if (!fromDebitCredit()) {
          result.skipped.push({ line, reason: 'amount' });
          return;
        }
      } else {
        amount = Math.abs(raw);
        const typeCell = cell(r, 'type').trim().toLowerCase();
        if (typeCell) type = /^(inc|cr|credit|deposit|in\b)/.test(typeCell) ? 'income' : 'expense';
        else if (hasNegatives) type = raw < 0 ? 'expense' : 'income';
        else type = positiveIs;
      }
    } else if (!fromDebitCredit()) {
      result.skipped.push({ line, reason: 'amount' });
      return;
    }
    amount = Math.round(amount * 100) / 100;
    if (!(amount > 0) || amount > 10000000) {
      result.skipped.push({ line, reason: 'range' });
      return;
    }
    result.records.push({
      line,
      type,
      amount,
      date,
      merchant: unprotect(cell(r, 'merchant')).slice(0, 80),
      category: unprotect(cell(r, 'category')),
      payment: unprotect(cell(r, 'payment')),
      source: unprotect(cell(r, 'source')).slice(0, 60),
      note: unprotect(cell(r, 'note')).slice(0, 200),
    });
  });
  return result;
}

// ---- writing ----
/** A cell that starts with = + - @ would run as a formula in a spreadsheet, so it gets a leading apostrophe. */
export function csvCell(value: unknown): string {
  let text = String(value ?? '');
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export const EXPORT_HEADER = ['Date', 'Type', 'Merchant', 'Category', 'Payment', 'Income source', 'Note', 'Amount (RM)'];
export function toCsv(rows: unknown[][]): string {
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
}
