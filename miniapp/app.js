/* miniapp/app.js
 *
 * The Mini App controller: wires the bridge (Telegram), the data service and the screens together.
 * Rules it follows:
 *   - every request carries Telegram's signed launch data; there is no login screen and no stored password;
 *   - nothing is shown from an old request after a newer one was made (a counter guards every async result);
 *   - any failure ends in a screen that explains it, never a blank page;
 *   - charts are optional: if Chart.js is missing, the numbers and lists are still there.
 */
(function () {
    'use strict';

    var F = window.MiniFormat, I18n = window.MiniI18n, Bridge = window.MiniBridge, Api = window.MiniApi, Views = window.MiniViews, Demo = window.MiniDemo;
    var $ = function (id) { return document.getElementById(id); };
    var rootEl = document.documentElement;
    var main = $('main');
    var tabs = $('tabs');
    var bar = $('bar');
    var sheetHost = $('sheet-host');
    var toastEl = $('toast');
    var fab = $('fab');
    var banner = $('banner');

    var params = new URLSearchParams(location.search);
    var config = window.APP_CONFIG || {};
    var bridge = Bridge.create(window);
    var demoMode = params.get('demo') === '1' && !bridge.isTelegram;

    var state = {
        lang: I18n.asLang((bridge.user && bridge.user.language_code) || navigator.language || 'en'),
        tab: 'overview', offset: 0, maxOffset: 60, maxDaysBack: 400, today: F.dayKey(new Date().toISOString()),
        month: null, categories: [], payments: [], sheet: null, status: 'loading', problemCode: '',
        history: { items: [], total: 0, sum: 0, category: '', q: '', loading: false },
    };
    if (demoMode && ['overview', 'days', 'budgets', 'trend', 'history'].indexOf(params.get('tab')) !== -1) state.tab = params.get('tab'); // preview only
    var api = null;
    var views = null;
    var charts = {};
    var monthToken = 0, historyToken = 0, searchTimer = null, toastTimer = null;

    function t(key, vars) { return I18n.t(state.lang, key, vars); }
    function refreshViews() { views = Views.create(state); }

    // ---------------------------------------------------------------- helpers

    function applyDom(scope) {
        // widths and colours were written as data-* attributes (inline styles are not allowed): apply them with the style API
        Array.prototype.forEach.call(scope.querySelectorAll('[data-w]'), function (el) { el.style.width = Math.max(0, Math.min(100, Number(el.getAttribute('data-w')) || 0)) + '%'; });
        Array.prototype.forEach.call(scope.querySelectorAll('[data-color]'), function (el) { el.style.setProperty('--cat-color', F.safeColor(el.getAttribute('data-color'), '#6b7280')); });
    }

    function toast(message, kind) {
        toastEl.textContent = message;
        toastEl.className = 'toast show' + (kind ? ' ' + kind : '');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { toastEl.className = 'toast'; }, 2400);
    }

    function destroyCharts() {
        Object.keys(charts).forEach(function (k) { try { charts[k].destroy(); } catch (_) { /* ignore */ } });
        charts = {};
    }

    function themeColors() {
        var cs = getComputedStyle(rootEl);
        return { text: cs.getPropertyValue('--text').trim() || '#0f172a', hint: cs.getPropertyValue('--muted').trim() || '#5b6785', grid: cs.getPropertyValue('--border').trim() || '#e4e7f0', accent: cs.getPropertyValue('--brand').trim() || '#4f46e5', bg: cs.getPropertyValue('--surface').trim() || '#ffffff' };
    }

    // ---------------------------------------------------------------- rendering

    function render() {
        destroyCharts();
        refreshViews();
        bar.innerHTML = state.status === 'ready' ? views.monthBar() : '';
        tabs.innerHTML = state.status === 'ready' ? views.tabBar() : '';
        tabs.hidden = bar.hidden = state.status !== 'ready';
        fab.hidden = state.status !== 'ready' || Boolean(state.sheet);
        var html;
        if (state.status === 'loading') html = views.skeleton();
        else if (state.status === 'problem') html = views.problem(state.problemCode, { demoUrl: !bridge.isTelegram });
        else if (!state.month) html = views.skeleton();
        else html = views[state.tab === 'trend' ? 'trend' : state.tab]();
        main.innerHTML = html;
        sheetHost.innerHTML = views ? views.sheet() : '';
        applyDom(main);
        applyDom(sheetHost);
        banner.hidden = !demoMode;
        banner.textContent = demoMode ? t('preview_banner') : '';
        document.title = t('app_title');
        rootEl.lang = state.lang === 'zh' ? 'zh-CN' : state.lang === 'ms' ? 'ms' : 'en';
        if (state.status === 'ready' && state.month) drawCharts();
        if (state.sheet) { var first = sheetHost.querySelector('input[name="amount"]'); if (first && !state.sheet.focused) { state.sheet.focused = true; try { first.focus({ preventScroll: true }); } catch (_) { /* ignore */ } } }
    }

    function drawCharts() {
        if (typeof window.Chart !== 'function') return; // no chart library: the lists below still show everything
        var c = themeColors();
        var data = state.month;
        try {
            window.Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
            window.Chart.defaults.color = c.hint;
            var donut = $('chart-donut');
            if (donut && state.tab === 'overview') {
                var list = views.slices(data);
                charts.donut = new window.Chart(donut, {
                    type: 'doughnut',
                    data: { labels: list.map(function (s) { return s.label; }), datasets: [{ data: list.map(function (s) { return s.amount; }), backgroundColor: list.map(function (s) { return F.safeColor(s.color, s.fallback); }), borderColor: c.bg, borderWidth: 2 }] },
                    options: { cutout: '68%', responsive: true, maintainAspectRatio: true, animation: { duration: 400 }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (ctx) { return ' ' + F.money(ctx.parsed); } } } } },
                });
            }
            var daysEl = $('chart-days');
            if (daysEl && state.tab === 'days') {
                var shown = data.todayIndex === null ? data.days : data.todayIndex + 1;
                charts.days = new window.Chart(daysEl, {
                    type: 'bar',
                    data: { labels: data.daily.slice(0, shown).map(function (_, i) { return String(i + 1); }), datasets: [{ data: data.daily.slice(0, shown), backgroundColor: c.accent, borderRadius: 3, maxBarThickness: 14 }] },
                    options: { responsive: true, maintainAspectRatio: false, animation: { duration: 400 }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (ctx) { return ' ' + F.money(ctx.parsed.y); } } } }, scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } }, y: { beginAtZero: true, grid: { color: c.grid }, ticks: { maxTicksLimit: 4, callback: function (v) { return F.compactMoney(v); } } } } },
                });
            }
            var trendEl = $('chart-trend');
            if (trendEl && state.tab === 'trend') {
                charts.trend = new window.Chart(trendEl, {
                    type: 'bar',
                    data: { labels: data.monthStarts.map(function (s) { return F.monthShort(s, state.lang); }), datasets: [{ data: data.monthTotals, backgroundColor: data.monthTotals.map(function (_, i) { return i === data.monthTotals.length - 1 ? c.accent : c.accent + '33'; }), borderRadius: 6, maxBarThickness: 36 }] },
                    options: { responsive: true, maintainAspectRatio: false, animation: { duration: 400 }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (ctx) { return ' ' + F.money(ctx.parsed.y); } } } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid: { color: c.grid }, ticks: { maxTicksLimit: 4, callback: function (v) { return F.compactMoney(v); } } } } },
                });
            }
        } catch (_) { /* a chart failure must never break the page */ }
    }

    function showProblem(error) {
        state.status = 'problem';
        state.problemCode = error && error.code ? error.code : 'unavailable';
        render();
    }

    // ---------------------------------------------------------------- data

    function loadMonth() {
        var token = ++monthToken;
        state.status = state.month ? 'ready' : 'loading';
        if (!state.month) render();
        return api.month(state.offset).then(function (res) {
            if (token !== monthToken) return;
            state.month = res.data;
            state.status = 'ready';
            render();
        }, function (error) {
            if (token !== monthToken) return;
            if (state.month) { toast(t(error.code === 'network' ? 'err_network' : 'err_generic'), 'error'); state.status = 'ready'; render(); } else showProblem(error);
        });
    }

    function loadHistory(append) {
        var hs = state.history;
        var token = ++historyToken;
        hs.loading = true;
        if (!append) { hs.items = []; hs.total = 0; hs.sum = 0; }
        if (state.tab === 'history') render();
        return api.transactions({ offset: state.offset, category: hs.category, q: hs.q, skip: append ? hs.items.length : 0, limit: 50 }).then(function (res) {
            if (token !== historyToken) return;
            hs.items = append ? hs.items.concat(res.items) : res.items;
            hs.total = res.total; hs.sum = res.sum; hs.loading = false;
            if (state.tab === 'history') { keepSearchFocus(); }
        }, function (error) {
            if (token !== historyToken) return;
            hs.loading = false;
            toast(t(error.code === 'network' ? 'err_network' : 'err_generic'), 'error');
            if (state.tab === 'history') render();
        });
    }

    function keepSearchFocus() {
        var active = document.activeElement && document.activeElement.id === 'search';
        var pos = active ? document.activeElement.selectionStart : 0;
        render();
        if (active) { var el = $('search'); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (_) { /* ignore */ } } }
    }

    function refreshAll() {
        var jobs = [loadMonth()];
        if (state.tab === 'history') jobs.push(loadHistory(false));
        return Promise.all(jobs);
    }

    // ---------------------------------------------------------------- actions

    function setTab(id) {
        if (state.tab === id) return;
        state.tab = id;
        bridge.haptic('select');
        if (id === 'history') loadHistory(false); else render();
        window.scrollTo(0, 0);
    }

    function changeMonth(delta) {
        var next = state.offset + delta;
        if (next < 0 || next > state.maxOffset) return;
        state.offset = next;
        bridge.haptic('select');
        state.month = null; state.status = 'loading';
        render();
        var jobs = [loadMonth()];
        state.history.items = []; state.history.total = 0;
        if (state.tab === 'history') jobs.push(loadHistory(false));
        return Promise.all(jobs);
    }

    function openSheet(mode, item, values) {
        state.sheet = { mode: mode, item: item || null, values: values || null, error: '', saving: false, confirmDelete: false, focused: false };
        render();
    }
    function closeSheet() { state.sheet = null; render(); }

    function readForm() {
        var form = $('expense-form');
        var data = new FormData(form);
        var get = function (k) { return String(data.get(k) == null ? '' : data.get(k)); };
        return { amount: get('amount').trim(), merchant: get('merchant').trim(), category: get('category'), payment: get('payment'), date: get('date'), note: get('note').trim() };
    }

    function validate(v) {
        var maxAmount = 1000000;
        var amount = v.amount.replace(',', '.');
        if (!/^\d{1,7}(\.\d{1,2})?$/.test(amount) || Number(amount) < 0.01 || Number(amount) > maxAmount) return { field: 'amount', message: t('v_amount') };
        if (!state.categories.some(function (c) { return c.key === v.category; })) return { field: 'category', message: t('v_category') };
        if (!state.payments.some(function (p) { return p.key === v.payment; })) return { field: 'payment', message: t('v_payment') };
        if (v.date && (!/^\d{4}-\d{2}-\d{2}$/.test(v.date) || v.date > state.today || v.date < views.minDate(state.today, state.maxDaysBack))) return { field: 'date', message: t('v_date') };
        return null;
    }

    function saveForm() {
        var s = state.sheet;
        if (!s || s.saving) return;
        var v = readForm();
        s.values = v;
        var problem = validate(v);
        if (problem) { s.error = problem.message; render(); bridge.haptic('error'); var el = sheetHost.querySelector('[name="' + problem.field + '"]'); if (el) el.focus(); return; }
        s.error = ''; s.saving = true;
        var editing = s.mode === 'edit';
        var payload = { amount: v.amount.replace(',', '.'), merchant: v.merchant, category: v.category, payment: v.payment, note: v.note };
        if (v.date) payload.date = v.date;
        if (editing) { // send only what changed, so an item whose category was later disabled can still be edited
            var item = s.item;
            var diff = {};
            if (Number(payload.amount) !== Number(item.amount)) diff.amount = payload.amount;
            if (payload.merchant !== (item.merchant || '')) diff.merchant = payload.merchant;
            if (payload.category !== item.category) diff.category = payload.category;
            if (payload.payment !== item.payment) diff.payment = payload.payment;
            var oldNote = item.note && item.note !== 'via Telegram' && item.note !== 'via Mini App' ? item.note : '';
            if (payload.note !== oldNote) diff.note = payload.note;
            if (payload.date && payload.date !== F.dayKey(item.created_at)) diff.date = payload.date;
            if (!Object.keys(diff).length) { closeSheet(); return; }
            payload = diff;
        }
        render();
        var request = editing ? api.updateExpense(s.item.id, payload) : api.addExpense(payload);
        request.then(function () {
            state.sheet = null;
            bridge.haptic('success');
            toast(t('saved_toast'), 'ok');
            return refreshAll();
        }, function (error) {
            s.saving = false;
            s.error = error.code === 'invalid' ? (error.field && ['amount', 'category', 'payment', 'date'].indexOf(error.field) !== -1 ? t('v_' + error.field) : t('v_server')) : error.code === 'network' ? t('err_network') : error.code === 'limit' ? t('err_limit') : error.code === 'not_found' ? t('err_generic') : t('err_generic');
            bridge.haptic('error');
            render();
        });
    }

    function deleteItem() {
        var s = state.sheet;
        if (!s || s.saving || !s.item) return;
        if (!s.confirmDelete) { s.confirmDelete = true; bridge.haptic('warning'); render(); return; }
        s.saving = true;
        api.deleteExpense(s.item.id).then(function () {
            state.sheet = null;
            bridge.haptic('success');
            toast(t('deleted_toast'), 'ok');
            return refreshAll();
        }, function (error) {
            s.saving = false; s.confirmDelete = false;
            s.error = error.code === 'network' ? t('err_network') : t('err_generic');
            render();
        });
    }

    function showHeat(index) {
        var data = state.month;
        var key = F.keyOfMonthDay(data.start, index);
        var out = $('heat-detail');
        if (out) out.textContent = F.formatKey(key, state.lang, { weekday: 'long', day: 'numeric', month: 'long' }) + ' · ' + F.money(data.daily[index] || 0);
        bridge.haptic('select');
    }

    function pickCategory(key) {
        state.history.category = key;
        state.tab = 'history';
        bridge.haptic('select');
        loadHistory(false);
        window.scrollTo(0, 0);
    }

    // ---------------------------------------------------------------- events

    document.addEventListener('click', function (event) {
        var target = event.target.closest ? event.target.closest('[data-action]') : null;
        if (!target || target.disabled) return;
        var action = target.getAttribute('data-action');
        if (action === 'search') return;
        switch (action) {
            case 'tab': setTab(target.getAttribute('data-tab')); break;
            case 'month-prev': changeMonth(1); break;
            case 'month-next': changeMonth(-1); break;
            case 'add': openSheet('add'); break;
            case 'edit': {
                var id = target.getAttribute('data-id');
                var item = state.history.items.filter(function (i) { return String(i.id) === id; })[0];
                if (item) openSheet('edit', item);
                break;
            }
            case 'close-sheet': closeSheet(); break;
            case 'delete': deleteItem(); break;
            case 'retry': start(); break;
            case 'close': bridge.close(); break;
            case 'open-website': bridge.openLink(location.origin + location.pathname.replace(/miniapp\/[^/]*$/, '')); break;
            case 'demo': location.search = '?demo=1'; break;
            case 'heat-pick': showHeat(Number(target.getAttribute('data-index'))); break;
            case 'pick-category': pickCategory(target.getAttribute('data-key')); break;
            case 'filter-category': state.history.category = target.getAttribute('data-key') || ''; bridge.haptic('select'); loadHistory(false); break;
            case 'load-more': loadHistory(true); break;
            default: break;
        }
    });

    document.addEventListener('submit', function (event) {
        if (event.target && event.target.id === 'expense-form') { event.preventDefault(); saveForm(); }
    });

    document.addEventListener('input', function (event) {
        if (event.target && event.target.id === 'search') {
            clearTimeout(searchTimer);
            var value = event.target.value;
            searchTimer = setTimeout(function () { state.history.q = value.slice(0, 60); loadHistory(false); }, 350);
        }
    });

    document.addEventListener('keydown', function (event) { if (event.key === 'Escape' && state.sheet) closeSheet(); });

    bridge.onTheme(function () { bridge.applyTheme(rootEl); applyHeaderColor(); if (state.status === 'ready') render(); });

    function applyHeaderColor() {
        var bg = getComputedStyle(rootEl).getPropertyValue('--bg').trim();
        if (/^#[0-9a-f]{6}$/i.test(bg)) bridge.setColors(bg);
    }

    // ---------------------------------------------------------------- start

    function start() {
        state.status = 'loading'; state.month = null;
        render();
        bridge.applyTheme(rootEl);
        bridge.start();
        applyHeaderColor();
        if (!demoMode && !bridge.isTelegram) { showProblem({ code: 'open_telegram' }); return Promise.resolve(); }
        if (!Bridge.frameAllowed(window)) { showProblem({ code: 'open_telegram' }); return Promise.resolve(); }
        if (!api) {
            api = demoMode
                ? Demo.create({ lang: state.lang })
                : Api.create({ baseUrl: config.SUPABASE_URL, anonKey: config.SUPABASE_ANON_KEY, getInitData: function () { return bridge.initData; } });
        }
        if (!demoMode && !config.SUPABASE_URL) { showProblem({ code: 'unavailable' }); return Promise.resolve(); }
        return api.bootstrap().then(function (res) {
            state.lang = I18n.asLang(res.lang || state.lang);
            state.today = res.today || state.today;
            state.categories = res.categories || [];
            state.payments = res.payments || [];
            state.maxOffset = res.maxOffset || 60;
            state.maxDaysBack = res.maxDaysBack || 400;
            return Promise.all([loadMonth(), state.tab === 'history' ? loadHistory(false) : null]).then(function () { if (demoMode && params.get('sheet') === 'add') openSheet('add'); });
        }, showProblem);
    }

    window.addEventListener('error', function () { /* a stray script error should not leave a blank page */ if (state.status === 'loading') showProblem({ code: 'unavailable' }); });
    start();
})();
