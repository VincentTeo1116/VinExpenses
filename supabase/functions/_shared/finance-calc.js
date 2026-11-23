// === FINANCE CALCULATIONS ===
// Fixed-deposit and loan maths, schedules, statuses and reminder timing. Pure functions: no DOM, no network,
// no dependencies. The website uses it for the Plan screen; the reminder function uses the same file (copied to
// supabase/functions/_shared by tools/sync-shared.js), so the app and Telegram always agree on dates and amounts.
//
// Conventions:
//   - dates are plain "YYYY-MM-DD" strings (calendar days, no time zones)
//   - money is calculated in whole sen and returned in ringgit, rounded half-up
//   - FD interest is simple interest: principal x rate x days / 365 (or 360)
//   - loans have a fixed rate: "reducing" (interest on what is still owed) or "flat" (interest on the full amount)
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.FinanceCalc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const LIMITS = {
        amountMin: 1, amountMax: 100000000,
        fdRateMax: 30, loanRateMax: 40,
        fdDaysMax: 3660, fdTenure: { days: 3650, months: 120, years: 10 },
        loanTerm: { months: 480, years: 40 },
        leadDayMax: 60, leadDayCount: 5,
        nameMax: 60
    };
    const FD_PAYOUTS = ['maturity', 'monthly', 'quarterly', 'yearly'];
    const PAYOUT_STEP = { monthly: 1, quarterly: 3, yearly: 12 };
    const LOAN_METHODS = ['reducing', 'flat'];
    const DEFAULT_FD_LEADS = [7, 1, 0];
    const DEFAULT_LOAN_LEADS = [3, 0];

    // ---------- dates ----------
    const pad = (n) => String(n).padStart(2, '0');
    const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

    function parseYmd(value) {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value == null ? '' : value));
        if (!match) return null;
        const y = Number(match[1]), m = Number(match[2]), d = Number(match[3]);
        if (y < 1990 || y > 2200 || m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
        return { y, m, d };
    }
    const isDate = (value) => parseYmd(value) !== null;
    const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

    function dayNumber(value) {
        const p = parseYmd(value);
        return p ? Math.floor(Date.UTC(p.y, p.m - 1, p.d) / 86400000) : NaN;
    }
    function fromDayNumber(n) {
        const date = new Date(n * 86400000);
        return ymd(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
    }
    const addDays = (value, n) => fromDayNumber(dayNumber(value) + n);
    const daysBetween = (from, to) => dayNumber(to) - dayNumber(from);

    // Same day of the month, n months later. A day that does not exist (31st, 29 Feb) becomes the month's last day.
    function addMonths(value, n, anchorDay) {
        const p = parseYmd(value);
        if (!p) return '';
        const index = p.y * 12 + (p.m - 1) + n;
        const y = Math.floor(index / 12);
        const m = (index % 12) + 1;
        return ymd(y, m, Math.min(anchorDay || p.d, daysInMonth(y, m)));
    }

    // ---------- numbers ----------
    const toSen = (ringgit) => Math.round(Number(ringgit) * 100);
    const toRinggit = (sen) => Math.round(sen) / 100;

    // Reads a typed number. Returns { value } or { error }.
    function readNumber(raw, { label, min, max, minExclusive = false, decimals = 2, required = true, fallback = null }) {
        const text = String(raw == null ? '' : raw).trim().replace(/,/g, '');
        if (text === '') {
            if (!required) return { value: fallback };
            return { error: `Enter ${label}.` };
        }
        if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(text)) return { error: `${capitalize(label)} must be a number.` };
        const value = Number(text);
        if (!Number.isFinite(value)) return { error: `${capitalize(label)} must be a number.` };
        const scaled = value * Math.pow(10, decimals);
        if (Math.abs(scaled - Math.round(scaled)) > 1e-6) return { error: `Use at most ${decimals} decimal place${decimals === 1 ? '' : 's'}.` };
        if (minExclusive ? value <= min : value < min) return { error: minExclusive ? `${capitalize(label)} must be more than ${formatPlain(min)}.` : `${capitalize(label)} must be at least ${formatPlain(min)}.` };
        if (value > max) return { error: `${capitalize(label)} must be ${formatPlain(max)} or less.` };
        return { value };
    }
    function readWhole(raw, { label, min, max }) {
        const text = String(raw == null ? '' : raw).trim();
        if (text === '') return { error: `Enter ${label}.` };
        if (!/^\d+$/.test(text)) return { error: `${capitalize(label)} must be a whole number.` };
        const value = Number(text);
        if (value < min) return { error: `${capitalize(label)} must be at least ${min}.` };
        if (value > max) return { error: `${capitalize(label)} must be ${max} or less.` };
        return { value };
    }
    const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
    const formatPlain = (n) => Number(n).toLocaleString('en-MY', { maximumFractionDigits: 3 });

    // ---------- reminder lead days ("7, 1, 0") ----------
    // Accepts an array or typed text. Returns { days } sorted from the earliest reminder to the last, or { error }.
    function readLeadDays(raw, fallback) {
        let parts;
        if (Array.isArray(raw)) parts = raw.map((v) => String(v));
        else {
            const text = String(raw == null ? '' : raw).trim();
            if (text === '') return { days: (fallback || []).slice() };
            parts = text.split(/[\s,;]+/).filter(Boolean);
        }
        const days = [];
        for (const part of parts) {
            if (!/^\d+$/.test(part)) return { error: 'Use whole numbers separated by commas, for example 7, 1, 0.' };
            const n = Number(part);
            if (n > LIMITS.leadDayMax) return { error: `A reminder can be at most ${LIMITS.leadDayMax} days before.` };
            if (!days.includes(n)) days.push(n);
        }
        if (!days.length) return { days: (fallback || []).slice() };
        if (days.length > LIMITS.leadDayCount) return { error: `Use at most ${LIMITS.leadDayCount} reminders.` };
        return { days: days.sort((a, b) => b - a) };
    }

    // =====================================================================
    // FIXED DEPOSIT
    // =====================================================================
    function fdAutoMaturity(startDate, tenureValue, tenureUnit) {
        if (!isDate(startDate) || !Number.isFinite(tenureValue)) return '';
        if (tenureUnit === 'days') return addDays(startDate, tenureValue);
        if (tenureUnit === 'years') return addMonths(startDate, tenureValue * 12);
        return addMonths(startDate, tenureValue);
    }

    // input: { amount, rate, tenureValue, tenureUnit, startDate, maturityDate?, payout, taxRate?, dayBasis? }
    function validateFd(input) {
        const errors = {};
        const v = {};
        const amount = readNumber(input.amount, { label: 'the amount', min: LIMITS.amountMin, max: LIMITS.amountMax });
        if (amount.error) errors.amount = amount.error; else v.amount = amount.value;

        const rate = readNumber(input.rate, { label: 'the rate', min: 0, minExclusive: true, max: LIMITS.fdRateMax, decimals: 3 });
        if (rate.error) errors.rate = rate.error; else v.rate = rate.value;

        v.tenureUnit = ['days', 'months', 'years'].includes(input.tenureUnit) ? input.tenureUnit : 'months';
        const tenure = readWhole(input.tenureValue, { label: 'the tenure', min: 1, max: LIMITS.fdTenure[v.tenureUnit] });
        if (tenure.error) errors.tenureValue = tenure.error; else v.tenureValue = tenure.value;

        if (!isDate(input.startDate)) errors.startDate = 'Choose a valid start date.';
        else v.startDate = input.startDate;

        v.payout = FD_PAYOUTS.includes(input.payout) ? input.payout : 'maturity';

        const tax = readNumber(input.taxRate, { label: 'the tax', min: 0, max: 100, decimals: 2, required: false, fallback: 0 });
        if (tax.error) errors.taxRate = tax.error; else v.taxRate = tax.value;

        v.dayBasis = Number(input.dayBasis) === 360 ? 360 : 365;

        if (v.startDate && v.tenureValue) v.autoMaturityDate = fdAutoMaturity(v.startDate, v.tenureValue, v.tenureUnit);
        const override = String(input.maturityDate == null ? '' : input.maturityDate).trim();
        if (override) {
            if (!isDate(override)) errors.maturityDate = 'Choose a valid maturity date.';
            else if (v.startDate && daysBetween(v.startDate, override) < 1) errors.maturityDate = 'The maturity date must be after the start date.';
            else if (v.startDate && daysBetween(v.startDate, override) > LIMITS.fdDaysMax) errors.maturityDate = 'The maturity date can be at most 10 years after the start date.';
            else v.maturityDate = override;
        } else if (v.autoMaturityDate) {
            v.maturityDate = v.autoMaturityDate;
        }
        return { errors, values: v, ok: Object.keys(errors).length === 0 };
    }

    // Interest (in sen) earned after `days`, rounded half-up. BigInt keeps it exact for very large deposits.
    function fdInterestSen(principalSen, rate, days, basis) {
        const rateMilli = BigInt(Math.round(rate * 1000));
        const top = BigInt(principalSen) * rateMilli * BigInt(days);
        const bottom = BigInt(100000 * basis);
        return Number((top * 2n + bottom) / (bottom * 2n));
    }
    const taxSen = (interestSen, taxRate) => Math.round(interestSen * Math.round(taxRate * 100) / 10000);

    function calcFd(input, options) {
        const today = options && isDate(options.today) ? options.today : null;
        const { errors, values: v, ok } = validateFd(input);
        if (!ok) return { ok: false, errors };

        const days = daysBetween(v.startDate, v.maturityDate);
        const principalSen = toSen(v.amount);
        const cum = (d) => fdInterestSen(principalSen, v.rate, d, v.dayBasis);
        const grossSen = cum(days);
        const totalTaxSen = taxSen(grossSen, v.taxRate);

        // Payout dates: every step months after the start, with the maturity date always last
        const dates = [];
        const step = PAYOUT_STEP[v.payout];
        if (step) {
            for (let k = 1; k <= 400; k++) {
                const date = addMonths(v.startDate, k * step);
                if (date >= v.maturityDate) break;
                dates.push(date);
            }
        }
        dates.push(v.maturityDate);

        // Each payout is the difference between two rounded running totals, so the payouts always add up exactly
        const payouts = [];
        let previousDays = 0, previousGross = 0, previousTax = 0;
        dates.forEach((date, index) => {
            const elapsed = daysBetween(v.startDate, date);
            const gross = cum(elapsed);
            const taxed = index === dates.length - 1 ? totalTaxSen : taxSen(gross, v.taxRate);
            payouts.push({
                n: index + 1, date, days: elapsed - previousDays,
                gross: toRinggit(gross - previousGross), tax: toRinggit(taxed - previousTax),
                net: toRinggit((gross - previousGross) - (taxed - previousTax))
            });
            previousDays = elapsed; previousGross = gross; previousTax = taxed;
        });

        const netSen = grossSen - totalTaxSen;
        const result = {
            ok: true, errors: {},
            principal: v.amount, rate: v.rate, taxRate: v.taxRate, dayBasis: v.dayBasis, payout: v.payout,
            tenureValue: v.tenureValue, tenureUnit: v.tenureUnit,
            startDate: v.startDate, maturityDate: v.maturityDate, autoMaturityDate: v.autoMaturityDate,
            maturityOverridden: !!v.autoMaturityDate && v.autoMaturityDate !== v.maturityDate,
            days,
            grossInterest: toRinggit(grossSen), tax: toRinggit(totalTaxSen), netInterest: toRinggit(netSen),
            maturityAmount: toRinggit(principalSen + netSen),
            // What the money earned per year, after tax, as a simple yearly rate
            effectiveYield: days > 0 ? (netSen / principalSen) * (365 / days) * 100 : 0,
            payouts,
            interestAfter: (d) => toRinggit(cum(Math.max(0, Math.min(days, d))))
        };
        if (today) {
            const elapsed = Math.max(0, Math.min(days, daysBetween(v.startDate, today)));
            result.daysElapsed = elapsed;
            result.daysLeft = daysBetween(today, v.maturityDate);
            result.earnedSoFar = toRinggit(cum(elapsed));
            result.progress = days > 0 ? elapsed / days : 0;
        }
        return result;
    }

    const FD_PAGE = { daily: 31, monthly: 12, yearly: 50 };

    // One page of the earnings table. view: 'daily' | 'monthly' | 'yearly'.
    // rows: [{ label, from, to, days, interest, cumulative, payout }]
    function fdSchedule(result, view, page) {
        if (!result || !result.ok) return { rows: [], page: 0, pageCount: 0, total: 0, view };
        const mode = FD_PAGE[view] ? view : 'monthly';
        const size = FD_PAGE[mode];
        const payoutOn = new Map();
        result.payouts.forEach((p) => payoutOn.set(p.date, (payoutOn.get(p.date) || 0) + toSen(p.net)));
        const paidBetween = (fromExclusive, toInclusive) => {
            let sum = 0;
            payoutOn.forEach((sen, date) => { if (date > fromExclusive && date <= toInclusive) sum += sen; });
            return toRinggit(sum);
        };

        let total, boundary;
        if (mode === 'daily') {
            total = result.days;
            boundary = (k) => addDays(result.startDate, k);
        } else {
            const step = mode === 'yearly' ? 12 : 1;
            const ends = [];
            for (let k = 1; k <= 400; k++) {
                const date = addMonths(result.startDate, k * step);
                if (date >= result.maturityDate) break;
                ends.push(date);
            }
            ends.push(result.maturityDate);
            total = ends.length;
            boundary = (k) => (k === 0 ? result.startDate : ends[k - 1]);
        }
        const pageCount = Math.max(1, Math.ceil(total / size));
        const current = Math.max(0, Math.min(pageCount - 1, Number(page) || 0));
        const rows = [];
        for (let k = current * size + 1; k <= Math.min(total, (current + 1) * size); k++) {
            const from = boundary(k - 1), to = boundary(k);
            const before = result.interestAfter(daysBetween(result.startDate, from));
            const after = result.interestAfter(daysBetween(result.startDate, to));
            rows.push({
                n: k,
                label: mode === 'daily' ? `Day ${k}` : mode === 'yearly' ? `Year ${k}` : `Month ${k}`,
                from, to, days: daysBetween(from, to),
                interest: toRinggit(toSen(after) - toSen(before)),
                cumulative: after,
                payout: paidBetween(from, to)
            });
        }
        return { rows, page: current, pageCount, total, view: mode, pageSize: size };
    }

    // Points for the growth chart: interest earned so far against time (at most maxPoints points)
    function fdChartSeries(result, maxPoints) {
        if (!result || !result.ok) return [];
        const count = Math.max(2, Math.min(maxPoints || 48, result.days + 1));
        const points = [];
        for (let i = 0; i < count; i++) {
            const d = Math.round((result.days * i) / (count - 1));
            points.push({ day: d, date: addDays(result.startDate, d), value: result.interestAfter(d) });
        }
        return points;
    }

    // =====================================================================
    // LOAN (fixed rate)
    // =====================================================================
    // input: { amount, rate, termValue, termUnit, method, firstPaymentDate, fees? }
    function validateLoan(input) {
        const errors = {};
        const v = {};
        const amount = readNumber(input.amount, { label: 'the amount', min: LIMITS.amountMin, max: LIMITS.amountMax });
        if (amount.error) errors.amount = amount.error; else v.amount = amount.value;

        const rate = readNumber(input.rate, { label: 'the rate', min: 0, max: LIMITS.loanRateMax, decimals: 3 });
        if (rate.error) errors.rate = rate.error; else v.rate = rate.value;

        v.termUnit = input.termUnit === 'months' ? 'months' : 'years';
        const term = readWhole(input.termValue, { label: 'the term', min: 1, max: LIMITS.loanTerm[v.termUnit] });
        if (term.error) errors.termValue = term.error;
        else { v.termValue = term.value; v.months = v.termUnit === 'years' ? term.value * 12 : term.value; }

        if (!LOAN_METHODS.includes(input.method)) errors.method = 'Choose how the interest is calculated.';
        else v.method = input.method;

        if (!isDate(input.firstPaymentDate)) errors.firstPaymentDate = 'Choose the first payment date.';
        else v.firstPaymentDate = input.firstPaymentDate;

        const fees = readNumber(input.fees, { label: 'the fees', min: 0, max: LIMITS.amountMax, required: false, fallback: 0 });
        if (fees.error) errors.fees = fees.error; else v.fees = fees.value;

        return { errors, values: v, ok: Object.keys(errors).length === 0 };
    }

    // The yearly rate (% a year, charged monthly on the balance) that gives these payments: lets a flat-rate loan be
    // compared with a reducing-balance one.
    function effectiveAnnualRate(principalSen, payments) {
        const total = payments.reduce((s, p) => s + p, 0);
        if (total <= principalSen) return 0;
        const presentValue = (i) => payments.reduce((sum, p, k) => sum + p / Math.pow(1 + i, k + 1), 0);
        let low = 0, high = 1;
        for (let step = 0; step < 80; step++) {
            const mid = (low + high) / 2;
            if (presentValue(mid) > principalSen) low = mid; else high = mid;
        }
        return ((low + high) / 2) * 12 * 100;
    }

    function calcLoan(input) {
        const { errors, values: v, ok } = validateLoan(input);
        if (!ok) return { ok: false, errors };

        const n = v.months;
        const principalSen = toSen(v.amount);
        const anchor = parseYmd(v.firstPaymentDate).d;
        const rows = [];
        let instalmentSen;

        if (v.method === 'flat') {
            const interestTotal = Math.round(principalSen * v.rate * n / 1200);
            const total = principalSen + interestTotal;
            instalmentSen = Math.round(total / n);
            let balance = principalSen, paid = 0, interestSoFar = 0;
            for (let k = 1; k <= n; k++) {
                const payment = k === n ? total - paid : instalmentSen;
                const interestCum = Math.round(interestTotal * k / n); // interest is spread evenly over the months
                const interest = interestCum - interestSoFar;
                const principal = k === n ? balance : payment - interest;
                balance -= principal; paid += payment; interestSoFar = interestCum;
                rows.push({ n: k, date: addMonths(v.firstPaymentDate, k - 1, anchor), payment, principal, interest, balance });
            }
        } else {
            const monthly = v.rate / 1200;
            instalmentSen = monthly === 0 ? Math.round(principalSen / n) : Math.round(principalSen * monthly / (1 - Math.pow(1 + monthly, -n)));
            let balance = principalSen;
            for (let k = 1; k <= n; k++) {
                const interest = Math.round(balance * monthly);
                let principal = k === n ? balance : Math.min(balance, instalmentSen - interest);
                if (principal < 0) principal = 0;
                const payment = principal + interest;
                balance -= principal;
                rows.push({ n: k, date: addMonths(v.firstPaymentDate, k - 1, anchor), payment, principal, interest, balance });
            }
        }

        if (instalmentSen < 1 || rows.some((r) => r.payment < 0)) {
            return { ok: false, errors: { amount: `This amount is too small to repay over ${n} months.` } };
        }

        const totalPayments = rows.reduce((s, r) => s + r.payment, 0);
        const totalInterest = rows.reduce((s, r) => s + r.interest, 0);
        const feesSen = toSen(v.fees);
        const schedule = rows.map((r) => ({
            n: r.n, date: r.date, payment: toRinggit(r.payment), principal: toRinggit(r.principal),
            interest: toRinggit(r.interest), balance: toRinggit(r.balance)
        }));

        const yearly = [];
        for (let start = 0; start < rows.length; start += 12) {
            const chunk = rows.slice(start, start + 12);
            yearly.push({
                n: yearly.length + 1, from: chunk[0].date, to: chunk[chunk.length - 1].date, months: chunk.length,
                payment: toRinggit(chunk.reduce((s, r) => s + r.payment, 0)),
                principal: toRinggit(chunk.reduce((s, r) => s + r.principal, 0)),
                interest: toRinggit(chunk.reduce((s, r) => s + r.interest, 0)),
                balance: toRinggit(chunk[chunk.length - 1].balance)
            });
        }

        return {
            ok: true, errors: {},
            principal: v.amount, rate: v.rate, method: v.method, months: n, termValue: v.termValue, termUnit: v.termUnit,
            fees: v.fees, firstPaymentDate: v.firstPaymentDate, lastPaymentDate: rows[rows.length - 1].date,
            instalment: toRinggit(instalmentSen), lastInstalment: toRinggit(rows[rows.length - 1].payment),
            totalInterest: toRinggit(totalInterest), totalPayments: toRinggit(totalPayments),
            totalCost: toRinggit(totalPayments + feesSen),
            effectiveRate: v.method === 'flat' ? effectiveAnnualRate(principalSen, rows.map((r) => r.payment)) : v.rate,
            costPerMonth: toRinggit(instalmentSen),
            costPerYear: toRinggit(instalmentSen * 12),
            costPerDay: toRinggit(instalmentSen * 12 / 365),
            schedule, yearly
        };
    }

    const LOAN_PAGE = 12;
    // One page (12 months) of the repayment table, or the whole yearly summary
    function loanSchedule(result, view, page) {
        if (!result || !result.ok) return { rows: [], page: 0, pageCount: 0, total: 0, view };
        if (view === 'yearly') return { rows: result.yearly, page: 0, pageCount: 1, total: result.yearly.length, view: 'yearly', pageSize: result.yearly.length };
        const pageCount = Math.max(1, Math.ceil(result.schedule.length / LOAN_PAGE));
        const current = Math.max(0, Math.min(pageCount - 1, Number(page) || 0));
        return {
            rows: result.schedule.slice(current * LOAN_PAGE, (current + 1) * LOAN_PAGE),
            page: current, pageCount, total: result.schedule.length, view: 'monthly', pageSize: LOAN_PAGE
        };
    }

    // =====================================================================
    // SAVED ITEMS: database rows -> calculator input, status, progress
    // =====================================================================
    const fdInputFromRow = (row) => ({
        amount: row.principal, rate: row.rate, tenureValue: row.tenure_value, tenureUnit: row.tenure_unit,
        startDate: row.start_date, maturityDate: row.maturity_date, payout: row.payout,
        taxRate: row.tax_rate == null ? 0 : row.tax_rate, dayBasis: row.day_basis
    });
    const loanInputFromRow = (row) => ({
        amount: row.principal, rate: row.rate, termValue: row.term_months, termUnit: 'months', method: row.method,
        firstPaymentDate: row.first_payment_date, fees: row.fees == null ? 0 : row.fees
    });

    // 'closed' | 'upcoming' | 'active' | 'matured'  (worked out from dates, so it is right even if no reminder ran)
    function fdStatus(row, today) {
        if (row.status === 'closed') return 'closed';
        if (row.start_date > today) return 'upcoming';
        return row.maturity_date <= today ? 'matured' : 'active';
    }

    // Where a saved loan stands today. `autoPaid` (linked to a recurring expense) means every due date up to today
    // counts as paid; otherwise payments count up to the last one marked paid (row.paid_through).
    function loanProgress(row, today, options) {
        const result = calcLoan(loanInputFromRow(row));
        if (!result.ok) return { ok: false };
        const autoPaid = !!(options && options.autoPaid);
        const dates = result.schedule.map((r) => r.date);
        const paidThrough = autoPaid ? today : (isDate(row.paid_through) ? row.paid_through : '');
        const paidCount = dates.filter((d) => paidThrough && d <= paidThrough).length;
        const unpaidDue = autoPaid ? [] : dates.filter((d) => d < today && !(paidThrough && d <= paidThrough));
        const nextDue = dates.find((d) => d >= today && !(paidThrough && d <= paidThrough)) || null;
        let status = 'active';
        if (row.status === 'closed') status = 'closed';
        else if (paidCount >= dates.length || (autoPaid && result.lastPaymentDate < today)) status = 'finished';
        else if (result.firstPaymentDate > today && paidCount === 0) status = 'upcoming';
        return {
            ok: true, result, status, paidCount, total: dates.length,
            balance: paidCount > 0 ? result.schedule[paidCount - 1].balance : result.principal,
            nextDue, nextAmount: nextDue ? result.schedule[dates.indexOf(nextDue)].payment : 0,
            overdue: unpaidDue, firstUnpaid: unpaidDue.length ? unpaidDue[0] : nextDue
        };
    }

    // The latest due date before today (what a newly saved loan assumes was already paid), or "" if none yet
    function lastDueBefore(row, today) {
        const result = calcLoan(loanInputFromRow(row));
        if (!result.ok) return '';
        const past = result.schedule.filter((r) => r.date < today);
        return past.length ? past[past.length - 1].date : '';
    }

    // =====================================================================
    // REMINDERS
    // =====================================================================
    // A reminder "milestone" is one of the item's lead days (7, 1, 0...). On any day only the current milestone
    // matters: the smallest lead that is still >= the days left. A missed earlier one is never sent late as well.
    function milestoneFor(daysLeft, leads) {
        const fitting = leads.filter((lead) => lead >= daysLeft);
        return fitting.length ? Math.min.apply(null, fitting) : null;
    }
    const leadsOf = (row, fallback) => {
        const read = readLeadDays(Array.isArray(row.reminder_days) ? row.reminder_days : fallback, fallback);
        return read.days && read.days.length ? read.days : fallback;
    };

    // options.lateDays: how long after the date a matured / missed item is still mentioned
    function fdReminder(row, today, options) {
        if (row.status === 'closed' || row.reminders_on === false || !isDate(row.maturity_date) || !isDate(today)) return null;
        const lateDays = options && options.lateDays != null ? options.lateDays : 30;
        const leads = leadsOf(row, DEFAULT_FD_LEADS);
        const daysLeft = daysBetween(today, row.maturity_date);
        const base = { kind: 'fd', id: row.id, name: row.name, dueDate: row.maturity_date, daysLeft };
        if (daysLeft < 0) {
            if (-daysLeft > lateDays) return null;
            return Object.assign(base, { group: 'overdue', milestone: 0 });
        }
        const milestone = milestoneFor(daysLeft, leads);
        if (milestone === null) return null;
        return Object.assign(base, { group: daysLeft === 0 ? 'today' : 'soon', milestone });
    }

    // Returns up to two entries: missed payments (not for auto-paid loans) and the next one coming up
    function loanReminders(row, today, options) {
        if (row.status === 'closed' || row.reminders_on === false || !isDate(today)) return [];
        const lateDays = options && options.lateDays != null ? options.lateDays : 30;
        const progress = loanProgress(row, today, options);
        if (!progress.ok || progress.status === 'finished') return [];
        const leads = leadsOf(row, DEFAULT_LOAN_LEADS);
        const out = [];
        const amountOn = (date) => { const r = progress.result.schedule.find((s) => s.date === date); return r ? r.payment : progress.result.instalment; };
        const recent = progress.overdue.filter((d) => daysBetween(d, today) <= lateDays);
        if (recent.length) {
            const latest = recent[recent.length - 1];
            out.push({
                kind: 'loan', id: row.id, name: row.name, dueDate: latest, daysLeft: daysBetween(today, latest),
                group: 'overdue', milestone: 0, count: progress.overdue.length, amount: amountOn(latest), firstUnpaid: progress.overdue[0]
            });
        }
        if (progress.nextDue) {
            const daysLeft = daysBetween(today, progress.nextDue);
            const milestone = milestoneFor(daysLeft, leads);
            if (milestone !== null) {
                out.push({
                    kind: 'loan', id: row.id, name: row.name, dueDate: progress.nextDue, daysLeft,
                    group: daysLeft === 0 ? 'today' : 'soon', milestone, amount: amountOn(progress.nextDue)
                });
            }
        }
        return out;
    }

    // Everything worth reminding about today, most urgent first.
    // options: { lateDays, autoPaidLoanIds: Set|Array of loan ids that are linked to a recurring expense }
    function dueReminders(deposits, loans, today, options) {
        const auto = new Set((options && options.autoPaidLoanIds) || []);
        const list = [];
        (deposits || []).forEach((row) => {
            const r = fdReminder(row, today, options);
            if (!r) return;
            const calc = calcFd(fdInputFromRow(row));
            r.amount = calc.ok ? calc.maturityAmount : Number(row.principal) || 0;
            list.push(r);
        });
        (loans || []).forEach((row) => {
            loanReminders(row, today, Object.assign({}, options, { autoPaid: auto.has(row.id) })).forEach((r) => list.push(r));
        });
        const rank = { overdue: 0, today: 1, soon: 2 };
        return list.sort((a, b) => rank[a.group] - rank[b.group] || a.dueDate.localeCompare(b.dueDate) || String(a.name).localeCompare(String(b.name)));
    }

    // "in 3 days" / "today" / "2 days ago"
    function relativeDay(daysLeft) {
        if (daysLeft === 0) return 'today';
        if (daysLeft === 1) return 'tomorrow';
        if (daysLeft === -1) return 'yesterday';
        return daysLeft > 0 ? `in ${daysLeft} days` : `${-daysLeft} days ago`;
    }

    return {
        LIMITS, FD_PAYOUTS, LOAN_METHODS, DEFAULT_FD_LEADS, DEFAULT_LOAN_LEADS,
        isDate, parseYmd, addDays, addMonths, daysBetween,
        readLeadDays,
        validateFd, calcFd, fdSchedule, fdChartSeries, fdAutoMaturity,
        validateLoan, calcLoan, loanSchedule,
        fdInputFromRow, loanInputFromRow, fdStatus, loanProgress, lastDueBefore,
        fdReminder, loanReminders, dueReminders, milestoneFor, relativeDay
    };
});
