// The new TypeScript deposit and loan maths must give the same money as the original file the server still uses (PL-01 … PL-04).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const legacy = require('../legacy/finance-calc.js');
const load = (rel) => import(pathToFileURL(path.join(__dirname, '..', rel)).href);

// A small repeatable random generator, so a failure can be reproduced
function rng(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const pick = (r, list) => list[Math.floor(r() * list.length)];
const between = (r, a, b) => a + Math.floor(r() * (b - a + 1));
const mostly = (r, good, bad) => (r() < 0.93 ? good : pick(r, bad)); // usually valid, sometimes not, so both paths are compared
const dateOf = (r) => `${between(r, 2022, 2030)}-${String(between(r, 1, 12)).padStart(2, '0')}-${String(between(r, 1, 31)).padStart(2, '0')}`;

// Everything except functions, and with errors reduced to the field names (the new code returns codes, the old one sentences)
const plain = (result) => {
    if (!result) return result;
    const out = {};
    for (const [key, value] of Object.entries(result)) if (typeof value !== 'function') out[key] = key === 'errors' ? Object.keys(value).sort() : value;
    return out;
};

test('deposits: 3,000 random inputs give the same result, payouts, tables and chart as the original', async () => {
    const web = await load('src/features/finance/finance.ts');
    const r = rng(42);
    let valid = 0;
    for (let i = 0; i < 3000; i += 1) {
        const input = {
            amount: mostly(r, pick(r, [String(between(r, 1, 5000000)), `${between(r, 1, 900)}.${String(between(r, 0, 99)).padStart(2, '0')}`, '1,000']), ['', 'abc', '0', '100000001', '12.345']),
            rate: mostly(r, pick(r, [`${between(r, 1, 700) / 100}`, '3.875']), ['0', '31', '', 'x']),
            tenureValue: mostly(r, String(between(r, 1, 120)), [String(between(r, 1, 3700)), '', '0', '1.5']),
            tenureUnit: mostly(r, pick(r, ['days', 'months', 'years']), ['bogus']),
            startDate: mostly(r, pick(r, [dateOf(r), '2026-02-28', '2024-02-29']), ['2026-02-30', '', 'nope']),
            maturityDate: mostly(r, '', [dateOf(r), '2026-13-01']),
            payout: mostly(r, pick(r, ['maturity', 'monthly', 'quarterly', 'yearly']), ['weekly']),
            taxRate: mostly(r, pick(r, ['', '0', '10', '24.5']), ['101', 'z']),
            dayBasis: pick(r, [365, 360, '360', 7]),
        };
        const today = dateOf(r);
        const a = legacy.calcFd(input, { today });
        const b = web.calcFd(input, { today });
        assert.deepEqual(plain(b), plain(a), JSON.stringify(input));
        if (!a.ok) continue;
        valid += 1;
        for (const d of [0, 1, 17, a.days, a.days + 5]) assert.equal(b.interestAfter(d), a.interestAfter(d));
        for (const view of ['daily', 'monthly', 'yearly']) {
            const pages = web.fdSchedule(b, view, 0).pageCount;
            assert.equal(pages, legacy.fdSchedule(a, view, 0).pageCount);
            for (const page of [0, pages - 1, 1]) {
                const x = legacy.fdSchedule(a, view, page);
                const y = web.fdSchedule(b, view, page);
                assert.deepEqual(y.rows.map(({ view: _v, label: _l, ...row }) => row), x.rows.map(({ label: _l, ...row }) => row), `${view} ${page} ${JSON.stringify(input)}`);
            }
        }
        assert.deepEqual(web.fdChartSeries(b, 30), legacy.fdChartSeries(a, 30));
    }
    assert.ok(valid > 400, `only ${valid} of 3000 inputs were valid, so the comparison is too thin`);
});

test('loans: 3,000 random inputs give the same instalments, schedule and yearly totals as the original', async () => {
    const web = await load('src/features/finance/finance.ts');
    const r = rng(7);
    let valid = 0;
    for (let i = 0; i < 3000; i += 1) {
        const input = {
            amount: mostly(r, pick(r, [String(between(r, 1, 3000000)), `${between(r, 1, 900)}.${String(between(r, 0, 99)).padStart(2, '0')}`]), ['', '0', 'q']),
            rate: mostly(r, pick(r, [`${between(r, 0, 1500) / 100}`, '0', '2.345']), ['41', '']),
            termValue: mostly(r, String(between(r, 1, 35)), [String(between(r, 1, 500)), '', '0']),
            termUnit: pick(r, ['months', 'years']),
            method: mostly(r, pick(r, ['reducing', 'flat']), ['other']),
            firstPaymentDate: mostly(r, pick(r, [dateOf(r), '2026-01-31', '2024-02-29']), ['']),
            fees: mostly(r, pick(r, ['', '0', '350', '12.5']), ['-1']),
        };
        const a = legacy.calcLoan(input);
        const b = web.calcLoan(input);
        assert.deepEqual(plain(b), plain(a), JSON.stringify(input));
        if (!a.ok) continue;
        valid += 1;
        assert.equal(web.loanSchedule(b, 'monthly', 0).pageCount, legacy.loanSchedule(a, 'monthly', 0).pageCount);
        assert.deepEqual(web.loanSchedule(b, 'yearly', 0).rows, legacy.loanSchedule(a, 'yearly', 0).rows);
        // the schedule really repays the loan
        assert.equal(b.schedule[b.schedule.length - 1].balance, 0);
        assert.ok(Math.abs(b.schedule.reduce((s, row) => s + row.principal, 0) - b.principal) < 0.005);
    }
    assert.ok(valid > 800, `only ${valid} of 3000 inputs were valid`);
});

test('saved items: status, progress and reminders match the original for 1,500 random rows', async () => {
    const web = await load('src/features/finance/finance.ts');
    const r = rng(99);
    for (let i = 0; i < 1500; i += 1) {
        const today = dateOf(r);
        const start = dateOf(r);
        const deposit = {
            id: `d${i}`, name: `FD ${i}`, bank: null, principal: String(between(r, 1000, 90000)), rate: `${between(r, 100, 500) / 100}`,
            start_date: start, tenure_value: between(r, 1, 36), tenure_unit: pick(r, ['months', 'years', 'days']), maturity_date: '',
            payout: pick(r, ['maturity', 'monthly']), tax_rate: pick(r, [0, 10]), day_basis: 365,
            reminders_on: r() > 0.2, reminder_days: pick(r, [[7, 1, 0], [30, 14], [0], []]), status: pick(r, ['open', 'open', 'closed']), interest_recorded: false,
        };
        deposit.maturity_date = legacy.fdAutoMaturity(deposit.start_date, deposit.tenure_value, deposit.tenure_unit) || start;
        const loan = {
            id: `l${i}`, name: `Loan ${i}`, lender: null, principal: String(between(r, 2000, 500000)), rate: `${between(r, 0, 900) / 100}`,
            method: pick(r, ['reducing', 'flat']), term_months: between(r, 3, 120), first_payment_date: start, fees: 0,
            reminders_on: r() > 0.2, reminder_days: pick(r, [[3, 0], [10, 5, 1], []]), status: pick(r, ['open', 'open', 'closed']), paid_through: null,
        };
        const upto = legacy.lastDueBefore(loan, today);
        assert.equal(web.lastDueBefore(loan, today), upto);
        if (r() > 0.5) loan.paid_through = upto || null;
        assert.equal(web.fdStatus(deposit, today), legacy.fdStatus(deposit, today));
        for (const autoPaid of [false, true]) {
            const x = legacy.loanProgress(loan, today, { autoPaid });
            const y = web.loanProgress(loan, today, { autoPaid });
            assert.deepEqual(plain(Object.assign({}, y, { result: undefined })), plain(Object.assign({}, x, { result: undefined })));
        }
        assert.deepEqual(web.dueReminders([deposit], [loan], today, { autoPaidLoanIds: r() > 0.5 ? [loan.id] : [] }).length >= 0, true);
        const ids = r() > 0.5 ? [loan.id] : [];
        assert.deepEqual(web.dueReminders([deposit], [loan], today, { autoPaidLoanIds: ids }), legacy.dueReminders([deposit], [loan], today, { autoPaidLoanIds: ids }));
        for (const days of [-3, 0, 1, 5, 40]) assert.equal(web.milestoneFor(days, [7, 1, 0]), legacy.milestoneFor(days, [7, 1, 0]));
    }
});

test('reminder days: the same sentences are accepted and refused', async () => {
    const web = await load('src/features/finance/finance.ts');
    for (const raw of ['7, 1, 0', '', '3;1', 'a', '61', '1,2,3,4,5,6', '0', [3, 0], '5 5 5', '  ']) {
        const x = legacy.readLeadDays(raw, [7, 1, 0]);
        const y = web.readLeadDays(raw, [7, 1, 0]);
        assert.equal(Boolean(y.error), Boolean(x.error), String(raw));
        assert.deepEqual(y.days, x.days, String(raw));
    }
});
