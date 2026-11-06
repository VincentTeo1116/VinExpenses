/* miniapp/views.js
 *
 * Builds the HTML of every screen from plain data. The look follows the VinExpenses website (same cards, colours, icons).
 * These are pure functions (data in, HTML text out), which keeps the rules easy to check:
 *   - everything that came from a person or the server goes through escapeHtml before it is placed in HTML;
 *   - no inline style="" attributes (the page's security policy forbids them): widths and colours are written as data-w /
 *     data-color attributes and applied by app.js with the DOM style API after the HTML is in place;
 *   - every control has a text label or aria-label, and every interactive element is a real <button> or <input>.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./format.js'), require('./i18n.js'));
    else root.MiniViews = factory(root.MiniFormat, root.MiniI18n);
})(typeof self !== 'undefined' ? self : this, function (F, I18n) {
    'use strict';

    var h = F.escapeHtml;
    var TABS = [
        { id: 'overview', icon: 'fa-house', key: 'tab_overview' },
        { id: 'days', icon: 'fa-calendar-days', key: 'tab_days' },
        { id: 'budgets', icon: 'fa-bullseye', key: 'tab_budgets' },
        { id: 'trend', icon: 'fa-chart-line', key: 'tab_trend' },
        { id: 'history', icon: 'fa-clock-rotate-left', key: 'tab_history' },
    ];
    var icon = function (name) { return '<i class="fas ' + h(name) + '" aria-hidden="true"></i>'; };

    function create(state) {
        var t = function (key, vars) { return I18n.t(state.lang, key, vars); };

        function category(key) {
            var found = (state.categories || []).filter(function (c) { return c.key === key; })[0];
            var builtIn = Object.prototype.hasOwnProperty.call(F.COLORS, key) ? F.COLORS[key] : F.PALETTE[7];
            return {
                key: key,
                label: found ? found.label : key,
                color: F.safeColor(found && found.color, builtIn),
                icon: F.iconFor(key),
            };
        }
        function payment(key) {
            var found = (state.payments || []).filter(function (p) { return p.key === key; })[0];
            return found ? found.label : key;
        }
        var countText = function (n) { return t(n === 1 ? 'expense_count_one' : 'expense_count_many', { n: n }); };

        // ------------------------------------------------------------ chrome

        function monthBar() {
            var data = state.month;
            var title = data ? F.monthTitle(data.start, state.lang) : '';
            var maxOffset = state.maxOffset || 60;
            return '<header class="month-bar"><div class="month-selector">' +
                '<button type="button" class="month-nav-btn" data-action="month-prev" aria-label="' + h(t('prev_month')) + '"' + (state.offset >= maxOffset ? ' disabled' : '') + '><i class="fas fa-chevron-left" aria-hidden="true"></i></button>' +
                '<h1 class="month-display">' + h(title || t('loading')) + '</h1>' +
                '<button type="button" class="month-nav-btn" data-action="month-next" aria-label="' + h(t('next_month')) + '"' + (state.offset <= 0 ? ' disabled' : '') + '><i class="fas fa-chevron-right" aria-hidden="true"></i></button>' +
                '</div></header>';
        }

        function tabBar() {
            return TABS.map(function (tab) {
                var active = state.tab === tab.id;
                return '<button type="button" role="tab" class="nav-item' + (active ? ' active' : '') + '" data-action="tab" data-tab="' + tab.id + '" aria-selected="' + active + '"' + (active ? ' aria-current="page"' : '') + '>' +
                    icon(tab.icon) + '<span class="nav-label">' + h(t(tab.key)) + '</span></button>';
            }).join('');
        }

        function skeleton() {
            return '<div class="skeleton" aria-busy="true" aria-label="' + h(t('loading')) + '">' +
                '<div class="sk-card sk-hero"></div><div class="sk-card sk-chart"></div><div class="sk-card sk-list"></div></div>';
        }

        function emptyMonth() {
            return '<section class="card empty"><div class="empty-icon" aria-hidden="true"><i class="fas fa-seedling"></i></div><h2>' + h(t('no_data')) + '</h2><p>' + h(t('no_data_hint')) + '</p>' +
                '<button type="button" class="btn btn-primary" data-action="add">' + h(t('add_expense')) + '</button></section>';
        }

        /** A full-screen explanation: code is an ApiError code or 'open_telegram'. */
        function problem(code, extra) {
            var map = {
                open_telegram: ['fa-lock', 'err_open_telegram', 'err_open_telegram_hint'],
                unauthorized: ['fa-lock', 'err_open_telegram', 'err_open_telegram_hint'],
                expired: ['fa-hourglass-half', 'err_expired', 'err_expired_hint'],
                not_linked: ['fa-link', 'err_not_linked', 'err_not_linked_hint'],
                limit: ['fa-ban', 'err_limit', 'err_limit'],
                network: ['fa-wifi', 'err_network', 'err_generic'],
            };
            var entry = map[code] || ['fa-circle-exclamation', 'err_generic', 'err_generic'];
            var buttons = '';
            if (code === 'network' || (!map[code] && code !== 'open_telegram')) buttons += '<button type="button" class="btn btn-primary" data-action="retry">' + h(t('retry')) + '</button>';
            if (code === 'expired' || code === 'unauthorized') buttons += '<button type="button" class="btn btn-outline" data-action="close">' + h(t('close')) + '</button>';
            if (code === 'not_linked' || code === 'open_telegram') buttons += '<button type="button" class="btn btn-primary" data-action="open-website">' + h(t('open_website')) + '</button>';
            if (code === 'open_telegram' && extra && extra.demoUrl) buttons += '<button type="button" class="btn btn-outline" data-action="demo">' + h(t('try_preview')) + '</button>';
            return '<section class="card problem" role="alert"><div class="empty-icon" aria-hidden="true">' + icon(entry[0]) + '</div><h2>' + h(t(entry[1])) + '</h2>' +
                '<p>' + h(t(entry[2])) + '</p><div class="btn-row">' + buttons + '</div></section>';
        }

        // ------------------------------------------------------------ overview

        function insightText(i) {
            if (i.kind === 'cat') return { icon: category(i.key).icon, text: t(i.up ? 'ins_cat_up' : 'ins_cat_down', { cat: category(i.key).label, pct: i.pct + '%' }) };
            if (i.kind === 'weekend') return { icon: i.weekendHeavy ? 'fa-champagne-glasses' : 'fa-briefcase', text: t(i.weekendHeavy ? 'ins_weekend_heavy' : 'ins_weekday_heavy', { x: i.ratio }) };
            var name = i.key === 'all' ? t('budget_overall') : category(i.key).label;
            return i.warn
                ? { icon: 'fa-triangle-exclamation', text: t('ins_pace_warn', { name: name, pct: Math.round(i.projected * 100) + '%' }) }
                : { icon: 'fa-bullseye', text: t('ins_pace_ok', { name: name, used: Math.round(i.used * 100) + '%', day: i.day }) };
        }

        /** The slices of the donut and the list rows: the top 6 categories, then everything else together. */
        function slices(data) {
            var top = data.byCategory.slice(0, 6);
            var rest = data.byCategory.slice(6);
            var list = top.map(function (entry, i) {
                var info = category(entry[0]);
                return { key: entry[0], label: info.label, icon: info.icon, color: info.color, amount: entry[1], fallback: F.PALETTE[i % F.PALETTE.length] };
            });
            if (rest.length) {
                list.push({ key: '', label: t('others'), icon: 'fa-ellipsis', color: F.PALETTE[7], amount: rest.reduce(function (s, e) { return s + e[1]; }, 0), count: rest.length, fallback: F.PALETTE[7] });
            }
            return list;
        }

        function overview() {
            var data = state.month;
            if (!data.count) return emptyMonth();
            var change = data.previousCount ? F.trend(data.total, data.previousTotal) : null;
            var pills = '';
            if (change) pills += '<span class="delta ' + (change.flat ? '' : change.up ? 'up' : 'down') + '">' + h(change.arrow + ' ' + change.text + ' ' + t('vs_last')) + '</span>';
            if (data.streak >= 2) pills += '<span class="delta"><i class="fas fa-fire" aria-hidden="true"></i> ' + h(t('streak', { n: data.streak })) + '</span>';
            var meta = '';
            if (data.income > 0) {
                var rate = Math.max(0, (data.income - data.total) / data.income);
                var net = data.income - data.total;
                meta = '<div class="total-meta">' +
                    '<span class="meta-pill"><i class="fas fa-arrow-down" aria-hidden="true"></i>' + h(t('income')) + ' <b>' + h(F.money(data.income)) + '</b></span>' +
                    '<span class="meta-pill' + (net < 0 ? ' negative' : '') + '"><i class="fas fa-scale-balanced" aria-hidden="true"></i>' + h(t('net')) + ' <b>' + h(F.money(net)) + '</b></span>' +
                    '<span class="meta-pill"><i class="fas fa-piggy-bank" aria-hidden="true"></i>' + h(t('saved')) + ' <b>' + h(F.percent(rate)) + '</b></span></div>';
            }
            var list = slices(data);
            var rows = list.map(function (s) {
                var share = data.total > 0 ? s.amount / data.total : 0;
                var name = s.key ? s.label : s.label + (s.count ? ' (' + s.count + ')' : '');
                var body = '<span class="cat-ico" data-color="' + h(s.color) + '">' + icon(s.icon) + '</span>' +
                    '<span class="cat-main"><span class="cat-name">' + h(name) + '</span><span class="cat-bar"><span data-w="' + (Math.min(1, share) * 100).toFixed(1) + '" data-color="' + h(s.color) + '"></span></span></span>' +
                    '<span class="cat-amt"><b>' + h(F.money(s.amount)) + '</b><small>' + h(F.percent(share)) + '</small></span>';
                return s.key
                    ? '<li><button type="button" class="cat-row" data-action="pick-category" data-key="' + h(s.key) + '">' + body + '</button></li>'
                    : '<li><div class="cat-row static">' + body + '</div></li>';
            }).join('');
            var insights = (data.insights || []).map(insightText).slice(0, 3).map(function (i) {
                return '<li class="insight"><span class="insight-icon">' + icon(i.icon) + '</span><span class="insight-text">' + h(i.text) + '</span></li>';
            }).join('');
            return '<section class="hero-card">' +
                '<div class="hero-top"><span class="label">' + h(t('spent')) + '</span><span class="pills">' + pills + '</span></div>' +
                '<div class="amount">' + h(F.money(data.total)) + '</div>' + meta + '</section>' +
                '<section class="card"><div class="card-head"><h2 class="card-title">' + h(t('where_it_went')) + '</h2></div>' +
                '<div class="donut"><canvas id="chart-donut" role="img" aria-label="' + h(t('chart_donut')) + '"></canvas>' +
                '<div class="donut-center"><b class="donut-value">' + h(F.compactMoney(data.total)) + '</b><span class="donut-label">' + h(t('categories_count', { n: data.byCategory.length })) + '</span></div></div>' +
                '<ul class="cat-list">' + rows + '</ul><p class="card-hint">' + h(t('ranked')) + '</p></section>' +
                (insights ? '<ul class="insights">' + insights + '</ul>' : '');
        }

        // ------------------------------------------------------------ days

        function heatCalendar(data) {
            var lead = data.firstWeekday;
            var columns = Math.ceil((lead + data.days) / 7);
            var limit = data.todayIndex === null ? data.daily.length : data.todayIndex + 1;
            var positives = data.daily.slice(0, limit).filter(function (v) { return v > 0; }).sort(function (a, b) { return a - b; });
            var rows = '';
            for (var weekday = 0; weekday < 7; weekday++) {
                var cells = '';
                for (var week = 0; week < columns; week++) {
                    var index = week * 7 + weekday - lead;
                    if (index < 0 || index >= data.days) { cells += '<span class="cell blank" aria-hidden="true"></span>'; continue; }
                    var future = data.todayIndex !== null && index > data.todayIndex;
                    var value = data.daily[index] || 0;
                    var level = future ? 0 : F.heatLevel(value, positives);
                    var key = F.keyOfMonthDay(data.start, index);
                    var label = F.formatKey(key, state.lang, { weekday: 'short', day: 'numeric', month: 'short' }) + ': ' + F.money(value);
                    cells += '<button type="button" class="cell lv' + level + (future ? ' future' : '') + (index === data.todayIndex ? ' today' : '') + '" data-action="heat-pick" data-index="' + index + '" aria-label="' + h(label) + '"' + (future ? ' disabled' : '') + '>' + (index + 1) + '</button>';
                }
                rows += '<div class="heat-row" role="row"><span class="heat-day" role="rowheader">' + h(F.weekdayShort(weekday, state.lang)) + '</span>' + cells + '</div>';
            }
            return '<div class="heat" role="table" aria-label="' + h(t('daily_spending')) + '">' + rows + '</div>';
        }

        function days() {
            var data = state.month;
            if (!data.count) return emptyMonth();
            var passed = data.todayIndex === null ? data.days : data.todayIndex + 1;
            var active = data.daily.slice(0, passed).filter(function (v) { return v > 0; }).length;
            var top = data.daily.reduce(function (best, v, i) { return v > data.daily[best] ? i : best; }, 0);
            var busiest = data.daily[top] > 0
                ? F.formatKey(F.keyOfMonthDay(data.start, top), state.lang, { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' + F.money(data.daily[top])
                : '–';
            var tile = function (ico, label, value) {
                return '<div class="insight stat"><span class="insight-icon">' + icon(ico) + '</span><span class="stat-text"><span class="insight-label">' + h(label) + '</span><b class="insight-value">' + h(value) + '</b></span></div>';
            };
            var weekend = (data.insights || []).filter(function (i) { return i.kind === 'weekend'; }).map(insightText).map(function (i) {
                return '<p class="insight-note">' + icon(i.icon) + ' ' + h(i.text) + '</p>';
            }).join('');
            return '<section class="stat-grid">' +
                tile('fa-trophy', t('busiest'), busiest) + tile('fa-calculator', t('average_day'), F.money(data.total / Math.max(1, passed))) +
                tile('fa-calendar-check', t('active_days'), active + ' / ' + passed) + tile('fa-fire', t('streak', { n: data.streak >= 2 ? data.streak : 0 }), data.streak >= 2 ? String(data.streak) : '–') + '</section>' +
                '<section class="card"><div class="card-head"><h2 class="card-title">' + h(t('daily_spending')) + '</h2></div><div class="chart-wrap"><canvas id="chart-days" role="img" aria-label="' + h(t('chart_days')) + '"></canvas></div>' + weekend + '</section>' +
                '<section class="card"><div class="card-head"><h2 class="card-title">' + h(t('daily_spending')) + '</h2></div>' + heatCalendar(data) +
                '<p class="heat-detail card-hint" id="heat-detail" aria-live="polite">' + h(t('heat_legend')) + '</p></section>';
        }

        // ------------------------------------------------------------ budgets

        function budgets() {
            var data = state.month;
            if (!data.budgets.length) {
                return '<section class="card empty"><div class="empty-icon" aria-hidden="true"><i class="fas fa-bullseye"></i></div><h2>' + h(t('no_budgets')) + '</h2><p>' + h(t('no_budgets_hint')) + '</p>' +
                    '<button type="button" class="btn btn-outline" data-action="open-website">' + h(t('open_website')) + '</button></section>';
            }
            var list = data.budgets.map(function (b) {
                var ratio = b.limit > 0 ? b.used / b.limit : 0;
                return { key: b.key, limit: b.limit, used: b.used, ratio: ratio };
            }).sort(function (a, b) { return b.ratio - a.ratio; });
            return list.map(function (b) {
                var status = b.ratio > 1 ? 'over' : b.ratio >= 0.8 ? 'watch' : 'ok';
                var info = b.key === 'all' ? { icon: 'fa-bullseye', label: t('budget_overall'), color: '#4f46e5' } : category(b.key);
                var note = b.ratio > 1 ? t('budget_over', { amount: F.money(b.used - b.limit) }) : t('budget_left', { amount: F.money(b.limit - b.used) });
                return '<article class="card budget ' + status + '">' +
                    '<div class="budget-top"><span class="cat-ico" data-color="' + h(info.color) + '">' + icon(info.icon) + '</span><b class="budget-name">' + h(info.label) + '</b><span class="pct">' + h(F.percent(b.ratio)) + '</span></div>' +
                    '<div class="track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.min(100, Math.round(b.ratio * 100)) + '"><div class="fill" data-w="' + Math.min(100, b.ratio * 100).toFixed(1) + '"></div></div>' +
                    '<div class="budget-foot card-hint"><span>' + h(F.money(b.used) + ' / ' + F.money(b.limit)) + '</span><span>' + h(note) + '</span></div></article>';
            }).join('');
        }

        // ------------------------------------------------------------ trend

        function trendView() {
            var data = state.month;
            var totals = data.monthTotals;
            if (!totals.some(function (v) { return v > 0; })) return emptyMonth();
            var best = totals.reduce(function (b, v, i) { return v > totals[b] ? i : b; }, 0);
            var average = totals.reduce(function (s, v) { return s + v; }, 0) / totals.length;
            var rows = totals.map(function (v, i) {
                var change = i > 0 ? F.trend(v, totals[i - 1]) : null;
                var chip = change && !change.flat ? '<span class="delta-chip ' + (change.up ? 'up' : 'down') + '">' + h(change.arrow + ' ' + change.text) + '</span>' : '';
                return '<li class="trend-row' + (i === totals.length - 1 ? ' current' : '') + '"><span>' + h(F.monthShort(data.monthStarts[i], state.lang)) + '</span><b>' + h(F.money(v)) + '</b>' + chip + '</li>';
            }).join('');
            return '<section class="stat-grid">' +
                '<div class="insight stat"><span class="insight-icon">' + icon('fa-chart-simple') + '</span><span class="stat-text"><span class="insight-label">' + h(t('average_month')) + '</span><b class="insight-value">' + h(F.money(average)) + '</b></span></div>' +
                '<div class="insight stat"><span class="insight-icon">' + icon('fa-arrow-trend-up') + '</span><span class="stat-text"><span class="insight-label">' + h(t('highest_month')) + '</span><b class="insight-value">' + h(F.monthShort(data.monthStarts[best], state.lang) + ' · ' + F.money(totals[best])) + '</b></span></div></section>' +
                '<section class="card"><div class="card-head"><h2 class="card-title">' + h(t('trend_title')) + '</h2></div><div class="chart-wrap"><canvas id="chart-trend" role="img" aria-label="' + h(t('chart_trend')) + '"></canvas></div>' +
                '<ul class="trend-list">' + rows + '</ul></section>';
        }

        // ------------------------------------------------------------ history

        function history() {
            var hs = state.history;
            var chips = '<button type="button" class="chip' + (!hs.category ? ' active' : '') + '" data-action="filter-category" data-key="" aria-pressed="' + !hs.category + '">' + h(t('all_categories')) + '</button>' +
                (state.categories || []).filter(function (c) { return c.active || c.key === hs.category; }).map(function (c) {
                    var on = hs.category === c.key;
                    var info = category(c.key);
                    return '<button type="button" class="chip' + (on ? ' active' : '') + '" data-color="' + h(info.color) + '" data-action="filter-category" data-key="' + h(c.key) + '" aria-pressed="' + on + '">' + icon(info.icon) + h(F.truncate(c.label, 16)) + '</button>';
                }).join('');
            var groups = [];
            hs.items.forEach(function (item) {
                var key = F.dayKey(item.created_at);
                var last = groups[groups.length - 1];
                if (last && last.key === key) last.items.push(item); else groups.push({ key: key, items: [item] });
            });
            var list = groups.map(function (g) {
                var sum = g.items.reduce(function (s, i) { return s + Math.round(F.toNumber(i.amount) * 100); }, 0) / 100;
                return '<h3 class="day-head"><span class="day-name">' + h(F.dayLabel(g.key, state.today, state.lang, { today: t('today'), yesterday: t('yesterday') })) + '</span><span class="day-total">' + h(F.money(sum)) + '</span></h3><ul class="day-group">' +
                    g.items.map(function (item) {
                        var info = category(item.category);
                        var title = item.merchant || info.label;
                        return '<li><button type="button" class="history-item" data-action="edit" data-id="' + h(item.id) + '">' +
                            '<span class="h-icon" data-color="' + h(info.color) + '" aria-hidden="true">' + icon(info.icon) + '</span>' +
                            '<span class="h-left"><b class="h-title">' + h(F.truncate(title, 40)) + '</b><small class="h-detail">' + h(info.label + ' · ' + payment(item.payment)) + '</small></span>' +
                            '<span class="h-amount">' + h(F.money(item.amount)) + '</span></button></li>';
                    }).join('') + '</ul>';
            }).join('');
            var body = hs.loading && !hs.items.length
                ? '<div class="skeleton"><div class="sk-card sk-list"></div></div>'
                : hs.items.length ? list : '<section class="card empty"><div class="empty-icon" aria-hidden="true"><i class="fas fa-seedling"></i></div><h2>' + h(t('no_data')) + '</h2></section>';
            return '<div class="history-overview"><div class="history-overview-main"><span class="history-overview-label">' + h(t('total')) + '</span><strong>' + h(F.money(hs.sum)) + '</strong><span>' + h(countText(hs.total)) + '</span></div></div>' +
                '<div class="search-wrap"><i class="fas fa-magnifying-glass" aria-hidden="true"></i><input type="search" class="search" id="search" data-action="search" placeholder="' + h(t('search')) + '" aria-label="' + h(t('search')) + '" value="' + h(hs.q) + '" maxlength="60" autocomplete="off" enterkeyhint="search"></div>' +
                '<div class="chip-scroll" role="group" aria-label="' + h(t('category')) + '">' + chips + '</div>' + body +
                (hs.items.length < hs.total ? '<button type="button" class="btn btn-outline wide" data-action="load-more"' + (hs.loading ? ' disabled' : '') + '>' + h(t('load_more')) + '</button>' : '');
        }

        // ------------------------------------------------------------ add / edit

        function sheet() {
            var s = state.sheet;
            if (!s) return '';
            var item = s.item || {};
            var editing = s.mode === 'edit';
            var today = state.today;
            var oldest = minDate(today, state.maxDaysBack || 400);
            var typed = s.values || {};
            var pick = function (name, fallback) { return typeof typed[name] === 'string' ? typed[name] : fallback; };
            var date = pick('date', editing ? F.dayKey(item.created_at) : today);
            var choices = (state.categories || []).filter(function (c) { return c.active || c.key === item.category; });
            var selectedCategory = pick('category', item.category || '');
            var selectedPayment = pick('payment', item.payment || (state.payments.filter(function (p) { return p.active; })[0] || {}).key || '');
            var payments = (state.payments || []).filter(function (p) { return p.active || p.key === item.payment; });
            var categoriesHtml = choices.map(function (c) {
                var info = category(c.key);
                return '<label class="choice" data-color="' + h(info.color) + '"><input type="radio" name="category" value="' + h(c.key) + '"' + (c.key === selectedCategory ? ' checked' : '') + '><span>' + icon(info.icon) + h(F.truncate(c.label, 14)) + '</span></label>';
            }).join('');
            var paymentsHtml = payments.map(function (p) {
                return '<label class="choice"><input type="radio" name="payment" value="' + h(p.key) + '"' + (p.key === selectedPayment ? ' checked' : '') + '><span>' + h(F.truncate(p.label, 16)) + '</span></label>';
            }).join('');
            return '<div class="sheet-backdrop" data-action="close-sheet"></div>' +
                '<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">' +
                '<div class="sheet-grabber" aria-hidden="true"></div>' +
                '<div class="sheet-head"><h2 id="sheet-title">' + h(t(editing ? 'edit_expense' : 'add_expense')) + '</h2>' +
                '<button type="button" class="icon-btn" data-action="close-sheet" aria-label="' + h(t('cancel')) + '"><i class="fas fa-xmark" aria-hidden="true"></i></button></div>' +
                '<form id="expense-form" novalidate data-id="' + h(item.id || '') + '">' +
                '<label class="amount-field"><span class="amount-prefix" aria-hidden="true">RM</span><input name="amount" inputmode="decimal" autocomplete="off" enterkeyhint="done" maxlength="10" placeholder="0.00" aria-label="' + h(t('amount')) + '" value="' + h(pick('amount', editing ? Number(item.amount).toFixed(2) : '')) + '" required></label>' +
                '<div class="input-group"><label for="f-merchant">' + h(t('merchant')) + '</label><div class="input-icon-wrap"><i class="fas fa-store" aria-hidden="true"></i><input id="f-merchant" name="merchant" maxlength="80" autocomplete="off" placeholder="' + h(t('merchant_placeholder')) + '" value="' + h(pick('merchant', item.merchant || '')) + '"></div></div>' +
                '<fieldset class="input-group"><legend class="label">' + h(t('category')) + '</legend><div class="chip-group">' + categoriesHtml + '</div></fieldset>' +
                '<fieldset class="input-group"><legend class="label">' + h(t('payment')) + '</legend><div class="chip-group">' + paymentsHtml + '</div></fieldset>' +
                '<div class="field-row"><div class="input-group"><label for="f-date">' + h(t('date')) + '</label><div class="input-icon-wrap"><i class="fas fa-calendar" aria-hidden="true"></i><input id="f-date" type="date" name="date" value="' + h(date) + '" min="' + h(oldest) + '" max="' + h(today) + '"></div></div>' +
                '<div class="input-group"><label for="f-note">' + h(t('note')) + '</label><div class="input-icon-wrap"><i class="fas fa-pen" aria-hidden="true"></i><input id="f-note" name="note" maxlength="200" autocomplete="off" value="' + h(pick('note', item.note && item.note !== 'via Telegram' && item.note !== 'via Mini App' ? item.note : '')) + '"></div></div></div>' +
                '<p class="form-error" role="alert">' + h(s.error || '') + '</p>' +
                '<div class="sheet-actions">' +
                (editing ? '<button type="button" class="btn btn-danger-soft" data-action="delete">' + h(s.confirmDelete ? t('delete_confirm') : t('delete')) + '</button>' : '') +
                '<button type="submit" class="btn btn-primary"' + (s.saving ? ' disabled' : '') + '>' + h(t('save')) + '</button></div></form></div>';
        }

        /** "YYYY-MM-DD" a number of days before today. */
        function minDate(todayKey, back) {
            var n = F.dayNumber(todayKey) - back;
            return new Date(n * F.DAY_MS).toISOString().slice(0, 10);
        }

        return {
            tabs: TABS, monthBar: monthBar, tabBar: tabBar, skeleton: skeleton, problem: problem, emptyMonth: emptyMonth,
            overview: overview, days: days, budgets: budgets, trend: trendView, history: history, sheet: sheet,
            slices: slices, minDate: minDate, insightText: insightText,
        };
    }

    return { create: create, TABS: TABS };
});
