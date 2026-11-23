// Run with:  node --test "tests/*.test.js"
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const F = require('../finance-calc.js');

const fd = (extra = {}) => ({ amount: '10000', rate: '3.5', tenureValue: '90', tenureUnit: 'days', startDate: '2026-01-01', payout: 'maturity', ...extra });
const loan = (extra = {}) => ({ amount: '100000', rate: '4.5', termValue: '30', termUnit: 'years', method: 'reducing', firstPaymentDate: '2026-01-15', ...extra });
const sum = (rows, key) => Math.round(rows.reduce((s, r) => s + r[key] * 100, 0)) / 100;

// Dates Section
test('dates: month arithmetic clamps to the month end, also across leap years', () => {
    assert.equal(F.addMonths('2026-01-31', 1), '2026-02-28');
    assert.equal(F.addMonths('2028-01-31', 1), '2028-02-29');
    assert.equal(F.addMonths('2026-01-31', 2), '2026-03-31');
    assert.equal(F.addMonths('2026-11-30', 3), '2027-02-28');
    assert.equal(F.addMonths('2028-02-29', 12), '2029-02-28');
    assert.equal(F.addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(F.daysBetween('2028-02-01', '2028-03-01'), 29);
    assert.equal(F.isDate('2026-02-30'), false);
    assert.equal(F.isDate('26-02-01'), false);
});

// Fixed deposit Section
test('FD: RM10,000 at 3.5% for 90 days earns RM86.30', () => {
    const r = F.calcFd(fd(), { today: '2026-02-01' });
    assert.equal(r.ok, true);
    assert.equal(r.days, 90);
    assert.equal(r.maturityDate, '2026-04-01');
    assert.equal(r.grossInterest, 86.30);
    assert.equal(r.maturityAmount, 10086.30);
    assert.ok(Math.abs(r.effectiveYield - 3.5) < 0.01);
    assert.equal(r.daysLeft, 59);
    assert.equal(r.daysElapsed, 31);
    assert.equal(r.earnedSoFar, 29.73);
});

test('FD: monthly payout pays by actual days and adds up exactly; tax comes off interest only', () => {
    const r = F.calcFd(fd({ rate: '4', tenureValue: '365', startDate: '2026-01-31', payout: 'monthly', taxRate: '10' }));
    assert.equal(r.grossInterest, 400);
    assert.equal(r.tax, 40);
    assert.equal(r.netInterest, 360);
    assert.equal(r.maturityAmount, 10360);
    assert.equal(r.payouts.length, 12);
    assert.equal(r.payouts[0].date, '2026-02-28'); // the 31st falls on the last day of February
    assert.equal(r.payouts[1].date, '2026-03-31');
    assert.equal(r.payouts.at(-1).date, r.maturityDate);
    assert.equal(sum(r.payouts, 'gross'), 400);
    assert.equal(sum(r.payouts, 'tax'), 40);
    assert.equal(sum(r.payouts, 'net'), 360);
});

test('FD: quarterly and yearly payout, and a tenure shorter than one payout period', () => {
    const q = F.calcFd(fd({ tenureValue: '12', tenureUnit: 'months', payout: 'quarterly' }));
    assert.deepEqual(q.payouts.map((p) => p.date), ['2026-04-01', '2026-07-01', '2026-10-01', '2027-01-01']);
    const y = F.calcFd(fd({ tenureValue: '3', tenureUnit: 'years', payout: 'yearly' }));
    assert.equal(y.payouts.length, 3);
    assert.equal(sum(y.payouts, 'gross'), y.grossInterest);
    const short = F.calcFd(fd({ tenureValue: '2', tenureUnit: 'months', payout: 'quarterly' }));
    assert.equal(short.payouts.length, 1);
    assert.equal(short.payouts[0].date, short.maturityDate);
});

test('FD: tenure in months and years, a typed maturity date wins, and the 360-day basis', () => {
    assert.equal(F.calcFd(fd({ tenureValue: '3', tenureUnit: 'months', startDate: '2026-11-30' })).maturityDate, '2027-02-28');
    assert.equal(F.calcFd(fd({ tenureValue: '1', tenureUnit: 'years', startDate: '2028-02-29' })).maturityDate, '2029-02-28');
    const manual = F.calcFd(fd({ maturityDate: '2026-04-11' }));
    assert.equal(manual.days, 100);
    assert.equal(manual.maturityOverridden, true);
    assert.equal(manual.autoMaturityDate, '2026-04-01');
    assert.equal(F.calcFd(fd()).maturityOverridden, false);
    assert.equal(F.calcFd(fd({ dayBasis: 360 })).grossInterest, 87.50);
});

test('FD: a leap year still divides by 365, and a very large deposit stays exact', () => {
    const leap = F.calcFd(fd({ rate: '3.65', tenureValue: '366', startDate: '2028-01-01' }));
    assert.equal(leap.days, 366);
    assert.equal(leap.grossInterest, 366);
    const big = F.calcFd(fd({ amount: '100000000', rate: '3.333', tenureValue: '3650' }));
    assert.equal(big.grossInterest, 33330000);
});

test('FD: validation explains every bad field and never returns a number', () => {
    const r = F.calcFd({ amount: '', rate: 'abc', tenureValue: '0', tenureUnit: 'months', startDate: 'nope' });
    assert.equal(r.ok, false);
    assert.deepEqual(Object.keys(r.errors).sort(), ['amount', 'rate', 'startDate', 'tenureValue']);
    assert.match(F.calcFd(fd({ amount: '-5' })).errors.amount, /number|at least/);
    assert.match(F.calcFd(fd({ amount: '0.5' })).errors.amount, /at least 1/);
    assert.match(F.calcFd(fd({ amount: '100000001' })).errors.amount, /or less/);
    assert.match(F.calcFd(fd({ amount: '10.005' })).errors.amount, /2 decimal/);
    assert.match(F.calcFd(fd({ rate: '0' })).errors.rate, /more than 0/);
    assert.match(F.calcFd(fd({ rate: '31' })).errors.rate, /30 or less/);
    assert.match(F.calcFd(fd({ tenureValue: '1.5' })).errors.tenureValue, /whole number/);
    assert.match(F.calcFd(fd({ tenureValue: '121', tenureUnit: 'months' })).errors.tenureValue, /120 or less/);
    assert.match(F.calcFd(fd({ maturityDate: '2025-12-31' })).errors.maturityDate, /after the start/);
    assert.match(F.calcFd(fd({ maturityDate: '2040-01-01' })).errors.maturityDate, /10 years/);
    assert.match(F.calcFd(fd({ taxRate: '101' })).errors.taxRate, /100 or less/);
    assert.equal(F.calcFd(fd({ amount: '1e5' })).ok, false, 'scientific notation is rejected, not guessed');
    assert.equal(F.calcFd(fd({ amount: '10,000.50' })).principal, 10000.5, 'thousands separators are accepted');
});

test('FD schedule: daily, monthly and yearly rows add up to the total, in pages', () => {
    const r = F.calcFd(fd({ rate: '4', tenureValue: '14', tenureUnit: 'months', payout: 'monthly' }));
    const monthly = F.fdSchedule(r, 'monthly', 0);
    assert.equal(monthly.total, 14);
    assert.equal(monthly.pageCount, 2);
    assert.equal(monthly.rows.length, 12);
    const all = [...monthly.rows, ...F.fdSchedule(r, 'monthly', 1).rows];
    assert.equal(sum(all, 'interest'), r.grossInterest);
    assert.equal(sum(all, 'payout'), r.netInterest);
    assert.equal(all.at(-1).cumulative, r.grossInterest);

    const daily = F.fdSchedule(r, 'daily', 0);
    assert.equal(daily.total, r.days);
    assert.equal(daily.rows.length, 31);
    let dailyTotal = 0;
    for (let p = 0; p < daily.pageCount; p++) dailyTotal += sum(F.fdSchedule(r, 'daily', p).rows, 'interest') * 100;
    assert.equal(Math.round(dailyTotal) / 100, r.grossInterest);

    const yearly = F.fdSchedule(r, 'yearly', 0);
    assert.equal(yearly.rows.length, 2);
    assert.equal(sum(yearly.rows, 'interest'), r.grossInterest);
    assert.equal(F.fdSchedule(r, 'daily', 999).page, daily.pageCount - 1, 'a page past the end is clamped');
    assert.deepEqual(F.fdSchedule({ ok: false }, 'daily', 0).rows, []);
});

test('FD chart: starts at zero, ends at the total interest, never more points than asked', () => {
    const r = F.calcFd(fd({ tenureValue: '10', tenureUnit: 'years' }));
    const points = F.fdChartSeries(r, 40);
    assert.equal(points.length, 40);
    assert.equal(points[0].value, 0);
    assert.equal(points.at(-1).value, r.grossInterest);
    assert.equal(F.fdChartSeries(F.calcFd(fd({ tenureValue: '3' })), 40).length, 4);
});

// Loans Section
test('loan, reducing balance: RM100,000 at 4.5% over 30 years is RM506.69 a month and ends at exactly zero', () => {
    const r = F.calcLoan(loan());
    assert.equal(r.ok, true);
    assert.equal(r.months, 360);
    assert.equal(r.instalment, 506.69);
    assert.equal(r.schedule.length, 360);
    assert.equal(r.schedule.at(-1).balance, 0);
    assert.equal(sum(r.schedule, 'principal'), 100000);
    assert.equal(sum(r.schedule, 'interest'), r.totalInterest);
    assert.equal(sum(r.schedule, 'payment'), r.totalPayments);
    assert.equal(r.totalPayments, 100000 + r.totalInterest);
    // paying a whole-sen instalment every month lands within a few ringgit of the textbook figure (82,406.71)
    assert.ok(Math.abs(r.totalInterest - 82406.71) < 5, String(r.totalInterest));
    assert.equal(r.effectiveRate, 4.5);
    assert.equal(r.costPerMonth, 506.69);
    assert.equal(r.costPerYear, 6080.28);
    assert.equal(r.costPerDay, 16.66);
    assert.equal(r.lastPaymentDate, '2055-12-15');
});

test('loan, flat rate: RM50,000 at 3% over 5 years is RM958.33 a month, RM7,500 interest, about 5.64% effective', () => {
    const r = F.calcLoan(loan({ amount: '50000', rate: '3', termValue: '5', method: 'flat', fees: '200' }));
    assert.equal(r.instalment, 958.33);
    assert.equal(r.totalInterest, 7500);
    assert.equal(r.totalPayments, 57500);
    assert.equal(r.totalCost, 57700);
    assert.equal(r.lastInstalment, 958.53); // the last one absorbs the rounding
    assert.ok(Math.abs(r.effectiveRate - 5.64) < 0.01, String(r.effectiveRate));
    assert.equal(r.schedule.at(-1).balance, 0);
    assert.equal(sum(r.schedule, 'principal'), 50000);
    assert.equal(sum(r.schedule, 'interest'), 7500);
    assert.equal(r.yearly.length, 5);
    assert.equal(sum(r.yearly, 'payment'), 57500);
});

test('loan: a 0% loan, month-end due dates, a 40-year term and an amount too small to repay', () => {
    const zero = F.calcLoan(loan({ amount: '1200', rate: '0', termValue: '12', termUnit: 'months' }));
    assert.equal(zero.instalment, 100);
    assert.equal(zero.totalInterest, 0);
    assert.equal(zero.schedule.at(-1).balance, 0);

    const monthEnd = F.calcLoan(loan({ termValue: '1', firstPaymentDate: '2027-12-31' }));
    assert.deepEqual(monthEnd.schedule.slice(0, 4).map((r) => r.date), ['2027-12-31', '2028-01-31', '2028-02-29', '2028-03-31']);

    const long = F.calcLoan(loan({ termValue: '40' }));
    assert.equal(long.schedule.length, 480);
    assert.equal(long.schedule.at(-1).balance, 0);
    assert.ok(long.schedule.every((r) => r.payment > 0 && r.principal >= 0 && r.interest >= 0));

    assert.match(F.calcLoan(loan({ amount: '1', rate: '5', termValue: '480', termUnit: 'months', method: 'flat' })).errors.amount, /too small/);
});

test('loan: validation, including a method that must be chosen', () => {
    const r = F.calcLoan({ amount: '', rate: '', termValue: '', termUnit: 'years', method: '', firstPaymentDate: '' });
    assert.equal(r.ok, false);
    assert.deepEqual(Object.keys(r.errors).sort(), ['amount', 'firstPaymentDate', 'method', 'rate', 'termValue']);
    assert.match(r.errors.method, /Choose/);
    assert.match(F.calcLoan(loan({ rate: '41' })).errors.rate, /40 or less/);
    assert.match(F.calcLoan(loan({ rate: '-1' })).errors.rate, /at least 0/);
    assert.match(F.calcLoan(loan({ termValue: '41' })).errors.termValue, /40 or less/);
    assert.match(F.calcLoan(loan({ termValue: '481', termUnit: 'months' })).errors.termValue, /480 or less/);
    assert.match(F.calcLoan(loan({ fees: '-1' })).errors.fees, /at least 0/);
    assert.equal(F.calcLoan(loan({ fees: '' })).fees, 0);
});

test('loan schedule: 12 months a page and a yearly summary', () => {
    const r = F.calcLoan(loan({ termValue: '30', termUnit: 'months' }));
    const first = F.loanSchedule(r, 'monthly', 0);
    assert.equal(first.pageCount, 3);
    assert.equal(first.rows.length, 12);
    assert.equal(F.loanSchedule(r, 'monthly', 2).rows.length, 6);
    assert.equal(F.loanSchedule(r, 'monthly', 99).page, 2);
    const yearly = F.loanSchedule(r, 'yearly', 0);
    assert.equal(yearly.rows.length, 3);
    assert.equal(yearly.rows[2].months, 6);
    assert.equal(yearly.rows[2].balance, 0);
});

// Saved items Section
const fdRow = (extra = {}) => ({
    id: 'fd-1', name: 'Maybank 3M', principal: 10000, rate: 3.5, tenure_value: 90, tenure_unit: 'days', start_date: '2026-01-01',
    maturity_date: '2026-04-01', payout: 'maturity', tax_rate: 0, day_basis: 365, reminders_on: true, reminder_days: [7, 1, 0], status: 'open', ...extra,
});
const loanRow = (extra = {}) => ({
    id: 'loan-1', name: 'Car loan', principal: 50000, rate: 3, method: 'flat', term_months: 60, first_payment_date: '2026-01-15', fees: 0,
    reminders_on: true, reminder_days: [3, 0], status: 'open', paid_through: null, ...extra,
});

test('status comes from dates: FD upcoming, active, matured, closed', () => {
    assert.equal(F.fdStatus(fdRow(), '2025-12-31'), 'upcoming');
    assert.equal(F.fdStatus(fdRow(), '2026-01-01'), 'active');
    assert.equal(F.fdStatus(fdRow(), '2026-03-31'), 'active');
    assert.equal(F.fdStatus(fdRow(), '2026-04-01'), 'matured');
    assert.equal(F.fdStatus(fdRow({ status: 'closed' }), '2026-02-01'), 'closed');
    assert.equal(F.calcFd(F.fdInputFromRow(fdRow())).grossInterest, 86.30);
});

test('loan progress: payments marked paid, overdue ones, the next due date and the balance', () => {
    const fresh = F.loanProgress(loanRow(), '2026-01-10');
    assert.equal(fresh.status, 'upcoming');
    assert.equal(fresh.nextDue, '2026-01-15');
    assert.equal(fresh.balance, 50000);

    const behind = F.loanProgress(loanRow({ paid_through: '2026-01-15' }), '2026-03-20');
    assert.equal(behind.paidCount, 1);
    assert.deepEqual(behind.overdue, ['2026-02-15', '2026-03-15']);
    assert.equal(behind.nextDue, '2026-04-15');
    assert.equal(behind.status, 'active');
    assert.ok(behind.balance < 50000);

    const auto = F.loanProgress(loanRow(), '2026-03-20', { autoPaid: true });
    assert.equal(auto.paidCount, 3);
    assert.deepEqual(auto.overdue, []);

    assert.equal(F.loanProgress(loanRow({ paid_through: '2030-12-15' }), '2027-01-01').status, 'finished');
    assert.equal(F.loanProgress(loanRow(), '2031-06-01', { autoPaid: true }).status, 'finished');
    assert.equal(F.loanProgress(loanRow({ status: 'closed' }), '2026-03-20').status, 'closed');
    assert.equal(F.lastDueBefore(loanRow(), '2026-03-15'), '2026-02-15');
    assert.equal(F.lastDueBefore(loanRow(), '2026-01-15'), '');
});

// Reminders Section
test('reminder days: typed text is checked', () => {
    assert.deepEqual(F.readLeadDays('1, 7 0', [3]).days, [7, 1, 0]);
    assert.deepEqual(F.readLeadDays('', [3, 0]).days, [3, 0]);
    assert.deepEqual(F.readLeadDays([0, 0, 2]).days, [2, 0]);
    assert.match(F.readLeadDays('soon').error, /whole numbers/);
    assert.match(F.readLeadDays('61').error, /at most 60/);
    assert.match(F.readLeadDays('1,2,3,4,5,6').error, /at most 5/);
});

test('FD reminders: 7 days, 1 day and the day itself; a missed one is never sent twice or as a backlog', () => {
    const at = (today, extra) => F.fdReminder(fdRow(extra), today, { lateDays: 7 });
    assert.equal(at('2026-03-24'), null, '8 days before: nothing yet');
    assert.deepEqual([at('2026-03-25').milestone, at('2026-03-25').group, at('2026-03-25').daysLeft], [7, 'soon', 7]);
    assert.equal(at('2026-03-28').milestone, 7, 'between milestones it is still the 7-day one (so it is not repeated)');
    assert.equal(at('2026-03-31').milestone, 1);
    assert.deepEqual([at('2026-04-01').milestone, at('2026-04-01').group], [0, 'today']);
    assert.deepEqual([at('2026-04-03').group, at('2026-04-03').milestone, at('2026-04-03').daysLeft], ['overdue', 0, -2]);
    assert.equal(at('2026-04-09'), null, 'more than a week late: dropped');
    assert.equal(at('2026-03-31', { status: 'closed' }), null);
    assert.equal(at('2026-03-31', { reminders_on: false }), null);
    assert.equal(at('2026-03-27', { reminder_days: [1] }), null, 'custom days are respected');
    assert.equal(at('2026-03-31', { reminder_days: null }).milestone, 1, 'missing days fall back to the defaults');
});

test('loan reminders: 3 days before and on the day; overdue only for loans that are not paid automatically', () => {
    const row = loanRow({ paid_through: '2026-02-15' });
    assert.deepEqual(F.loanReminders(row, '2026-03-11'), []);
    const soon = F.loanReminders(row, '2026-03-12');
    assert.equal(soon.length, 1);
    assert.deepEqual([soon[0].dueDate, soon[0].milestone, soon[0].group, soon[0].amount], ['2026-03-15', 3, 'soon', 958.33]);
    assert.equal(F.loanReminders(row, '2026-03-15')[0].group, 'today');

    const late = F.loanReminders(row, '2026-04-13');
    assert.deepEqual(late.map((r) => r.group), ['overdue', 'soon']);
    assert.deepEqual([late[0].dueDate, late[0].count, late[0].firstUnpaid], ['2026-03-15', 1, '2026-03-15']);

    assert.deepEqual(F.loanReminders(row, '2026-04-13', { autoPaid: true }).map((r) => r.group), ['soon']);
    assert.deepEqual(F.loanReminders(loanRow({ status: 'closed' }), '2026-03-15'), []);
    assert.deepEqual(F.loanReminders(loanRow({ paid_through: '2030-12-15' }), '2026-03-15'), [], 'a finished loan is silent');
    assert.deepEqual(F.loanReminders(row, '2026-04-13', { lateDays: 7 }).map((r) => r.group), ['soon'], 'older than the late window');
});

test('due reminders: one list, most urgent first, with amounts', () => {
    const list = F.dueReminders(
        [fdRow(), fdRow({ id: 'fd-2', name: 'Old FD', maturity_date: '2026-03-20', start_date: '2025-12-20' })],
        [loanRow({ paid_through: '2026-03-15' }), loanRow({ id: 'loan-2', name: 'Linked', first_payment_date: '2026-01-31' })],
        '2026-03-30', { autoPaidLoanIds: ['loan-2'] },
    );
    assert.deepEqual(list.map((r) => `${r.group}:${r.name}`), ['overdue:Old FD', 'soon:Linked', 'soon:Maybank 3M']);
    assert.equal(list[2].amount, 10086.30);
    assert.deepEqual(F.dueReminders([], [], '2026-03-30'), []);
    assert.deepEqual(F.dueReminders(null, null, '2026-03-30'), []);
});

test('relative day wording', () => {
    assert.deepEqual([0, 1, 5, -1, -4].map(F.relativeDay), ['today', 'tomorrow', 'in 5 days', 'yesterday', '4 days ago']);
});

test('the reminder function uses an identical copy of this file', () => {
    const root = path.join(__dirname, '..');
    const app = fs.readFileSync(path.join(root, 'finance-calc.js'));
    const copy = fs.readFileSync(path.join(root, 'supabase/functions/_shared/finance-calc.js'));
    assert.ok(app.equals(copy), 'finance-calc.js differs from the server copy. Run: node tools/sync-shared.js');
});
