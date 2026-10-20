// Run with:  node --test "tests/*.test.js"
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../csv-import.js');

test('parser handles quotes, doubled quotes, newlines in cells, BOM and CRLF', () => {
    const rows = C.parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n"line1\nline2",z\r\n');
    assert.deepEqual(rows, [['a', 'b'], ['x, y', 'say "hi"'], ['line1\nline2', 'z']]);
});

test('semicolon and tab files are detected', () => {
    assert.deepEqual(C.parseCsv('a;b\n1;2'), [['a', 'b'], ['1', '2']]);
    assert.deepEqual(C.parseCsv('a\tb\n1\t2'), [['a', 'b'], ['1', '2']]);
});

test('dates: day first, several shapes, impossible dates rejected', () => {
    assert.equal(C.parseDate('2026-09-08'), '2026-09-08');
    assert.equal(C.parseDate('08/09/2026'), '2026-09-08');
    assert.equal(C.parseDate('8-9-26'), '2026-09-08');
    assert.equal(C.parseDate('8 Sep 2026'), '2026-09-08');
    assert.equal(C.parseDate('08 Ogos 2026'), '2026-08-08');
    assert.equal(C.parseDate('2026-09-08T10:00:00Z'), '2026-09-08');
    assert.equal(C.parseDate('31/02/2026'), '');
    assert.equal(C.parseDate('hello'), '');
});

test('amounts: currency, thousands, brackets, signs, comma decimals', () => {
    assert.equal(C.parseAmount('RM 1,234.50'), 1234.5);
    assert.equal(C.parseAmount('(12.00)'), -12);
    assert.equal(C.parseAmount('-12.00'), -12);
    assert.equal(C.parseAmount('12.00 DR'), -12);
    assert.equal(C.parseAmount('12,50'), 12.5);
    assert.equal(C.parseAmount('1.234,50'), 1234.5);
    assert.ok(Number.isNaN(C.parseAmount('abc')));
    assert.ok(Number.isNaN(C.parseAmount('')));
});

test('own export round-trips (Type column, protected text)', () => {
    const csv = '﻿Date,Type,Merchant,Category,Payment,Income source,Note,Amount (RM)\r\n' +
        '"2026-09-08","expense","99 Speedmart","Shopping","Card","","","12.50"\r\n' +
        '"2026-09-01","income","","","","Salary","","3000.00"\r\n' +
        '"2026-09-02","expense","\'=SUM(A1)","Food","Cash","","\'+note","5.00"\r\n';
    const r = C.importRecords(csv);
    assert.equal(r.records.length, 3);
    assert.deepEqual(r.records.map(x => x.type), ['expense', 'income', 'expense']);
    assert.equal(r.records[0].merchant, '99 Speedmart');
    assert.equal(r.records[1].source, 'Salary');
    assert.equal(r.records[2].merchant, '=SUM(A1)');
    assert.equal(r.records[2].note, '+note');
});

test('bank statement with Debit and Credit columns', () => {
    const csv = 'Transaction Date,Description,Debit,Credit,Balance\n08/09/2026,GRAB*FOOD,25.40,,1000\n09/09/2026,SALARY,,3000.00,4000\n10/09/2026,,,,\n';
    const r = C.importRecords(csv);
    assert.equal(r.records.length, 2);
    assert.deepEqual(r.records.map(x => [x.type, x.amount]), [['expense', 25.4], ['income', 3000]]);
    assert.equal(r.skipped.length, 1);
});

test('single Amount column: negatives mean spending when the file has negatives', () => {
    const r = C.importRecords('Date,Description,Amount\n2026-09-01,Coffee,-8.00\n2026-09-02,Refund,20.00\n');
    assert.deepEqual(r.records.map(x => x.type), ['expense', 'income']);
});

test('single Amount column with no negatives: everything is spending unless told otherwise', () => {
    const csv = 'Date,Description,Amount\n2026-09-01,Coffee,8.00\n2026-09-02,Lunch,12.00\n';
    assert.deepEqual(C.importRecords(csv).records.map(x => x.type), ['expense', 'expense']);
    assert.deepEqual(C.importRecords(csv, { positiveIs: 'income' }).records.map(x => x.type), ['income', 'income']);
});

test('bad rows are skipped with a reason, good rows still import', () => {
    const r = C.importRecords('Date,Amount\nnot a date,5\n2026-09-01,abc\n2026-09-01,5\n');
    assert.equal(r.records.length, 1);
    assert.deepEqual(r.skipped.map(s => s.reason), ['unreadable date', 'no amount']);
});

test('files without the needed columns give a clear error', () => {
    assert.match(C.importRecords('Foo,Bar\n1,2\n').error, /Date column/);
    assert.match(C.importRecords('Date,Amount\n').error, /no rows/);
});

test('huge files are capped', () => {
    const lines = ['Date,Amount'];
    for (let i = 0; i < C.MAX_ROWS + 50; i++) lines.push('2026-09-01,1.00');
    const r = C.importRecords(lines.join('\n'));
    assert.equal(r.records.length, C.MAX_ROWS);
    assert.equal(r.tooMany, true);
});
