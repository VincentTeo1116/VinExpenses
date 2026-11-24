// Plan Section: Deposits, loans, reminders; loaded before app.js; only defines things, and app.js starts it
window.Plan = (function () {
    'use strict';
    const F = window.FinanceCalc;
    const el = (id) => document.getElementById(id);

    // State Section
    let deposits = [];
    let loans = [];
    const loadState = { fixed_deposits: '', loans: '' };   // '' | 'missing' | 'failed' | 'offline'
    let pending = [];                                       // [{ table, row, error }] saves waiting for the server
    let segment = 'recurring';
    let prefs = { hour: 9, hideAmounts: false, popup: 'auto', snoozeUntil: 0, unavailable: false };
    let telegram = { known: false, linked: false, blocked: false };
    let popupShown = false;
    let popupTimer = null;
    let lastFocus = null;
    let loading = false;
    let started = false;

    const fd = { editingId: null, renewFromId: null, touched: new Set(), submitted: false, manualMaturity: false, payout: 'maturity', view: 'monthly', page: 0, result: null, chart: null, chartTimer: null };
    const ln = { editingId: null, touched: new Set(), submitted: false, method: '', view: 'monthly', page: 0, result: null, chart: null, chartTimer: null, linkingId: null };

    const FD_FIELDS = { amount: 'fdAmount', rate: 'fdRate', tenureValue: 'fdTenure', startDate: 'fdStart', maturityDate: 'fdMaturity', taxRate: 'fdTax', name: 'fdName', reminderDays: 'fdRemindDays' };
    const LOAN_FIELDS = { amount: 'loanAmount', rate: 'loanRate', termValue: 'loanTerm', firstPaymentDate: 'loanFirst', fees: 'loanFees', name: 'loanName', reminderDays: 'loanRemindDays' };
    const ERROR_ID = { fdTenure: 'fdTenureError', loanTerm: 'loanTermError', fdStart: 'fdStartError', fdMaturity: 'fdMaturityError', loanFirst: 'loanFirstError' };
    const errorIdOf = (inputId) => ERROR_ID[inputId] || `${inputId}Error`;

    const today = () => toInputDate();
    const uid = () => (currentUser ? currentUser.id : 'anon');
    const tableLabel = (table) => (table === 'loans' ? 'loan' : 'deposit');
    const listOf = (table) => (table === 'loans' ? loans : deposits);
    const setList = (table, rows) => { if (table === 'loans') loans = rows; else deposits = rows; };
    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
    const pct = (n) => `${Number(n).toLocaleString('en-MY', { maximumFractionDigits: 3 })}%`;
    // Table cells: the column heading already says RM, so the rows stay narrow enough for a phone
    const plain = (n) => Number(n || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    function store(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* storage blocked or full */ } }
    function read(key, fallback) { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch (_) { return fallback; } }

    // Small DOM helpers Section
    function setFieldError(inputId, message) {
        const input = el(inputId);
        const error = el(errorIdOf(inputId));
        if (error) error.textContent = message || '';
        if (!input) return;
        const wrap = input.closest('.input-icon-wrap');
        if (wrap) wrap.classList.toggle('invalid', !!message);
        if (message) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
    }

    function setChoice(group, value) {
        group.querySelectorAll('[data-value]').forEach((button) => {
            const on = button.dataset.value === value;
            button.classList.toggle('active', on);
            button.setAttribute('aria-pressed', String(on));
        });
    }

    function stat(label, value, hint, tone) {
        return `<div class="plan-stat"><span>${escapeHtml(label)}</span><b${tone ? ` class="${tone}"` : ''}>${escapeHtml(value)}</b>${hint ? `<small>${escapeHtml(hint)}</small>` : ''}</div>`;
    }

    // The name / reminder fields stay folded away until the person chooses to save, so a quick sum stays quick
    function setSaveOpen(prefix, open, { focus = false } = {}) {
        el(`${prefix}SaveFields`).classList.toggle('hidden', !open);
        const toggle = el(`${prefix}SaveToggle`);
        toggle.classList.toggle('hidden', open);
        toggle.setAttribute('aria-expanded', String(open));
        if (open && focus) el(`${prefix}Name`).focus();
    }
    const saveOpen = (prefix) => !el(`${prefix}SaveFields`).classList.contains('hidden');

    function markPresets(hostId, value, unit) {
        el(hostId).querySelectorAll('.preset').forEach((b) => {
            const on = b.dataset.preset === String(value).trim() && b.dataset.unit === unit;
            b.classList.toggle('active', on);
            b.setAttribute('aria-pressed', String(on));
        });
    }

    // Phones: a slim bar with the answer, shown while the result card itself is scrolled out of view
    const heroSeen = { fd: false, loan: false };
    function updateSticky() {
        const bar = el('planSticky');
        if (!bar) return;
        const which = segment === 'deposits' && fd.result ? 'fd' : segment === 'loans' && ln.result ? 'loan' : '';
        const show = !!which && !heroSeen[which];
        bar.classList.toggle('hidden', !show);
        if (!show) return;
        if (which === 'fd') {
            el('planStickyLabel').textContent = fd.result.payouts.length > 1 ? 'Total you\'ll receive' : 'You\'ll receive';
            el('planStickyValue').textContent = formatMoney(fd.result.maturityAmount);
        } else {
            el('planStickyLabel').textContent = 'Monthly payment';
            el('planStickyValue').textContent = formatMoney(ln.result.instalment);
        }
    }

    function renderPager(pagerId, textId, schedule, noun) {
        const pager = el(pagerId);
        const single = schedule.pageCount <= 1;
        pager.classList.toggle('single', single);
        const first = schedule.page * schedule.pageSize + 1;
        const last = Math.min(schedule.total, first + schedule.rows.length - 1);
        el(textId).textContent = single ? plural(schedule.total, noun) : `${noun[0].toUpperCase()}${noun.slice(1)}s ${first}–${last} of ${schedule.total}`;
        pager.querySelector('[data-page="prev"]').disabled = schedule.page <= 0;
        pager.querySelector('[data-page="next"]').disabled = schedule.page >= schedule.pageCount - 1;
    }

    // A small line chart. Any failure (library missing, canvas blocked) just hides the chart: the table still shows.
    function drawChart(state, wrapId, canvasId, labels, values, label) {
        clearTimeout(state.chartTimer);
        state.chartTimer = setTimeout(() => {
            const wrap = el(wrapId);
            try {
                if (typeof Chart === 'undefined') throw new Error('chart library unavailable');
                if (state.chart) { state.chart.destroy(); state.chart = null; }
                const color = cssVar('--primary') || '#4f46e5';
                state.chart = new Chart(el(canvasId), {
                    type: 'line',
                    data: { labels, datasets: [{ label, data: values, borderColor: color, backgroundColor: colorWithAlpha(color, 0.12), fill: true, tension: 0.25, pointRadius: 0, pointHitRadius: 12, borderWidth: 2 }] },
                    options: {
                        responsive: true, maintainAspectRatio: false, animation: prefersReducedMotion ? false : { duration: 250 },
                        interaction: { mode: 'index', intersect: false },
                        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `${label}: ${formatMoney(ctx.parsed.y)}` } } },
                        scales: {
                            x: { grid: { display: false }, ticks: { maxTicksLimit: 5, maxRotation: 0 } },
                            y: { beginAtZero: true, ticks: { maxTicksLimit: 5, callback: (v) => Number(v).toLocaleString('en-MY', { notation: 'compact', maximumFractionDigits: 1 }) } }
                        }
                    }
                });
                wrap.classList.remove('hidden');
            } catch (err) {
                wrap.classList.add('hidden');
            }
        }, 120);
    }

    // Sections: Recurring / Deposits / Loans
    const SEGMENTS = ['recurring', 'deposits', 'loans'];
    const paneId = (name) => `planPane${name[0].toUpperCase()}${name.slice(1)}`;
    const tabId = (name) => `planTab${name[0].toUpperCase()}${name.slice(1)}`;

    function setSegment(name, { focus = false, remember = true } = {}) {
        segment = SEGMENTS.includes(name) ? name : 'recurring';
        SEGMENTS.forEach((s) => {
            const on = s === segment;
            el(paneId(s)).classList.toggle('hidden', !on);
            const tab = el(tabId(s));
            tab.classList.toggle('active', on);
            tab.setAttribute('aria-selected', String(on));
            tab.tabIndex = on ? 0 : -1;
            if (on && focus) tab.focus();
        });
        if (remember) { try { localStorage.setItem('et_plan_tab', segment); } catch (_) { /* optional */ } }
        render();
        updateSticky();
    }

    // Fixed Deposit Calculator Section
    function fdInput() {
        const manual = fd.manualMaturity && el('fdMaturity').value;
        return {
            amount: el('fdAmount').value, rate: el('fdRate').value,
            tenureValue: el('fdTenure').value, tenureUnit: el('fdTenureUnit').value,
            startDate: el('fdStart').value, maturityDate: manual ? el('fdMaturity').value : '',
            payout: fd.payout, taxRate: el('fdTax').value, dayBasis: el('fdBasis').value
        };
    }

    function showErrors(state, fields, errors) {
        Object.keys(fields).forEach((key) => {
            const visible = state.submitted || state.touched.has(key);
            setFieldError(fields[key], visible ? (errors[key] || '') : '');
        });
    }

    function renderFd() {
        if (!F) return;
        const input = fdInput();
        const result = F.calcFd(input, { today: today() });
        fd.result = result.ok ? result : null;

        const errors = Object.assign({}, result.errors, fdSaveErrors(false));
        showErrors(fd, FD_FIELDS, errors);

        // Keep the maturity box in step with the tenure unless the person typed their own date
        const auto = F.fdAutoMaturity(input.startDate, Number(input.tenureValue), input.tenureUnit);
        if (!fd.manualMaturity && /^\d+$/.test(String(input.tenureValue).trim()) && auto) el('fdMaturity').value = auto;
        el('fdMaturityReset').classList.toggle('hidden', !fd.manualMaturity);
        el('fdMaturityHintText').textContent = fd.manualMaturity
            ? 'Using the date you entered instead of the tenure.'
            : 'Worked out from the tenure. Change it only if your bank gives a different date.';

        el('fdRemindDaysGroup').classList.toggle('hidden', !el('fdRemindOn').checked);
        markPresets('fdTenurePresets', input.tenureValue, input.tenureUnit);

        if (!result.ok) {
            updateSticky();
            el('fdResult').classList.add('hidden');
            el('fdResultEmpty').classList.remove('hidden');
            const shown = Object.keys(result.errors).some((key) => fd.submitted || fd.touched.has(key));
            el('fdResultEmptyText').textContent = shown ? 'Fix the highlighted fields to see the result.' : 'Enter an amount and a rate to see what you\'ll earn.';
            return;
        }
        el('fdResultEmpty').classList.add('hidden');
        el('fdResult').classList.remove('hidden');

        const periodic = result.payouts.length > 1;
        el('fdHeroLabel').textContent = periodic ? 'Total you\'ll receive' : 'You\'ll receive at maturity';
        animateAmount(el('fdHeroValue'), result.maturityAmount);
        el('fdHeroSub').textContent = periodic
            ? `${formatMoney(result.netInterest)} interest in ${result.payouts.length} payouts, and ${formatMoney(result.principal)} back on ${formatDateDisplay(result.maturityDate)}`
            : `on ${formatDateDisplay(result.maturityDate)} · ${formatMoney(result.netInterest)} interest`;

        // Three numbers answer the question; everything else is one tap away
        el('fdStats').innerHTML = [
            stat(result.tax > 0 ? 'Interest after tax' : 'Interest earned', `+ ${formatMoney(result.netInterest)}`, `${pct(result.rate)} a year`, 'good'),
            stat('Matures on', formatDateDisplay(result.maturityDate), plural(result.days, 'day')),
            stat('Yearly return', pct(Math.round(result.effectiveYield * 1000) / 1000), result.tax > 0 ? 'after tax' : 'simple interest')
        ].join('');
        const more = [];
        if (result.tax > 0) {
            more.push(stat('Interest before tax', formatMoney(result.grossInterest)));
            more.push(stat('Tax', `− ${formatMoney(result.tax)}`, `${pct(result.taxRate)} of the interest`));
        }
        more.push(stat('Starts', formatDateDisplay(result.startDate)));
        if (periodic) more.push(stat(`${result.payout[0].toUpperCase()}${result.payout.slice(1)} payout`, `≈ ${formatMoney(result.netInterest / result.payouts.length)}`, 'varies with the days in each period'));
        more.push(stat('Per day', formatMoney(result.netInterest / result.days), 'on average'));
        more.push(stat('You put in', formatMoney(result.principal)));
        el('fdStatsMore').innerHTML = more.join('');

        const note = el('fdOverrideNote');
        note.classList.toggle('hidden', !result.maturityOverridden);
        if (result.maturityOverridden) note.textContent = `Your maturity date (${formatDateDisplay(result.maturityDate)}) is different from the tenure (${formatDateDisplay(result.autoMaturityDate)}). The date you entered is used.`;

        const running = result.daysElapsed > 0 && result.daysLeft > 0;
        el('fdProgressWrap').classList.toggle('hidden', !running);
        if (running) {
            el('fdProgressBar').style.width = `${Math.round(result.progress * 100)}%`;
            el('fdProgressText').textContent = `Earned so far: ${formatMoney(result.earnedSoFar)} · ${plural(result.daysLeft, 'day')} to go`;
        }

        // A short deposit is a straight line that says nothing new, so the chart is kept for longer ones
        if (result.days > 92) {
            const points = F.fdChartSeries(result, 40);
            drawChart(fd, 'fdChartWrap', 'fdChart', points.map((p) => formatDateDisplay(p.date, { includeYear: result.days > 365 })), points.map((p) => p.value), 'Interest earned');
        } else {
            clearTimeout(fd.chartTimer);
            el('fdChartWrap').classList.add('hidden');
        }
        renderFdTable();
        updateSticky();
    }

    function renderFdTable() {
        const result = fd.result;
        if (!result) return;
        const schedule = F.fdSchedule(result, fd.view, fd.page);
        fd.page = schedule.page;
        setChoice(el('fdView'), schedule.view);
        el('fdPaidHead').textContent = result.tax > 0 ? 'Paid out after tax (RM)' : 'Paid out (RM)';
        const now = today();
        el('fdTable').querySelector('tbody').innerHTML = schedule.rows.map((row) => {
            const cls = row.to < now ? 'is-past' : (row.from < now && row.to >= now ? 'is-today' : '');
            return `<tr class="${cls}"><th scope="row">${escapeHtml(row.label)}</th><td>${escapeHtml(formatDateDisplay(row.to))}</td>` +
                `<td class="num">${plain(row.interest)}</td><td class="num">${plain(row.cumulative)}</td>` +
                `<td class="num">${row.payout > 0 ? plain(row.payout) : '–'}</td></tr>`;
        }).join('');
        renderPager('fdPager', 'fdPagerText', schedule, schedule.view === 'daily' ? 'day' : schedule.view === 'yearly' ? 'year' : 'month');
    }

    // Errors that only matter when saving (name, reminder days). `strict` = the person pressed Save.
    function fdSaveErrors(strict) {
        const errors = {};
        const name = el('fdName').value.trim();
        if (strict && !name) errors.name = 'Give this deposit a name to save it.';
        if (el('fdRemindOn').checked) {
            const lead = F.readLeadDays(el('fdRemindDays').value, F.DEFAULT_FD_LEADS);
            if (lead.error) errors.reminderDays = lead.error;
        }
        return errors;
    }

    function resetFdForm({ keepNumbers = false } = {}) {
        fd.editingId = null; fd.renewFromId = null; fd.touched.clear(); fd.submitted = false; fd.manualMaturity = false; fd.page = 0;
        if (!keepNumbers) {
            el('fdAmount').value = ''; el('fdRate').value = ''; el('fdTenure').value = '12'; el('fdTenureUnit').value = 'months';
            el('fdStart').value = today(); el('fdTax').value = ''; el('fdBasis').value = '365';
            fd.payout = 'maturity';
        }
        el('fdName').value = ''; el('fdBank').value = ''; el('fdRemindOn').checked = true; el('fdRemindDays').value = F.DEFAULT_FD_LEADS.join(', ');
        setChoice(el('fdPayout'), fd.payout);
        el('fdFormTitle').textContent = 'Fixed deposit calculator';
        el('fdSaveBtn').innerHTML = '<i class="fas fa-floppy-disk" aria-hidden="true"></i> Save deposit';
        el('fdResetBtn').textContent = 'Clear';
        setSaveOpen('fd', false);
        renderFd();
        renderDepositList();
    }

    function loadFdIntoForm(row, { renew = false } = {}) {
        fd.touched.clear(); fd.submitted = false; fd.page = 0;
        fd.editingId = renew ? null : row.id;
        fd.renewFromId = renew ? row.id : null;
        el('fdAmount').value = String(Number(row.principal));
        el('fdRate').value = String(Number(row.rate));
        el('fdTenure').value = String(row.tenure_value);
        el('fdTenureUnit').value = row.tenure_unit;
        el('fdStart').value = renew ? (row.maturity_date > today() ? row.maturity_date : (row.maturity_date || today())) : row.start_date;
        const auto = F.fdAutoMaturity(el('fdStart').value, Number(row.tenure_value), row.tenure_unit);
        fd.manualMaturity = !renew && row.maturity_date !== auto;
        el('fdMaturity').value = renew ? auto : row.maturity_date;
        fd.payout = row.payout;
        setChoice(el('fdPayout'), fd.payout);
        el('fdTax').value = Number(row.tax_rate) ? String(Number(row.tax_rate)) : '';
        el('fdBasis').value = String(row.day_basis || 365);
        el('fdName').value = row.name || '';
        el('fdBank').value = row.bank || '';
        el('fdRemindOn').checked = row.reminders_on !== false;
        el('fdRemindDays').value = (Array.isArray(row.reminder_days) && row.reminder_days.length ? row.reminder_days : F.DEFAULT_FD_LEADS).join(', ');
        el('fdFormTitle').textContent = renew ? `Renew "${row.name}"` : 'Edit deposit';
        el('fdSaveBtn').innerHTML = `<i class="fas fa-floppy-disk" aria-hidden="true"></i> ${renew ? 'Save renewed deposit' : 'Update deposit'}`;
        el('fdResetBtn').textContent = 'Cancel';
        setSaveOpen('fd', true);
        renderFd();
        renderDepositList();
        el('fdForm').scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' });
        el('fdAmount').focus({ preventScroll: true });
    }

    function focusFirstError(fields, errors, extra) {
        const key = Object.keys(fields).find((k) => errors[k]);
        if (key) {
            const input = el(fields[key]);
            const details = input.closest('details');
            if (details) details.open = true;
            input.focus();
            return true;
        }
        if (extra) extra();
        return false;
    }

    async function submitFd(event) {
        event.preventDefault();
        if (!currentUser) return showModal({ type: 'warning', title: 'Not signed in', message: 'Please log in first.' });
        if (!saveOpen('fd')) setSaveOpen('fd', true);
        fd.submitted = true;
        const result = F.calcFd(fdInput(), { today: today() });
        const errors = Object.assign({}, result.errors, fdSaveErrors(true));
        renderFd();
        showErrors(fd, FD_FIELDS, errors);
        if (Object.keys(errors).length) {
            focusFirstError(FD_FIELDS, errors);
            return showToast('error', 'Please fix the highlighted fields first.');
        }
        const existing = fd.editingId ? deposits.find((d) => d.id === fd.editingId) : null;
        const reminders = el('fdRemindOn').checked;
        const row = {
            id: existing ? existing.id : uuid(),
            user_id: currentUser.id,
            name: el('fdName').value.trim().slice(0, 60),
            bank: el('fdBank').value.trim().slice(0, 60) || null,
            principal: result.principal, rate: result.rate,
            start_date: result.startDate, tenure_value: result.tenureValue, tenure_unit: result.tenureUnit,
            maturity_date: result.maturityDate, payout: result.payout, tax_rate: result.taxRate, day_basis: result.dayBasis,
            reminders_on: reminders,
            reminder_days: reminders ? F.readLeadDays(el('fdRemindDays').value, F.DEFAULT_FD_LEADS).days : (existing && Array.isArray(existing.reminder_days) ? existing.reminder_days : F.DEFAULT_FD_LEADS),
            status: existing ? existing.status : 'open',
            // changing the amount or dates after the interest was recorded would make a second recording possible, so it stays as it was
            interest_recorded: existing ? !!existing.interest_recorded : false,
            updated_at: new Date().toISOString()
        };
        const renewFrom = fd.renewFromId;
        const button = el('fdSaveBtn');
        setBusy(button, true, 'Saving...');
        let restored = false;
        try {
            const outcome = await saveRow('fixed_deposits', row);
            if (!outcome.saved && !outcome.queued) return;
            if (renewFrom && outcome.saved) await setStatus('fixed_deposits', renewFrom, 'closed', { quiet: true });
            setBusy(button, false); restored = true;   // before the form resets, so the button gets its normal label back
            resetFdForm();
            showToast(outcome.queued ? 'info' : 'success', outcome.queued
                ? 'Kept on this device. It will be saved when you\'re back online.'
                : (existing ? 'Deposit updated' : (renewFrom ? 'Renewed. The old deposit was closed.' : 'Deposit saved')));
        } finally {
            if (!restored) setBusy(button, false);
            refreshReminders();
        }
    }

    // Loan Calculator Section
    function loanInput() {
        return {
            amount: el('loanAmount').value, rate: el('loanRate').value,
            termValue: el('loanTerm').value, termUnit: el('loanTermUnit').value,
            method: ln.method, firstPaymentDate: el('loanFirst').value, fees: el('loanFees').value
        };
    }

    function loanSaveErrors(strict) {
        const errors = {};
        if (strict && !el('loanName').value.trim()) errors.name = 'Give this loan a name to save it.';
        if (el('loanRemindOn').checked) {
            const lead = F.readLeadDays(el('loanRemindDays').value, F.DEFAULT_LOAN_LEADS);
            if (lead.error) errors.reminderDays = lead.error;
        }
        return errors;
    }

    // Monthly / yearly / daily cost and what is still owed, for every active saved loan except the one being edited
    function otherLoanTotals() {
        const now = today();
        const auto = autoPaidLoanIds();
        const totals = { count: 0, monthly: 0, outstanding: 0 };
        loans.forEach((row) => {
            if (row.id === ln.editingId) return;
            const progress = F.loanProgress(trackedLoan(row), now, { autoPaid: auto.has(row.id) });
            if (!progress.ok || progress.status === 'closed' || progress.status === 'finished') return;
            totals.count++;
            totals.monthly += progress.result.instalment;
            totals.outstanding += progress.result.schedule.slice(progress.paidCount).reduce((s, r) => s + r.payment, 0);
        });
        return totals;
    }

    function renderLoan() {
        if (!F) return;
        const input = loanInput();
        const result = F.calcLoan(input);
        ln.result = result.ok ? result : null;

        const errors = Object.assign({}, result.errors, loanSaveErrors(false));
        showErrors(ln, LOAN_FIELDS, errors);
        const methodVisible = ln.submitted || ln.touched.has('method');
        el('loanMethodError').textContent = methodVisible ? (errors.method || '') : '';
        el('loanMethod').classList.toggle('invalid', methodVisible && !!errors.method);
        setChoice(el('loanMethod'), ln.method);
        el('loanRemindDaysGroup').classList.toggle('hidden', !el('loanRemindOn').checked);
        markPresets('loanTermPresets', input.termValue, input.termUnit);

        if (!result.ok) {
            updateSticky();
            el('loanResult').classList.add('hidden');
            el('loanResultEmpty').classList.remove('hidden');
            const shown = Object.keys(result.errors).some((key) => ln.submitted || ln.touched.has(key));
            el('loanResultEmptyText').textContent = shown ? 'Fix the highlighted fields to see the result.' : 'Enter an amount and a rate, then choose how the interest is calculated.';
            return;
        }
        el('loanResultEmpty').classList.add('hidden');
        el('loanResult').classList.remove('hidden');

        animateAmount(el('loanHeroValue'), result.instalment);
        el('loanHeroSub').textContent = `${plural(result.months, 'payment')} · ${formatDateDisplay(result.firstPaymentDate)} to ${formatDateDisplay(result.lastPaymentDate)}`
            + (result.lastInstalment !== result.instalment ? ` · last payment ${formatMoney(result.lastInstalment)}` : '');

        const flat = result.method === 'flat' && result.rate > 0;
        el('loanStats').innerHTML = [
            stat('Total interest', formatMoney(result.totalInterest), `${pct(result.rate)} a year, ${result.method === 'flat' ? 'flat' : 'reducing balance'}`, 'cost'),
            stat('Total to repay', formatMoney(result.totalPayments), 'borrowed + interest'),
            flat ? stat('Real yearly rate', `≈ ${pct(Math.round(result.effectiveRate * 100) / 100)}`, 'the same loan on a reducing balance')
                : stat('Last payment', formatDateDisplay(result.lastPaymentDate), plural(result.months, 'payment'))
        ].join('');
        const more = [];
        if (flat) more.push(stat('Last payment', formatDateDisplay(result.lastPaymentDate), plural(result.months, 'payment')));
        if (result.fees > 0) more.push(stat('With fees', formatMoney(result.totalCost), `includes ${formatMoney(result.fees)} upfront`));
        more.push(stat('Per day', formatMoney(result.costPerDay), 'monthly payment × 12 ÷ 365'));
        more.push(stat('Per year', formatMoney(result.costPerYear), '12 payments'));
        if (result.lastInstalment !== result.instalment) more.push(stat('Final payment', formatMoney(result.lastInstalment), 'adjusted for rounding'));
        el('loanStatsMore').innerHTML = more.join('');

        // Where the money goes: what was borrowed against what the loan costs
        const interestShare = result.totalPayments > 0 ? Math.round((result.totalInterest / result.totalPayments) * 1000) / 10 : 0;
        const borrowedShare = Math.round((100 - interestShare) * 10) / 10;
        el('loanSplit').innerHTML = `<div class="plan-split-bar" role="img" aria-label="Of everything you repay, ${borrowedShare}% is the amount borrowed and ${interestShare}% is interest">
                <span class="borrowed" style="width:${borrowedShare}%"></span><span class="interest" style="width:${interestShare}%"></span></div>
            <div class="plan-split-legend"><span><i class="dot borrowed" aria-hidden="true"></i>Borrowed <b>${escapeHtml(formatMoney(result.principal))}</b> · ${borrowedShare}%</span>
                <span><i class="dot interest" aria-hidden="true"></i>Interest <b>${escapeHtml(formatMoney(result.totalInterest))}</b> · ${interestShare}%</span></div>`;

        const box = (title, monthly, outstanding, note) => `<div class="plan-compare-box"><h3>${escapeHtml(title)}</h3>${note ? `<p>${escapeHtml(note)}</p>` : `<dl>
            <dt>Per day</dt><dd>${escapeHtml(formatMoney(monthly * 12 / 365))}</dd>
            <dt>Per month</dt><dd>${escapeHtml(formatMoney(monthly))}</dd>
            <dt>Per year</dt><dd>${escapeHtml(formatMoney(monthly * 12))}</dd>
            <dt>Still to pay</dt><dd>${escapeHtml(formatMoney(outstanding))}</dd></dl>`}</div>`;
        let combined;
        if (loadState.loans === 'failed' || loadState.loans === 'missing') {
            combined = box('All your loans + this one', 0, 0, 'Your saved loans could not be loaded, so the combined total is not available.');
        } else {
            const others = otherLoanTotals();
            combined = others.count
                ? box(`With your ${plural(others.count, 'other active loan')}`, others.monthly + result.instalment, others.outstanding + result.totalPayments)
                : box('All your loans + this one', 0, 0, 'You have no other active loans saved, so this loan is your total.');
        }
        el('loanCompare').innerHTML = box(ln.editingId ? 'This loan' : 'This new loan', result.instalment, result.totalPayments) + combined;

        renderLoanTable();
        updateSticky();
    }

    function renderLoanTable() {
        const result = ln.result;
        if (!result) return;
        const schedule = F.loanSchedule(result, ln.view, ln.page);
        ln.page = schedule.page;
        setChoice(el('loanView'), schedule.view);
        const now = today();
        const yearly = schedule.view === 'yearly';
        el('loanPeriodHead').textContent = yearly ? 'Year' : 'No.';
        el('loanTable').querySelector('tbody').innerHTML = schedule.rows.map((row) => {
            const date = yearly ? row.to : row.date;
            const cls = date < now ? 'is-past' : '';
            return `<tr class="${cls}"><th scope="row">${yearly ? `Year ${row.n}` : row.n}</th><td>${escapeHtml(yearly ? `to ${formatDateDisplay(row.to)}` : formatDateDisplay(row.date))}</td>` +
                `<td class="num">${plain(row.payment)}</td><td class="num">${plain(row.principal)}</td>` +
                `<td class="num">${plain(row.interest)}</td><td class="num">${plain(row.balance)}</td></tr>`;
        }).join('');
        renderPager('loanPager', 'loanPagerText', schedule, yearly ? 'year' : 'payment');
    }

    function resetLoanForm() {
        ln.editingId = null; ln.touched.clear(); ln.submitted = false; ln.page = 0; ln.method = '';
        el('loanAmount').value = ''; el('loanRate').value = ''; el('loanTerm').value = '5'; el('loanTermUnit').value = 'years';
        el('loanFirst').value = F.addMonths(today(), 1); el('loanFees').value = '';
        el('loanName').value = ''; el('loanLender').value = ''; el('loanRemindOn').checked = true; el('loanRemindDays').value = F.DEFAULT_LOAN_LEADS.join(', ');
        el('loanFormTitle').textContent = 'Loan calculator';
        el('loanSaveBtn').innerHTML = '<i class="fas fa-floppy-disk" aria-hidden="true"></i> Save loan';
        el('loanResetBtn').textContent = 'Clear';
        setSaveOpen('loan', false);
        renderLoan();
        renderLoanList();
    }

    function loadLoanIntoForm(row) {
        ln.touched.clear(); ln.submitted = false; ln.page = 0;
        ln.editingId = row.id;
        el('loanAmount').value = String(Number(row.principal));
        el('loanRate').value = String(Number(row.rate));
        const months = Number(row.term_months);
        const wholeYears = months % 12 === 0;
        el('loanTerm').value = String(wholeYears ? months / 12 : months);
        el('loanTermUnit').value = wholeYears ? 'years' : 'months';
        ln.method = row.method;
        el('loanFirst').value = row.first_payment_date;
        el('loanFees').value = Number(row.fees) ? String(Number(row.fees)) : '';
        el('loanName').value = row.name || '';
        el('loanLender').value = row.lender || '';
        el('loanRemindOn').checked = row.reminders_on !== false;
        el('loanRemindDays').value = (Array.isArray(row.reminder_days) && row.reminder_days.length ? row.reminder_days : F.DEFAULT_LOAN_LEADS).join(', ');
        el('loanFormTitle').textContent = 'Edit loan';
        el('loanSaveBtn').innerHTML = '<i class="fas fa-floppy-disk" aria-hidden="true"></i> Update loan';
        el('loanResetBtn').textContent = 'Cancel';
        setSaveOpen('loan', true);
        renderLoan();
        renderLoanList();
        el('loanForm').scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' });
        el('loanAmount').focus({ preventScroll: true });
    }

    async function submitLoan(event) {
        event.preventDefault();
        if (!currentUser) return showModal({ type: 'warning', title: 'Not signed in', message: 'Please log in first.' });
        if (!saveOpen('loan')) setSaveOpen('loan', true);
        ln.submitted = true;
        const result = F.calcLoan(loanInput());
        const errors = Object.assign({}, result.errors, loanSaveErrors(true));
        renderLoan();
        showErrors(ln, LOAN_FIELDS, errors);
        if (Object.keys(errors).length) {
            if (!focusFirstError(LOAN_FIELDS, errors) && errors.method) el('loanMethod').querySelector('button').focus();
            return showToast('error', 'Please fix the highlighted fields first.');
        }
        const existing = ln.editingId ? loans.find((l) => l.id === ln.editingId) : null;
        const reminders = el('loanRemindOn').checked;
        const row = {
            id: existing ? existing.id : uuid(),
            user_id: currentUser.id,
            name: el('loanName').value.trim().slice(0, 60),
            lender: el('loanLender').value.trim().slice(0, 60) || null,
            principal: result.principal, rate: result.rate, method: result.method, term_months: result.months,
            first_payment_date: result.firstPaymentDate, fees: result.fees, instalment: result.instalment,
            reminders_on: reminders,
            reminder_days: reminders ? F.readLeadDays(el('loanRemindDays').value, F.DEFAULT_LOAN_LEADS).days : (existing && Array.isArray(existing.reminder_days) ? existing.reminder_days : F.DEFAULT_LOAN_LEADS),
            status: existing ? existing.status : 'open',
            paid_through: existing ? (existing.paid_through || null) : null,
            updated_at: new Date().toISOString()
        };
        // A loan that started before today: earlier payments are taken as already paid, so it does not open as "overdue"
        if (!existing) row.paid_through = F.lastDueBefore(row, today()) || null;
        const button = el('loanSaveBtn');
        setBusy(button, true, 'Saving...');
        let restored = false;
        try {
            const outcome = await saveRow('loans', row);
            if (!outcome.saved && !outcome.queued) return;
            let linkNote = '';
            if (existing && outcome.saved && linkedLoanIds().has(row.id)) linkNote = (await syncLinkedRecurring(row)) ? '' : ' The recurring expense could not be updated; check it in Recurring.';
            setBusy(button, false); restored = true;
            resetLoanForm();
            showToast(outcome.queued ? 'info' : 'success', outcome.queued
                ? 'Kept on this device. It will be saved when you\'re back online.'
                : (existing ? `Loan updated.${linkNote}` : (row.paid_through ? 'Loan saved. Payments before today are counted as already paid.' : 'Loan saved')));
        } finally {
            if (!restored) setBusy(button, false);
            refreshReminders();
        }
    }

    // Saving Section: kept on the device when offline
    function isMissingTable(error) {
        const text = `${(error && error.code) || ''} ${(error && error.message) || ''} ${(error && error.details) || ''}`;
        return /42P01|42703|PGRST20[45]|does not exist|could not find the (table|column)|schema cache/i.test(text);
    }

    // Save the on-device copy, but never overwrite it with a list that failed to load.
    function persist() {
        if (!currentUser) return;
        const cache = read(`et_plan_${uid()}`, null) || {};
        if (!loadState.fixed_deposits) cache.deposits = deposits.filter((r) => !r._pending);
        if (!loadState.loans) cache.loans = loans.filter((r) => !r._pending);
        store(`et_plan_${uid()}`, cache);
        store(`et_plan_queue_${uid()}`, pending);
    }

    function putLocal(table, row) {
        const list = listOf(table);
        const i = list.findIndex((r) => r.id === row.id);
        if (i >= 0) list[i] = row; else list.push(row);
    }
    function dropLocal(table, id) { setList(table, listOf(table).filter((r) => r.id !== id)); }

    // Returns { saved } | { queued } | {} (refused: a message was shown and nothing was kept)
    async function saveRow(table, row) {
        const previous = listOf(table).find((r) => r.id === row.id);
        const restore = () => { if (previous) putLocal(table, previous); else dropLocal(table, row.id); };
        const queue = () => {
            pending = pending.filter((p) => p.row.id !== row.id).concat([{ table, row, error: '' }]);
            putLocal(table, Object.assign({}, row, { _pending: true }));
            persist();
            renderLists();
            return { queued: true };
        };
        if (loadState[table] === 'missing') {
            showModal({ type: 'warning', title: 'Saving isn\'t set up yet', message: `The calculator works, but this ${tableLabel(table)} can't be saved until the database is updated. Run supabase-schema.sql in the Supabase SQL Editor, then reload.` });
            return {};
        }
        if (!supabaseClient || !navigator.onLine) return queue();
        try {
            const { data, error } = await supabaseClient.from(table).upsert(row, { onConflict: 'id' }).select();
            if (error) throw error;
            pending = pending.filter((p) => p.row.id !== row.id);
            putLocal(table, (data && data[0]) || row);
            persist();
            renderLists();
            return { saved: true };
        } catch (err) {
            if (isNetworkError(err)) return queue();
            restore();
            renderLists();
            console.error(`Save ${table} error:`, err);
            if (isMissingTable(err)) {
                loadState[table] = 'missing';
                renderNotices();
                showModal({ type: 'warning', title: 'Saving isn\'t set up yet', message: `This ${tableLabel(table)} can't be saved until the database is updated. Run supabase-schema.sql in the Supabase SQL Editor, then reload.` });
            } else {
                showModal({ type: 'error', title: `Couldn't save this ${tableLabel(table)}`, message: (err && err.message) || 'Please try again.' });
            }
            return {};
        }
    }

    let flushing = false;
    async function flushPending({ announce = true } = {}) {
        if (flushing || !pending.length || !supabaseClient || !currentUser || !navigator.onLine) return;
        flushing = true;
        let done = 0;
        try {
            for (const item of pending.slice()) {
                if (loadState[item.table] === 'missing') { item.error = 'The database is not set up for this yet.'; continue; }
                try {
                    const { data, error } = await supabaseClient.from(item.table).upsert(item.row, { onConflict: 'id' }).select();
                    if (error) throw error;
                    pending = pending.filter((p) => p !== item);
                    putLocal(item.table, (data && data[0]) || item.row);
                    done++;
                } catch (err) {
                    if (isNetworkError(err)) break;                 // still offline: keep the rest for later
                    item.error = (err && err.message) || 'The server refused it.';   // shown on the card with Retry / Discard
                }
            }
        } finally {
            flushing = false;
            persist();
            renderLists();
            refreshReminders();
            if (done && announce) showToast('success', `${plural(done, 'saved item')} synced`);
        }
    }

    async function setStatus(table, id, status, { quiet = false } = {}) {
        const row = listOf(table).find((r) => r.id === id);
        if (!row) return false;
        try {
            requireOnline('Updating this');
            const { data, error } = await supabaseClient.from(table).update({ status, updated_at: new Date().toISOString() }).eq('id', id).select();
            if (error) throw error;
            if (!data || !data.length) throw new Error('That item could not be updated.');
            putLocal(table, data[0]);
            let paused = false;
            const entry = table === 'loans' && status === 'closed' ? linkedEntry(id) : null;
            if (entry && entry.active) {
                try { await updateRecurringRecord(entry.id, { active: false }); paused = true; renderRecurring(); updateDashboard(); }
                catch (err) { console.error('Could not pause the recurring entry:', err); }
            }
            persist();
            renderLists();
            refreshReminders();
            if (entry && entry.active && !paused) showToast('info', 'Closed, but its recurring expense is still running. Pause it in Recurring.', { duration: 7000 });
            else if (!quiet) showToast('success', status === 'closed' ? (paused ? 'Closed. Its reminders and recurring expense have stopped.' : 'Closed. Its reminders have stopped.') : 'Reopened');
            return true;
        } catch (err) {
            console.error('Status change error:', err);
            if (!quiet) showModal({ type: 'error', title: 'Couldn\'t update', message: (err && err.message) || 'Please try again.' });
            return false;
        }
    }

    async function removeRow(table, id) {
        const row = listOf(table).find((r) => r.id === id);
        if (!row) return;
        const label = tableLabel(table);
        if (row._pending) {            // never reached the server: just forget it
            pending = pending.filter((p) => p.row.id !== id);
            dropLocal(table, id);
            persist(); renderLists(); refreshReminders();
            return showToast('success', `Unsaved ${label} discarded`);
        }
        try {
            requireOnline(`Deleting a ${label}`);
            const { data, error } = await supabaseClient.from(table).delete().eq('id', id).select();
            if (error) throw error;
            if (!data || !data.length) throw new Error(`That ${label} could not be deleted.`);
        } catch (err) {
            console.error('Delete error:', err);
            return showModal({ type: 'error', title: 'Couldn\'t delete', message: (err && err.message) || 'Please try again.' });
        }
        dropLocal(table, id);
        if (table === 'loans' && ln.editingId === id) resetLoanForm();
        if (table === 'fixed_deposits' && (fd.editingId === id || fd.renewFromId === id)) resetFdForm();
        persist(); renderLists(); refreshReminders();
        const snapshot = Object.assign({}, row);
        delete snapshot._pending;
        showToast('success', `"${row.name}" deleted`, {
            actionLabel: 'Undo',
            onAction: async () => {
                const outcome = await saveRow(table, snapshot);
                if (outcome.saved || outcome.queued) { refreshReminders(); showToast('success', 'Restored'); }
            }
        });
    }

    // Deposit List Section
    const FD_BADGE = { upcoming: 'Starts soon', active: 'Active', matured: 'Matured', closed: 'Closed' };
    const PAYOUT_TEXT = { maturity: 'paid at maturity', monthly: 'paid monthly', quarterly: 'paid quarterly', yearly: 'paid yearly' };
    const button = (action, label, icon, cls = 'btn-outline') => `<button type="button" class="btn ${cls} btn-small" data-action="${action}"><i class="fas ${icon}" aria-hidden="true"></i> ${escapeHtml(label)}</button>`;
    const DELETE = (label = 'Delete') => button('delete', label, 'fa-trash-can', 'btn-ghost danger');

    // The first action is the one that matters now; the others wait in a "more" menu so a card stays calm
    function actionBar(items, name) {
        if (items.length <= 1) return items.join('');
        return `${items[0]}<details class="plan-menu"><summary class="btn btn-outline btn-small" aria-label="More actions for ${escapeHtml(name)}"><i class="fas fa-ellipsis" aria-hidden="true"></i></summary>
            <div class="plan-menu-list">${items.slice(1).join('')}</div></details>`;
    }

    function pendingCardBits(row) {
        const item = pending.find((p) => p.row.id === row.id);
        const failed = item && item.error;
        return {
            badge: `<span class="plan-badge unsaved">${failed ? 'Not saved' : 'Not saved yet'}</span>`,
            note: `<div class="plan-item-facts"><span>${escapeHtml(failed ? `The server refused it: ${item.error}` : 'Kept on this device. It will be saved when you\'re back online.')}</span></div>`,
            actions: [button('retry', 'Try again', 'fa-rotate'), DELETE('Discard')]
        };
    }

    function renderDepositList() {
        const host = el('fdList');
        if (!host) return;
        const now = today();
        const sorted = deposits.slice().sort((a, b) => (a.status === 'closed') - (b.status === 'closed') || String(a.maturity_date).localeCompare(String(b.maturity_date)));
        const open = sorted.filter((r) => r.status !== 'closed');
        let principal = 0, interest = 0;
        const cards = sorted.map((row) => {
            const calc = F.calcFd(F.fdInputFromRow(row), { today: now });
            const status = F.fdStatus(row, now);
            if (!calc.ok) {
                return `<article class="plan-item" data-id="${escapeHtml(row.id)}"><div class="plan-item-title">${escapeHtml(row.name)}</div>
                    <div class="plan-item-facts"><span>This deposit has details the calculator can't read. Edit it or delete it.</span></div>
                    <div class="plan-item-actions">${button('edit', 'Edit', 'fa-pen')}${button('delete', 'Delete', 'fa-trash-can', 'btn-ghost')}</div></article>`;
            }
            if (status !== 'closed') { principal += calc.principal; interest += calc.netInterest; }
            const bits = row._pending ? pendingCardBits(row) : null;
            const facts = [];
            if (status === 'active') facts.push(`<span>Earned so far <b>${escapeHtml(formatMoney(calc.earnedSoFar))}</b></span>`, `<span><b>${plural(calc.daysLeft, 'day')}</b> to go</span>`);
            if (status === 'upcoming') facts.push(`<span>Starts <b>${escapeHtml(formatDateDisplay(row.start_date))}</b></span>`);
            if (status === 'matured') facts.push(`<span>Matured <b>${escapeHtml(calc.daysLeft === 0 ? 'today' : F.relativeDay(calc.daysLeft))}</b></span>`, `<span>${row.interest_recorded ? '<b>Interest recorded as income</b>' : 'Interest not recorded yet'}</span>`);
            facts.push(`<span>Interest <b>${escapeHtml(formatMoney(calc.netInterest))}</b></span>`);
            facts.push(`<span>${row.reminders_on === false || status === 'closed' ? 'Reminders off' : `Reminders: ${escapeHtml((row.reminder_days || F.DEFAULT_FD_LEADS).map((d) => (d === 0 ? 'on the day' : `${d}d`)).join(', '))}`}</span>`);

            let actions;
            if (bits) actions = bits.actions;
            else if (status === 'closed') actions = [button('reopen', 'Reopen', 'fa-rotate-left'), DELETE()];
            else {
                actions = [];
                const unrecorded = status === 'matured' && !row.interest_recorded && calc.netInterest > 0;
                if (unrecorded) actions.push(button('record', 'Record interest as income', 'fa-arrow-trend-up', 'btn-primary'));
                if (status === 'matured') actions.push(button('renew', 'Renew', 'fa-rotate', unrecorded ? 'btn-outline' : 'btn-primary'));
                actions.push(button('edit', 'Edit', 'fa-pen'), button('close', status === 'matured' ? 'Close' : 'Close early', 'fa-box-archive'), DELETE());
            }
            return `<article class="plan-item ${status === 'closed' ? 'is-closed' : ''} ${row.id === fd.editingId ? 'is-editing' : ''}" data-id="${escapeHtml(row.id)}" id="fdItem-${escapeHtml(row.id)}">
                <div class="plan-item-top">
                    <div>
                        <div class="plan-item-title">${escapeHtml(row.name)}</div>
                        <div class="plan-item-sub">${row.bank ? `${escapeHtml(row.bank)} · ` : ''}${escapeHtml(pct(row.rate))} · ${escapeHtml(`${row.tenure_value} ${row.tenure_unit}`)} · ${PAYOUT_TEXT[row.payout] || ''}</div>
                    </div>
                    <div class="plan-item-amount"><b>${escapeHtml(formatMoney(calc.maturityAmount))}</b><span>on ${escapeHtml(formatDateDisplay(row.maturity_date))}</span></div>
                </div>
                <div>${bits ? bits.badge : `<span class="plan-badge ${status}">${FD_BADGE[status]}</span>`}</div>
                ${status === 'active' ? `<div class="plan-progress-bar" aria-hidden="true"><span style="width:${Math.round(calc.progress * 100)}%"></span></div>` : ''}
                <div class="plan-item-facts">${facts.join('')}</div>
                ${bits ? bits.note : ''}
                <div class="plan-item-actions">${actionBar(actions, row.name)}</div>
            </article>`;
        });
        el('fdListSummary').textContent = open.length ? `${plural(open.length, 'open deposit')} · ${formatMoney(principal)} placed · ${formatMoney(interest)} interest expected` : '';
        host.innerHTML = cards.join('') || `<div class="history-empty"><i class="fas fa-piggy-bank" aria-hidden="true"></i><div>${
            loadState.fixed_deposits === 'failed' ? 'Your saved deposits could not be loaded.' : 'No deposits saved yet.<br>Work one out above, give it a name and press Save to track it and get a reminder before it matures.'}</div></div>`;
    }

    async function recordInterest(id) {
        const row = deposits.find((d) => d.id === id);
        if (!row) return;
        const calc = F.calcFd(F.fdInputFromRow(row));
        if (!calc.ok || calc.netInterest <= 0) return;
        try {
            requireOnline('Recording the interest');
            // Claim it first: if another device already recorded it, nothing matches and no second income is added
            const claim = await supabaseClient.from('fixed_deposits').update({ interest_recorded: true, updated_at: new Date().toISOString() })
                .eq('id', id).eq('interest_recorded', false).select();
            if (claim.error) throw claim.error;
            if (!claim.data || !claim.data.length) {
                putLocal('fixed_deposits', Object.assign({}, row, { interest_recorded: true }));
                renderDepositList();
                return showToast('info', 'This interest was already recorded.');
            }
            try {
                await addIncome(calc.netInterest, `FD interest: ${row.name}`.slice(0, 60), dueNoonISO(row.maturity_date));
            } catch (err) {
                await supabaseClient.from('fixed_deposits').update({ interest_recorded: false }).eq('id', id);
                throw err;
            }
            putLocal('fixed_deposits', claim.data[0]);
            persist();
            renderDepositList();
            updateDashboard();
            if (el('historyScreen').classList.contains('active')) renderHistory();
            showToast('success', `${formatMoney(calc.netInterest)} added to your income on ${formatDateDisplay(row.maturity_date)}`);
        } catch (err) {
            console.error('Record interest error:', err);
            showModal({ type: 'error', title: 'Couldn\'t record the interest', message: (err && err.message) || 'Please try again.' });
        }
    }

    function onDepositListClick(event) {
        const actionButton = event.target.closest('[data-action]');
        const card = event.target.closest('.plan-item');
        if (!actionButton || !card) return;
        const id = card.dataset.id;
        const row = deposits.find((d) => d.id === id);
        if (!row) return;
        const action = actionButton.dataset.action;
        if (action === 'edit') return loadFdIntoForm(row);
        if (action === 'renew') return loadFdIntoForm(row, { renew: true });
        if (action === 'record') return recordInterest(id);
        if (action === 'close') return setStatus('fixed_deposits', id, 'closed');
        if (action === 'reopen') return setStatus('fixed_deposits', id, 'open');
        if (action === 'retry') return flushPending();
        if (action === 'delete') return removeRow('fixed_deposits', id);
    }

    // Loan List Section: and the link to recurring expenses
    const LOAN_BADGE = { upcoming: 'Starts soon', active: 'Active', finished: 'Paid off', closed: 'Closed' };
    const linkedLoanIds = () => new Set(recurring.filter((r) => r.loan_id).map((r) => r.loan_id));
    const linkedEntry = (loanId) => recurring.find((r) => r.loan_id === loanId) || null;
    // Payments count as made automatically only while the recurring entry is running
    const autoPaidLoanIds = () => new Set(recurring.filter((r) => r.loan_id && r.active).map((r) => r.loan_id));
    // A loan whose recurring entry is paused or finished: everything before the entry's next date was already posted
    function trackedLoan(row) {
        const entry = linkedEntry(row.id);
        if (!entry || entry.active) return row;
        const posted = F.lastDueBefore(row, entry.next_due);
        return posted && (!row.paid_through || posted > row.paid_through) ? Object.assign({}, row, { paid_through: posted }) : row;
    }

    function renderLoanList() {
        const host = el('loanList');
        if (!host) return;
        const now = today();
        const linked = linkedLoanIds();
        const auto = autoPaidLoanIds();
        const totals = { count: 0, monthly: 0, outstanding: 0 };
        const sorted = loans.slice().sort((a, b) => (a.status === 'closed') - (b.status === 'closed') || String(a.first_payment_date).localeCompare(String(b.first_payment_date)));
        const cards = sorted.map((row) => {
            const isLinked = linked.has(row.id);
            const isAuto = auto.has(row.id);
            const progress = F.loanProgress(trackedLoan(row), now, { autoPaid: isAuto });
            if (!progress.ok) {
                return `<article class="plan-item" data-id="${escapeHtml(row.id)}"><div class="plan-item-title">${escapeHtml(row.name)}</div>
                    <div class="plan-item-facts"><span>This loan has details the calculator can't read. Edit it or delete it.</span></div>
                    <div class="plan-item-actions">${button('edit', 'Edit', 'fa-pen')}${button('delete', 'Delete', 'fa-trash-can', 'btn-ghost')}</div></article>`;
            }
            const result = progress.result;
            const status = progress.status;
            const live = status === 'active' || status === 'upcoming';
            const left = result.schedule.slice(progress.paidCount).reduce((s, r) => s + r.payment, 0);
            if (live) { totals.count++; totals.monthly += result.instalment; totals.outstanding += left; }
            const bits = row._pending ? pendingCardBits(row) : null;
            const overdue = progress.overdue.length;
            const facts = [];
            if (live && progress.nextDue) facts.push(`<span>Next payment <b>${escapeHtml(formatDateDisplay(progress.nextDue))}</b> (${escapeHtml(F.relativeDay(F.daysBetween(now, progress.nextDue)))})</span>`);
            facts.push(`<span>Paid <b>${progress.paidCount} of ${progress.total}</b></span>`);
            if (live) facts.push(`<span>Still to pay <b>${escapeHtml(formatMoney(left))}</b></span>`);
            facts.push(`<span>Ends <b>${escapeHtml(formatDateDisplay(result.lastPaymentDate))}</b></span>`);
            facts.push(`<span>${isAuto ? 'Payments are added to your expenses automatically' : isLinked ? 'Its recurring entry is paused: resume it in Recurring' : (row.reminders_on === false || !live ? 'Reminders off' : `Reminders: ${escapeHtml((row.reminder_days || F.DEFAULT_LOAN_LEADS).map((d) => (d === 0 ? 'on the day' : `${d}d`)).join(', '))}`)}</span>`);

            let actions = [];
            let linkPanel = '';
            if (bits) actions = bits.actions;
            else if (status === 'closed') actions = [button('reopen', 'Reopen', 'fa-rotate-left'), DELETE()];
            else {
                const canMark = !isLinked && live && progress.firstUnpaid && F.daysBetween(now, progress.firstUnpaid) <= 7;
                if (canMark) actions.push(button('paid', `Mark ${formatDateDisplay(progress.firstUnpaid, { includeYear: false })} paid`, 'fa-check', 'btn-primary'));
                if (live) actions.push(isLinked ? button('unlink', 'Remove from recurring', 'fa-link-slash') : button('link', 'Add to recurring', 'fa-repeat'));
                actions.push(button('edit', 'Edit', 'fa-pen'), button('close', 'Close', 'fa-box-archive'), DELETE());
                if (ln.linkingId === row.id && !isLinked) linkPanel = linkPanelHtml(row);
            }
            return `<article class="plan-item ${status === 'closed' ? 'is-closed' : ''} ${row.id === ln.editingId ? 'is-editing' : ''}" data-id="${escapeHtml(row.id)}" id="loanItem-${escapeHtml(row.id)}">
                <div class="plan-item-top">
                    <div>
                        <div class="plan-item-title">${escapeHtml(row.name)}</div>
                        <div class="plan-item-sub">${row.lender ? `${escapeHtml(row.lender)} · ` : ''}${escapeHtml(formatMoney(row.principal))} · ${escapeHtml(pct(row.rate))} ${row.method === 'flat' ? 'flat' : 'reducing'} · ${escapeHtml(plural(Number(row.term_months), 'month'))}</div>
                    </div>
                    <div class="plan-item-amount"><b>${escapeHtml(formatMoney(result.instalment))}</b><span>a month</span></div>
                </div>
                <div>${bits ? bits.badge : `<span class="plan-badge ${status}">${LOAN_BADGE[status]}</span>`}${overdue ? ` <span class="plan-badge overdue">${plural(overdue, 'payment')} overdue</span>` : ''}${isLinked ? ' <span class="plan-badge">In recurring</span>' : ''}</div>
                <div class="plan-progress-bar" aria-hidden="true"><span style="width:${Math.round((progress.paidCount / progress.total) * 100)}%"></span></div>
                <div class="plan-item-facts">${facts.join('')}</div>
                ${bits ? bits.note : ''}
                ${linkPanel}
                <div class="plan-item-actions">${actionBar(actions, row.name)}</div>
            </article>`;
        });

        const totalsBox = el('loanTotals');
        totalsBox.classList.toggle('hidden', !totals.count);
        if (totals.count) {
            totalsBox.innerHTML = stat('Per day', formatMoney(totals.monthly * 12 / 365)) + stat('Per month', formatMoney(totals.monthly)) +
                stat('Per year', formatMoney(totals.monthly * 12)) + stat('Still to pay', formatMoney(totals.outstanding));
        }
        el('loanListSummary').textContent = totals.count ? `${plural(totals.count, 'active loan')}, all together` : '';
        host.innerHTML = cards.join('') || `<div class="history-empty"><i class="fas fa-hand-holding-dollar" aria-hidden="true"></i><div>${
            loadState.loans === 'failed' ? 'Your saved loans could not be loaded.' : 'No loans saved yet.<br>Work one out above, give it a name and press Save to track it and get a reminder before each payment.'}</div></div>`;
    }

    function linkPanelHtml(row) {
        const options = (items, selected) => items.map((i) => `<option value="${escapeHtml(i.key)}" ${i.key === selected ? 'selected' : ''}>${escapeHtml(i.label)}</option>`).join('');
        const categories = activeTaxonomy(CATEGORIES);
        const payments = activeTaxonomy(PAYMENTS);
        const guess = /car|kereta|motor|vehicle/i.test(row.name) && categories.some((c) => c.key === 'car') ? 'car' : (categories.some((c) => c.key === 'other') ? 'other' : (categories[0] || {}).key);
        return `<div class="plan-more" data-link-panel>
            <p class="plan-sub" style="margin:12px 0">Adds ${escapeHtml(formatMoney(row.instalment))} to your expenses on each due date, starting with the next one, and stops by itself after the last payment.</p>
            <div class="field-row">
                <div class="input-group"><label for="linkCategory-${escapeHtml(row.id)}">Category</label><select id="linkCategory-${escapeHtml(row.id)}" class="filter-select" data-link-category>${options(categories, guess)}</select></div>
                <div class="input-group"><label for="linkPayment-${escapeHtml(row.id)}">Paid with</label><select id="linkPayment-${escapeHtml(row.id)}" class="filter-select" data-link-payment>${options(payments, payments.some((p) => p.key === 'bank') ? 'bank' : (payments[0] || {}).key)}</select></div>
            </div>
            <div class="plan-item-actions" style="margin-bottom:12px">${button('link-confirm', 'Add to recurring', 'fa-check', 'btn-primary')}${button('link-cancel', 'Cancel', 'fa-xmark', 'btn-ghost')}</div>
        </div>`;
    }

    function recurringFieldsFor(row) {
        const now = today();
        const progress = F.loanProgress(row, now, { autoPaid: true });
        if (!progress.ok) return null;
        const next = progress.result.schedule.map((r) => r.date).find((d) => d >= now);
        if (!next) return null;
        return {
            name: row.name, amount: progress.result.instalment, frequency: 'monthly',
            start_date: row.first_payment_date,     // keeps the day of the month (e.g. the 31st) as the anchor
            next_due: next, end_date: progress.result.lastPaymentDate, active: true
        };
    }

    async function linkLoan(id, category, payment, trigger) {
        const row = loans.find((l) => l.id === id);
        if (!row) return;
        const fields = recurringFieldsFor(row);
        if (!fields) return showToast('info', 'This loan has no payments left to add.');
        if (recurringLoadError) return showModal({ type: 'warning', title: 'Recurring isn\'t set up yet', message: 'Run supabase-schema.sql in the Supabase SQL Editor, then reload.' });
        setBusy(trigger, true, 'Adding...');
        try {
            requireOnline('Adding to recurring');
            const { data, error } = await supabaseClient.from('recurring_expenses')
                .insert([Object.assign({ user_id: currentUser.id, category, payment, loan_id: id }, fields)]).select();
            if (error) throw error;
            if (data && data.length) recurring.push(data[0]);
            recurring.sort((a, b) => a.next_due.localeCompare(b.next_due));
            ln.linkingId = null;
            const added = await processRecurring({ silent: true });   // a payment due today is posted straight away
            renderRecurring();
            renderLoanList();
            updateDashboard();
            refreshReminders();
            showToast('success', `Added to recurring${added ? `: ${plural(added, 'payment')} posted` : ''}. It ends on ${formatDateDisplay(fields.end_date)}.`);
        } catch (err) {
            console.error('Link loan error:', err);
            setBusy(trigger, false);
            showModal({
                type: 'error', title: 'Couldn\'t add to recurring',
                message: isMissingTable(err) ? 'The database needs an update first. Run supabase-schema.sql in the Supabase SQL Editor, then reload. Your loan is still saved.'
                    : /duplicate|unique/i.test((err && err.message) || '') ? 'This loan is already in your recurring expenses. Reload to see it.'
                        : `${(err && err.message) || 'Please try again.'} Your loan is still saved.`
            });
        }
    }

    // After a linked loan is edited: keep the recurring entry's amount, name and dates in step
    async function syncLinkedRecurring(row) {
        const entry = linkedEntry(row.id);
        const fields = recurringFieldsFor(row);
        if (!entry) return true;
        try {
            if (!fields) await updateRecurringRecord(entry.id, { active: false });
            else await updateRecurringRecord(entry.id, { name: fields.name, amount: fields.amount, start_date: fields.start_date, next_due: fields.next_due, end_date: fields.end_date });
            renderRecurring();
            updateDashboard();
            return true;
        } catch (err) {
            console.error('Recurring sync error:', err);
            return false;
        }
    }

    async function deleteRecurringEntry(entry) {
        const { data, error } = await supabaseClient.from('recurring_expenses').delete().eq('id', entry.id).select();
        if (error) throw error;
        if (!data || !data.length) throw new Error('The recurring entry could not be removed.');
        recurring = recurring.filter((r) => r.id !== entry.id);
        renderRecurring();
        updateDashboard();
    }

    function unlinkLoan(id) {
        const row = loans.find((l) => l.id === id);
        const entry = linkedEntry(id);
        if (!row || !entry) return;
        showModal({
            type: 'question', title: 'Remove from recurring?',
            message: `"${row.name}" will stop being added to your expenses. Payments already added are kept, and the loan stays here.`,
            confirmText: 'Remove', cancelText: 'Keep it',
            onConfirm: async () => {
                try {
                    requireOnline('Removing from recurring');
                    await deleteRecurringEntry(entry);
                    // From here the loan is marked paid by hand again; start from today so it does not open as overdue
                    const paidThrough = F.lastDueBefore(row, today()) || null;
                    await supabaseClient.from('loans').update({ paid_through: paidThrough }).eq('id', id);
                    putLocal('loans', Object.assign({}, row, { paid_through: paidThrough }));
                    persist(); renderLoanList(); refreshReminders();
                    showToast('success', 'Removed from recurring');
                } catch (err) {
                    console.error('Unlink error:', err);
                    showModal({ type: 'error', title: 'Couldn\'t remove it', message: (err && err.message) || 'Please try again.' });
                }
            }
        });
    }

    async function markPaid(id) {
        const row = loans.find((l) => l.id === id);
        if (!row) return;
        const progress = F.loanProgress(row, today());
        if (!progress.ok || !progress.firstUnpaid) return;
        const before = row.paid_through || null;
        const apply = async (value) => {
            requireOnline('Updating this loan');
            const { data, error } = await supabaseClient.from('loans').update({ paid_through: value, updated_at: new Date().toISOString() }).eq('id', id).select();
            if (error) throw error;
            if (!data || !data.length) throw new Error('That loan could not be updated.');
            putLocal('loans', data[0]);
            persist(); renderLoanList(); refreshReminders();
        };
        try {
            await apply(progress.firstUnpaid);
            showToast('success', `${formatDateDisplay(progress.firstUnpaid)} marked as paid`, {
                actionLabel: 'Undo',
                onAction: async () => { try { await apply(before); } catch (err) { showToast('error', (err && err.message) || 'Couldn\'t undo'); } }
            });
        } catch (err) {
            console.error('Mark paid error:', err);
            showModal({ type: 'error', title: 'Couldn\'t mark it paid', message: (err && err.message) || 'Please try again.' });
        }
    }

    function deleteLoan(id) {
        const row = loans.find((l) => l.id === id);
        if (!row) return;
        const entry = row._pending ? null : linkedEntry(id);
        if (!entry) return removeRow('loans', id);
        showModal({
            type: 'warning', title: 'Delete loan and its recurring entry?',
            message: `"${row.name}" is in your recurring expenses. Deleting the loan also removes that recurring entry, so no more payments are added. Payments already added to your expenses are kept. To keep everything, cancel and use Close instead.`,
            confirmText: 'Delete both', cancelText: 'Cancel', danger: true,
            onConfirm: async () => {
                try {
                    requireOnline('Deleting a loan');
                    await deleteRecurringEntry(entry);
                } catch (err) {
                    console.error('Delete linked recurring error:', err);
                    return showModal({ type: 'error', title: 'Couldn\'t delete', message: `${(err && err.message) || 'Please try again.'} Nothing was deleted.` });
                }
                removeRow('loans', id);
            }
        });
    }

    function onLoanListClick(event) {
        const actionButton = event.target.closest('[data-action]');
        const card = event.target.closest('.plan-item');
        if (!actionButton || !card) return;
        const id = card.dataset.id;
        const row = loans.find((l) => l.id === id);
        if (!row) return;
        const action = actionButton.dataset.action;
        if (action === 'edit') return loadLoanIntoForm(row);
        if (action === 'paid') return markPaid(id);
        if (action === 'link') { ln.linkingId = id; renderLoanList(); const select = card.ownerDocument.getElementById(`linkCategory-${id}`); if (select) select.focus(); return; }
        if (action === 'link-cancel') { ln.linkingId = null; return renderLoanList(); }
        if (action === 'link-confirm') return linkLoan(id, card.querySelector('[data-link-category]').value, card.querySelector('[data-link-payment]').value, actionButton);
        if (action === 'unlink') return unlinkLoan(id);
        if (action === 'close') return setStatus('loans', id, 'closed');
        if (action === 'reopen') return setStatus('loans', id, 'open');
        if (action === 'retry') return flushPending();
        if (action === 'delete') return deleteLoan(id);
    }

    // Notices Section
    function renderNotices() {
        const blocked = telegram.known && telegram.linked && telegram.blocked
            ? '<div><i class="fas fa-bell-slash" aria-hidden="true"></i> Telegram reminders have stopped because the bot was blocked or its chat was deleted. Open the bot and press Start, or reconnect it in Account. Until then your reminders show here in the app.</div>'
            : '';
        [['fixed_deposits', 'fdNotice', 'deposits'], ['loans', 'loanNotice', 'loans']].forEach(([table, id, word]) => {
            const box = el(id);
            if (!box) return;
            const state = loadState[table];
            let html = '';
            if (state === 'missing') html = `<div><i class="fas fa-triangle-exclamation" aria-hidden="true"></i> The calculator works, but saving ${word} isn't set up in your database yet. Run <b>supabase-schema.sql</b> in the Supabase SQL Editor, then reload.</div>`;
            else if (state === 'failed') html = `<div><i class="fas fa-triangle-exclamation" aria-hidden="true"></i> Your saved ${word} could not be loaded. The calculator still works. <button type="button" class="link-btn" data-plan-retry>Try again</button></div>`;
            else if (state === 'offline') html = `<div><i class="fas fa-wifi" aria-hidden="true"></i> You're offline: showing the ${word} saved on this device. The calculator works as usual.</div>`;
            box.classList.toggle('info', state === 'offline');
            box.innerHTML = html + blocked;
            box.classList.toggle('hidden', !html && !blocked);
        });
    }

    // Reminders Section: dashboard strip and the one pop-up
    function reminders() {
        if (!F || !currentUser) return [];
        return F.dueReminders(deposits, loans.map(trackedLoan), today(), { lateDays: 30, autoPaidLoanIds: Array.from(autoPaidLoanIds()) });
    }

    function reminderText(r) {
        const date = formatDateDisplay(r.dueDate);
        if (r.kind === 'fd') {
            if (r.group === 'overdue') return `Matured ${F.relativeDay(r.daysLeft)} (${date}). Record the interest, renew it or close it.`;
            return r.daysLeft === 0 ? `Matures today (${date})` : `Matures ${F.relativeDay(r.daysLeft)} · ${date}`;
        }
        if (r.group === 'overdue') return r.count > 1 ? `${r.count} payments overdue · latest was due ${date}` : `Payment was due ${F.relativeDay(r.daysLeft)} (${date})`;
        return r.daysLeft === 0 ? `Payment due today (${date})` : `Payment due ${F.relativeDay(r.daysLeft)} · ${date}`;
    }

    function reminderRow(r) {
        return `<button type="button" class="reminder-row ${r.group}" data-kind="${r.kind}" data-id="${escapeHtml(r.id)}">
            <span class="reminder-icon" aria-hidden="true"><i class="fas ${r.kind === 'fd' ? 'fa-piggy-bank' : 'fa-hand-holding-dollar'}"></i></span>
            <span class="reminder-text"><b>${escapeHtml(r.name)}</b><span>${escapeHtml(reminderText(r))}</span></span>
            <span class="reminder-amount">${escapeHtml(formatMoney(r.amount))}</span>
        </button>`;
    }

    // The dashboard's "Coming up" card draws these itself (app.js), so there is one list, not two
    function renderDueSoon() {
        if (typeof renderUpcoming === 'function' && currentUser) renderUpcoming();
    }

    const GROUP_TITLE = { overdue: 'Needs attention', today: 'Today', soon: 'Coming up' };
    function openReminders({ manual = false } = {}) {
        const list = reminders();
        const sheet = el('remindersSheet');
        if (!list.length && !manual) return false;
        let html = '';
        ['overdue', 'today', 'soon'].forEach((group) => {
            const rows = list.filter((r) => r.group === group);
            if (rows.length) html += `<div class="reminder-group ${group}">${GROUP_TITLE[group]}</div>${rows.map(reminderRow).join('')}`;
        });
        el('remindersList').innerHTML = html || '<div class="history-empty small">Nothing is due. Reminders for your deposits and loans will appear here.</div>';
        el('remindersSub').textContent = list.length ? `${plural(list.length, 'item')} from your deposits and loans. Tap one to open it.` : '';
        el('remindersSnooze').checked = false;
        el('remindersSnooze').closest('label').classList.toggle('hidden', !list.length);
        lastFocus = document.activeElement;
        sheet.classList.add('active');
        syncBodyScroll();
        el('remindersDone').focus();
        return true;
    }

    function closeReminders() {
        const sheet = el('remindersSheet');
        if (!sheet.classList.contains('active')) return;
        const snooze = el('remindersSnooze').checked;
        sheet.classList.remove('active');
        syncBodyScroll();
        if (lastFocus && typeof lastFocus.focus === 'function' && document.contains(lastFocus)) lastFocus.focus();
        if (snooze) snoozeReminders();
    }

    async function snoozeReminders() {
        const until = Date.now() + 24 * 3600 * 1000;
        prefs.snoozeUntil = until;
        store(`et_remind_snooze_${uid()}`, until);       // the device copy: works offline and if the account copy fails
        let synced = false;
        if (supabaseClient && currentUser && navigator.onLine && !prefs.unavailable) {
            try {
                const { error } = await supabaseClient.from('user_preferences').upsert(
                    { user_id: currentUser.id, reminder_snooze_until: new Date(until).toISOString(), updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
                synced = !error;
            } catch (_) { /* the device copy still applies */ }
        }
        showToast('info', synced ? 'Reminder pop-up hidden for 24 hours on all your devices' : 'Reminder pop-up hidden for 24 hours on this device');
    }

    function popupAllowed() {
        if (prefs.popup === 'never') return false;
        if (prefs.popup === 'always') return true;
        // Automatic: Telegram already tells them, so stay quiet. Unknown or blocked counts as "not connected".
        return !(telegram.known && telegram.linked && !telegram.blocked);
    }

    // At most once per visit, never on top of another dialog (it waits and tries again a few times)
    function maybeShowPopup(attempt = 0) {
        clearTimeout(popupTimer);
        if (popupShown || !currentUser) return;
        if (Date.now() < prefs.snoozeUntil || !popupAllowed() || !reminders().length) return;
        const busy = document.querySelector('.modal-overlay-full.active, .report-view.active') || document.body.classList.contains('is-auth');
        if (busy) {
            if (attempt < 15) popupTimer = setTimeout(() => maybeShowPopup(attempt + 1), 4000);
            return;
        }
        popupShown = openReminders();
    }

    function refreshReminders() {
        renderDueSoon();
    }

    function openItem(kind, id) {
        closeReminders();
        navigate('plan');
        setSegment(kind === 'fd' ? 'deposits' : 'loans');
        const card = el(`${kind === 'fd' ? 'fdItem' : 'loanItem'}-${id}`);
        if (!card) return;
        card.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'center' });
        card.classList.add('is-editing');
        setTimeout(() => { if (card.dataset.id !== fd.editingId && card.dataset.id !== ln.editingId) card.classList.remove('is-editing'); }, 2200);
        const first = card.querySelector('button');
        if (first) first.focus({ preventScroll: true });
    }

    function onReminderClick(event) {
        const row = event.target.closest('.reminder-row');
        if (row) openItem(row.dataset.kind, row.dataset.id);
    }

    // Reminder Settings Section: Account
    function hourLabel(h) {
        const suffix = h < 12 ? 'am' : 'pm';
        const hour = h % 12 === 0 ? 12 : h % 12;
        return `${hour}:00 ${suffix}`;
    }

    function settingsStatus(message, error = false) {
        const status = el('reminderSettingsStatus');
        status.textContent = message;
        status.classList.toggle('error', error);
    }

    function renderSettings() {
        const select = el('reminderHour');
        if (!select) return;
        if (!select.options.length) {
            for (let h = 0; h < 24; h++) select.add(new Option(`${hourLabel(h)} (Malaysia time)`, String(h)));
        }
        select.value = String(prefs.hour);
        el('reminderPopup').value = prefs.popup;
        el('reminderHideAmounts').checked = prefs.hideAmounts;
        if (prefs.unavailable) return settingsStatus('Reminder settings can\'t be saved until the database is updated. Run supabase-schema.sql in Supabase, then reload. The defaults apply until then.', true);
        if (telegram.known && telegram.linked && telegram.blocked) return settingsStatus('Telegram reminders have stopped because the bot was blocked. Open the bot and press Start, or reconnect it above.', true);
        settingsStatus(telegram.known
            ? (telegram.linked ? 'Telegram is connected: reminders are sent there at the time above.' : 'Telegram is not connected, so reminders show in the app only.')
            : 'Reminders are always listed on your dashboard.');
    }

    async function saveSettings() {
        if (!currentUser || !supabaseClient) return showToast('error', 'Sign in to save reminder settings.');
        const hour = Number(el('reminderHour').value);
        const popup = el('reminderPopup').value;
        if (!Number.isInteger(hour) || hour < 0 || hour > 23) return settingsStatus('Choose a send time from the list.', true);
        if (!['auto', 'always', 'never'].includes(popup)) return settingsStatus('Choose one of the pop-up options.', true);
        const button = el('saveReminderSettingsBtn');
        setBusy(button, true, 'Saving...');
        try {
            requireOnline('Saving reminder settings');
            const { error } = await supabaseClient.from('user_preferences').upsert({
                user_id: currentUser.id, reminder_hour: hour, reminder_popup: popup, reminder_hide_amounts: el('reminderHideAmounts').checked, updated_at: new Date().toISOString()
            }, { onConflict: 'user_id' });
            if (error) throw error;
            prefs.hour = hour; prefs.popup = popup; prefs.hideAmounts = el('reminderHideAmounts').checked; prefs.unavailable = false;
            renderSettings();
            showToast('success', 'Reminder settings saved');
        } catch (err) {
            console.error('Reminder settings error:', err);
            if (isMissingTable(err)) { prefs.unavailable = true; renderSettings(); }
            else settingsStatus((err && err.message) || 'Could not save. Please try again.', true);
        } finally {
            setBusy(button, false);
        }
    }

    async function loadPrefs() {
        const local = Number(read(`et_remind_snooze_${uid()}`, 0)) || 0;
        prefs = { hour: 9, hideAmounts: false, popup: 'auto', snoozeUntil: local, unavailable: false };
        if (!supabaseClient || !navigator.onLine) return;
        try {
            const { data, error } = await supabaseClient.from('user_preferences')
                .select('reminder_hour,reminder_hide_amounts,reminder_popup,reminder_snooze_until').eq('user_id', currentUser.id).maybeSingle();
            if (error) throw error;
            if (!data) return;
            if (Number.isInteger(data.reminder_hour) && data.reminder_hour >= 0 && data.reminder_hour <= 23) prefs.hour = data.reminder_hour;
            prefs.hideAmounts = !!data.reminder_hide_amounts;
            if (['auto', 'always', 'never'].includes(data.reminder_popup)) prefs.popup = data.reminder_popup;
            const remote = data.reminder_snooze_until ? Date.parse(data.reminder_snooze_until) : 0;
            prefs.snoozeUntil = Math.max(local, Number.isFinite(remote) ? remote : 0);   // whichever device snoozed last
        } catch (err) {
            if (!isNetworkError(err)) prefs.unavailable = true;   // old database: defaults + the device copy of the snooze
        }
    }

    async function loadTelegram() {
        telegram = { known: false, linked: false, blocked: false };
        if (!supabaseClient || !navigator.onLine) return;
        try {
            const { data, error } = await supabaseClient.functions.invoke('telegram-link', { body: { action: 'status' } });
            if (error || !data) return;
            telegram = { known: true, linked: !!data.linked, blocked: !!data.remindersBlocked };
        } catch (_) { /* unknown: the in-app pop-up covers it */ }
    }

    // Loading Section
    async function load() {
        if (!currentUser || loading) return;
        loading = true;
        const user = currentUser.id;
        pending = read(`et_plan_queue_${user}`, []);
        if (!Array.isArray(pending)) pending = [];
        const cached = read(`et_plan_${user}`, null) || {};
        const fetchTable = async (table) => {
            const cache = Array.isArray(cached[table === 'loans' ? 'loans' : 'deposits']) ? cached[table === 'loans' ? 'loans' : 'deposits'] : [];
            if (!supabaseClient || !navigator.onLine) { loadState[table] = 'offline'; return cache; }
            try {
                const { data, error } = await supabaseClient.from(table).select('*');
                if (error) throw error;
                loadState[table] = '';
                return data || [];
            } catch (err) {
                if (isNetworkError(err)) { loadState[table] = 'offline'; return cache; }
                console.warn(`${table} unavailable:`, err);
                loadState[table] = isMissingTable(err) ? 'missing' : 'failed';
                return [];
            }
        };
        try {
            const [d, l] = await Promise.all([fetchTable('fixed_deposits'), fetchTable('loans'), loadPrefs(), loadTelegram()]);
            if (!currentUser || currentUser.id !== user) return;   // signed out (or switched account) while loading
            deposits = d; loans = l;
            pending.forEach((item) => putLocal(item.table, Object.assign({}, item.row, { _pending: true })));
            persist();
            render();
            renderSettings();
            refreshReminders();
            await flushPending();
            maybeShowPopup();
        } finally {
            loading = false;
        }
    }

    function renderLists() { renderDepositList(); renderLoanList(); renderNotices(); }

    function render() {
        if (!started || !F) return;
        renderNotices();
        if (segment === 'deposits') { renderFd(); renderDepositList(); }
        if (segment === 'loans') { renderLoan(); renderLoanList(); }
    }

    // Logout clears the saved copy from this device; deleting the account clears everything.
    function forgetDevice(userId, { everything = false } = {}) {
        if (!userId) return;
        try {
            localStorage.removeItem(`et_plan_${userId}`);
            if (everything) {
                localStorage.removeItem(`et_plan_queue_${userId}`);
                localStorage.removeItem(`et_remind_snooze_${userId}`);
            }
        } catch (_) { /* storage blocked: nothing was stored either */ }
    }

    function reset() {
        clearTimeout(popupTimer);
        deposits = []; loans = []; pending = [];
        loadState.fixed_deposits = ''; loadState.loans = '';
        telegram = { known: false, linked: false, blocked: false };
        prefs = { hour: 9, hideAmounts: false, popup: 'auto', snoozeUntil: 0, unavailable: false };
        popupShown = false; loading = false; ln.linkingId = null;
        if (!started) return;
        el('remindersSheet').classList.remove('active');
        resetFdForm();
        resetLoanForm();
        setSegment('recurring', { remember: false });
        renderLists();
        renderDueSoon();
    }

    // Wiring Section: called once by app.js
    function bindForm(state, fields, form, renderFn, own = []) {
        Object.keys(fields).forEach((key) => {
            const input = el(fields[key]);
            if (!own.includes(key)) input.addEventListener('input', () => { state.page = 0; renderFn(); });
            input.addEventListener('blur', () => { state.touched.add(key); renderFn(); });
        });
        // Enter saves only once the save fields are open; before that it just finishes the field (the sum is already live)
        form.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' || event.target.tagName !== 'INPUT' || event.target.type === 'checkbox') return;
            event.preventDefault();
            if (form.querySelector('.plan-save').classList.contains('hidden')) event.target.blur();
            else form.requestSubmit();
        });
    }

    function init() {
        if (started) return;
        if (!F) { console.error('finance-calc.js did not load: the Plan calculators are unavailable.'); return; }
        started = true;

        // sections
        const tabs = document.querySelector('.plan-tabs');
        tabs.addEventListener('click', (event) => { const tab = event.target.closest('[data-plan-tab]'); if (tab) setSegment(tab.dataset.planTab); });
        tabs.addEventListener('keydown', (event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const i = SEGMENTS.indexOf(segment);
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? SEGMENTS.length - 1 : (i + (event.key === 'ArrowRight' ? 1 : -1) + SEGMENTS.length) % SEGMENTS.length;
            setSegment(SEGMENTS[next], { focus: true });
        });

        // fixed deposit form
        bindForm(fd, FD_FIELDS, el('fdForm'), renderFd, ['maturityDate']);   // the maturity box has its own handler below
        el('fdMaturity').addEventListener('input', () => {
            const auto = F.fdAutoMaturity(el('fdStart').value, Number(el('fdTenure').value), el('fdTenureUnit').value);
            fd.manualMaturity = !!el('fdMaturity').value && el('fdMaturity').value !== auto;
            fd.touched.add('maturityDate');
            fd.page = 0;
            renderFd();
        });
        el('fdMaturityReset').addEventListener('click', () => { fd.manualMaturity = false; fd.touched.delete('maturityDate'); renderFd(); el('fdMaturity').focus(); });
        ['fdTenureUnit', 'fdBasis', 'fdRemindOn'].forEach((id) => el(id).addEventListener('change', () => { fd.page = 0; renderFd(); }));
        el('fdPayout').addEventListener('click', (event) => { const b = event.target.closest('[data-value]'); if (!b) return; fd.payout = b.dataset.value; fd.page = 0; setChoice(el('fdPayout'), fd.payout); renderFd(); });
        el('fdView').addEventListener('click', (event) => { const b = event.target.closest('[data-value]'); if (!b) return; fd.view = b.dataset.value; fd.page = 0; renderFdTable(); });
        el('fdPager').addEventListener('click', (event) => { const b = event.target.closest('[data-page]'); if (!b || b.disabled) return; fd.page += b.dataset.page === 'next' ? 1 : -1; renderFdTable(); });
        el('fdSaveToggle').addEventListener('click', () => setSaveOpen('fd', true, { focus: true }));
        el('fdTenurePresets').addEventListener('click', (event) => {
            const b = event.target.closest('.preset'); if (!b) return;
            el('fdTenure').value = b.dataset.preset; el('fdTenureUnit').value = b.dataset.unit;
            fd.manualMaturity = false; fd.page = 0; renderFd();
        });
        el('fdForm').addEventListener('submit', submitFd);
        el('fdResetBtn').addEventListener('click', () => resetFdForm());
        el('fdList').addEventListener('click', onDepositListClick);

        // loan form
        bindForm(ln, LOAN_FIELDS, el('loanForm'), renderLoan);
        ['loanTermUnit', 'loanRemindOn'].forEach((id) => el(id).addEventListener('change', () => { ln.page = 0; renderLoan(); }));
        el('loanMethod').addEventListener('click', (event) => { const b = event.target.closest('[data-value]'); if (!b) return; ln.method = b.dataset.value; ln.touched.add('method'); ln.page = 0; renderLoan(); });
        el('loanView').addEventListener('click', (event) => { const b = event.target.closest('[data-value]'); if (!b) return; ln.view = b.dataset.value; ln.page = 0; renderLoanTable(); });
        el('loanPager').addEventListener('click', (event) => { const b = event.target.closest('[data-page]'); if (!b || b.disabled) return; ln.page += b.dataset.page === 'next' ? 1 : -1; renderLoanTable(); });
        el('loanSaveToggle').addEventListener('click', () => setSaveOpen('loan', true, { focus: true }));
        el('loanTermPresets').addEventListener('click', (event) => {
            const b = event.target.closest('.preset'); if (!b) return;
            el('loanTerm').value = b.dataset.preset; el('loanTermUnit').value = b.dataset.unit;
            ln.page = 0; renderLoan();
        });
        el('loanForm').addEventListener('submit', submitLoan);
        el('loanResetBtn').addEventListener('click', () => resetLoanForm());
        el('loanList').addEventListener('click', onLoanListClick);

        // notices, reminders, settings
        el('recurringScreen').addEventListener('click', (event) => { if (event.target.closest('[data-plan-retry]')) load(); });
        el('remindersList').addEventListener('click', onReminderClick);
        el('remindersClose').addEventListener('click', closeReminders);
        el('remindersDone').addEventListener('click', closeReminders);
        el('remindersSheet').addEventListener('click', (event) => { if (event.target === el('remindersSheet')) closeReminders(); });
        el('saveReminderSettingsBtn').addEventListener('click', saveSettings);
        window.addEventListener('online', () => { if (currentUser) { if (loadState.fixed_deposits === 'offline' || loadState.loans === 'offline') load(); else flushPending(); } });
        document.addEventListener('visibilitychange', () => { if (!document.hidden && currentUser) renderDueSoon(); });   // a new day may have started

        // the answer bar (phones) hides whenever the real result card is on screen
        el('planStickyBtn').addEventListener('click', () => {
            el(segment === 'loans' ? 'loanResultTitle' : 'fdResultTitle').scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' });
        });
        if ('IntersectionObserver' in window) {
            const watch = new IntersectionObserver((entries) => {
                entries.forEach((entry) => { heroSeen[entry.target.id === 'loanResult' ? 'loan' : 'fd'] = entry.isIntersecting; });
                updateSticky();
            }, { threshold: 0 });
            watch.observe(el('fdResult'));
            watch.observe(el('loanResult'));
        } else { heroSeen.fd = true; heroSeen.loan = true; }   // no observer: never show the bar rather than show it wrongly
        // a "more" menu closes when something else is tapped
        document.addEventListener('click', (event) => {
            document.querySelectorAll('.plan-menu[open]').forEach((menu) => { if (!menu.contains(event.target)) menu.open = false; });
        });

        let remembered = 'recurring';
        try { remembered = localStorage.getItem('et_plan_tab') || 'recurring'; } catch (_) { /* default */ }
        el('fdStart').value = today();
        el('loanFirst').value = F.addMonths(today(), 1);
        setSegment(remembered, { remember: false });
    }

    return {
        init, load, reset, render, setSegment, renderSettings, renderDueSoon,
        closeReminders, openReminders, openItem, forgetDevice, upcoming: reminders, reminderText,
        remindersOpen: () => !!el('remindersSheet') && el('remindersSheet').classList.contains('active')
    };
})();
