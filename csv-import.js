// === CSV IMPORT ===
// Pure functions (no DOM, no network) that turn a CSV file's text into expense/income records.
// Understands this app's own export and typical bank-statement layouts.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CsvImport = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const MAX_ROWS = 2000;

    // --- RFC 4180 style parser: quoted cells, doubled quotes, newlines inside quotes ---
    function detectDelimiter(text) {
        const firstLine = text.split(/\r?\n/, 1)[0] || '';
        const counts = [',', ';', '\t'].map(d => [d, firstLine.split(d).length - 1]);
        counts.sort((a, b) => b[1] - a[1]);
        return counts[0][1] > 0 ? counts[0][0] : ',';
    }

    function parseCsv(input) {
        const text = String(input || '').replace(/^﻿/, '');
        const delimiter = detectDelimiter(text);
        const rows = [];
        let row = [], cell = '', inQuotes = false;
        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            if (inQuotes) {
                if (ch === '"') {
                    if (text[i + 1] === '"') { cell += '"'; i++; }
                    else inQuotes = false;
                } else cell += ch;
            } else if (ch === '"' && cell === '') {
                inQuotes = true;
            } else if (ch === delimiter) {
                row.push(cell); cell = '';
            } else if (ch === '\n' || ch === '\r') {
                if (ch === '\r' && text[i + 1] === '\n') i++;
                row.push(cell); cell = '';
                if (row.some(c => c.trim() !== '')) rows.push(row);
                row = [];
            } else cell += ch;
        }
        row.push(cell);
        if (row.some(c => c.trim() !== '')) rows.push(row);
        return rows;
    }

    // --- column detection ---
    const COLUMN_NAMES = {
        date: ['date', 'transaction date', 'trans date', 'posting date', 'tarikh', 'value date'],
        type: ['type', 'transaction type'],
        merchant: ['merchant', 'description', 'details', 'transaction description', 'payee', 'name', 'particulars', 'butiran', 'narration', 'reference'],
        category: ['category', 'kategori'],
        payment: ['payment', 'payment method', 'method', 'account'],
        source: ['income source', 'source'],
        note: ['note', 'notes', 'remarks', 'memo', 'catatan'],
        amount: ['amount (rm)', 'amount', 'amount rm', 'value', 'jumlah'],
        debit: ['debit', 'withdrawal', 'withdrawals', 'money out', 'debit amount', 'debit (rm)'],
        credit: ['credit', 'deposit', 'deposits', 'money in', 'credit amount', 'credit (rm)']
    };

    function detectColumns(header) {
        const names = header.map(h => String(h || '').trim().toLowerCase());
        const map = {};
        for (const [field, aliases] of Object.entries(COLUMN_NAMES)) {
            let at = -1;
            for (const alias of aliases) { // earlier alias = better match
                at = names.indexOf(alias);
                if (at >= 0) break;
            }
            if (at >= 0) map[field] = at;
        }
        return map;
    }

    // --- values ---
    const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, mei: 5, jun: 6, jul: 7, aug: 8, ogos: 8, sep: 9, sept: 9, oct: 10, okt: 10, nov: 11, dec: 12, dis: 12 };

    function validYmd(y, m, d) {
        const date = new Date(y, m - 1, d);
        return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
    }
    const ymd = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

    // Day first (Malaysia). Returns YYYY-MM-DD or ''.
    function parseDate(value) {
        const s = String(value || '').trim();
        let m;
        if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/))) {
            return validYmd(+m[1], +m[2], +m[3]) ? ymd(+m[1], +m[2], +m[3]) : '';
        }
        if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:[T\s].*)?$/))) {
            const year = m[3].length === 2 ? 2000 + +m[3] : +m[3];
            return validYmd(year, +m[2], +m[1]) ? ymd(year, +m[2], +m[1]) : '';
        }
        if ((m = s.match(/^(\d{1,2})[\s-]+([A-Za-z]{3,5})\.?,?[\s-]+(\d{2}|\d{4})$/))) {
            const month = MONTHS[m[2].toLowerCase()];
            const year = m[3].length === 2 ? 2000 + +m[3] : +m[3];
            return month && validYmd(year, month, +m[1]) ? ymd(year, month, +m[1]) : '';
        }
        return '';
    }

    // "RM 1,234.50", "(12.00)", "-12.00", "12.00 DR" -> number (sign kept), or NaN
    function parseAmount(value) {
        let s = String(value ?? '').trim();
        if (!s) return NaN;
        let negative = false;
        if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
        if (/\bDR\b/i.test(s)) negative = true;
        s = s.replace(/\b(CR|DR)\b/gi, '').replace(/RM|MYR/gi, '').replace(/\s/g, '');
        if (s.startsWith('-')) { negative = !negative; s = s.slice(1); }
        else if (s.startsWith('+')) s = s.slice(1);
        if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.'); // 1.234,50
        else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.');                              // 12,50
        else s = s.replace(/,/g, '');
        if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
        const n = parseFloat(s);
        return negative ? -n : n;
    }

    // Spreadsheet apps need a leading ' on text starting with = + - @; the export adds it, so remove it here
    const unprotect = (v) => String(v || '').replace(/^'(?=[=+\-@])/, '').trim();

    // --- main entry ---
    // options.positiveIs: 'auto' | 'expense' | 'income' decides what an unsigned/positive single Amount column means
    function importRecords(text, options = {}) {
        const rows = parseCsv(text);
        const result = { records: [], skipped: [], convention: '', total: 0, tooMany: false };
        if (rows.length < 2) { result.error = 'The file has no rows to import.'; return result; }

        const columns = detectColumns(rows[0]);
        const hasAmount = columns.amount !== undefined || columns.debit !== undefined || columns.credit !== undefined;
        if (columns.date === undefined || !hasAmount) {
            result.error = 'I could not find a Date column and an Amount (or Debit/Credit) column in the first row.';
            return result;
        }

        let body = rows.slice(1);
        if (body.length > MAX_ROWS) { body = body.slice(0, MAX_ROWS); result.tooMany = true; }
        result.total = body.length;

        const cell = (r, field) => columns[field] === undefined ? '' : String(r[columns[field]] ?? '');
        const singleAmount = columns.amount !== undefined && columns.debit === undefined && columns.credit === undefined;
        const hasNegatives = singleAmount && !columns.type && body.some(r => parseAmount(cell(r, 'amount')) < 0);

        let positiveIs = options.positiveIs || 'auto';
        if (positiveIs === 'auto') positiveIs = hasNegatives ? 'income' : 'expense';

        if (columns.type !== undefined) result.convention = 'Using the Type column to tell expenses from income.';
        else if (!singleAmount) result.convention = 'Debit = expense, credit = income.';
        else if (hasNegatives) result.convention = 'Negative amounts are expenses, positive amounts are income.';
        else result.convention = positiveIs === 'income' ? 'All amounts are treated as income.' : 'All amounts are treated as expenses.';

        body.forEach((r, i) => {
            const line = i + 2;
            const date = parseDate(cell(r, 'date'));
            if (!date) return result.skipped.push({ line, reason: 'unreadable date' });

            let type, amount;
            if (singleAmount || columns.type !== undefined) {
                const raw = parseAmount(cell(r, 'amount'));
                if (isNaN(raw) || raw === 0) {
                    // a Debit/Credit file with a Type column is unusual, but try those columns before giving up
                    const d = parseAmount(cell(r, 'debit')), c = parseAmount(cell(r, 'credit'));
                    if (!isNaN(d) && Math.abs(d) > 0) { type = 'expense'; amount = Math.abs(d); }
                    else if (!isNaN(c) && Math.abs(c) > 0) { type = 'income'; amount = Math.abs(c); }
                    else return result.skipped.push({ line, reason: 'no amount' });
                } else {
                    amount = Math.abs(raw);
                    const typeCell = cell(r, 'type').trim().toLowerCase();
                    if (typeCell) type = /^(inc|cr|credit|deposit|in\b)/.test(typeCell) ? 'income' : 'expense';
                    else if (hasNegatives) type = raw < 0 ? 'expense' : 'income';
                    else type = positiveIs;
                }
            } else {
                const d = parseAmount(cell(r, 'debit')), c = parseAmount(cell(r, 'credit'));
                if (!isNaN(d) && Math.abs(d) > 0) { type = 'expense'; amount = Math.abs(d); }
                else if (!isNaN(c) && Math.abs(c) > 0) { type = 'income'; amount = Math.abs(c); }
                else return result.skipped.push({ line, reason: 'no amount' });
            }
            amount = Math.round(amount * 100) / 100;
            if (!(amount > 0) || amount > 10000000) return result.skipped.push({ line, reason: 'amount out of range' });

            result.records.push({
                line, type, amount, date,
                merchant: unprotect(cell(r, 'merchant')).slice(0, 80),
                category: unprotect(cell(r, 'category')),
                payment: unprotect(cell(r, 'payment')),
                source: unprotect(cell(r, 'source')).slice(0, 60),
                note: unprotect(cell(r, 'note')).slice(0, 200)
            });
        });
        return result;
    }

    return { parseCsv, detectColumns, parseDate, parseAmount, importRecords, MAX_ROWS };
});
