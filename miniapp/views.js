/* miniapp/views.js
 *
 * Builds the HTML of every screen from plain data. These are pure functions (data in, HTML text out), which keeps the
 * rules easy to check:
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
        { id: 'overview', icon: '🍩', key: 'tab_overview' },
        { id: 'days', icon: '📅', key: 'tab_days' },
        { id: 'budgets', icon: '🎯', key: 'tab_budgets' },
        { id: 'trend', icon: '📈', key: 'tab_trend' },
        { id: 'history', icon: '🧾', key: 'tab_history' },
    ];

    function create(state) {
        var t = function (key, vars) { return I18n.t(state.lang, key, vars); };

        function category(key) {
            var found = (state.categories || []).filter(function (c) { return c.key === key; })[0];
            return {
                key: key,
                label: found ? found.label : key,
                color: F.safeColor(found && found.color, F.PALETTE[7]),
                emoji: F.emojiFor(key),
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
            return '<header class="month-bar">' +
                '<button type="button" class="icon-btn" data-action="month-prev" aria-label="' + h(t('prev_month')) + '"' + (state.offset >= maxOffset ? ' disabled' : '') + '>‹</button>' +
                '<h1 class="month-title">' + h(title || t('loading')) + '</h1>' +
                '<button type="button" class="icon-btn" data-action="month-next" aria-label="' + h(t('next_month')) + '"' + (state.offset <= 0 ? ' disabled' : '') + '>›</button>' +
                '</header>';
        }

        function tabBar() {
            return TABS.map(function (tab) {
                var active = state.tab === tab.id;
                return '<button type="button" role="tab" class="tab' + (active ? ' active' : '') + '" data-action="tab" data-tab="' + tab.id + '" aria-selected="' + active + '"' + (active ? ' aria-current="page"' : '') + '>' +
                    '<span class="tab-icon" aria-hidden="true">' + tab.icon + '</span><span class="tab-label">' + h(t(tab.key)) + '</span></button>';
            }).join('');
        }

        function skeleton() {
            return '<div class="skeleton" aria-busy="true" aria-label="' + h(t('loading')) + '">' +
                '<div class="sk-card sk-hero"></div><div class="sk-card sk-chart"></div><div class="sk-card sk-list"></div></div>';
        }

        function emptyMonth() {
            return '<section class="card empty"><div class="empty-icon" aria-hidden="true">🌱</div><h2>' + h(t('no_data')) + '</h2><p>' + h(t('no_data_hint')) + '</p>' +
                '<button type="button" class="btn primary" data-action="add">' + h(t('add_expense')) + '</button></section>';
        }

        /** A full-screen explanation: code is an ApiError code or 'open_telegram'. */
        function problem(code, extra) {
            var map = {
                open_telegram: ['🔒', 'err_open_telegram', 'err_open_telegram_hint'],
                unauthorized: ['🔒', 'err_open_telegram', 'err_open_telegram_hint'],
                expired: ['⏳', 'err_expired', 'err_expired_hint'],
                not_linked: ['🔗', 'err_not_linked', 'err_not_linked_hint'],
                limit: ['⛔', 'err_limit', 'err_limit'],
                network: ['📡', 'err_network', 'err_generic'],
            };
            var entry = map[code] || ['😕', 'err_generic', 'err_generic'];
            var buttons = '';
            if (code === 'network' || (!map[code] && code !== 'open_telegram')) buttons += '<button type="button" class="btn primary" data-action="retry">' + h(t('retry')) + '</button>';
            if (code === 'expired' || code === 'unauthorized') buttons += '<button type="button" class="btn" data-action="close">' + h(t('close')) + '</button>';
            if (code === 'not_linked' || code === 'open_telegram') buttons += '<button type="button" class="btn primary" data-action="open-website">' + h(t('open_website')) + '</button>';
            if (code === 'open_telegram' && extra && extra.demoUrl) buttons += '<button type="button" class="btn" data-action="demo">' + h(t('try_preview')) + '</button>';
            return '<section class="card problem" role="alert"><div class="empty-icon" aria-hidden="true">' + entry[0] + '</div><h2>' + h(t(entry[1])) + '</h2>' +
                '<p>' + h(t(entry[2])) + '</p><div class="btn-row">' + buttons + '</div></section>';
        }

        // ------------------------------------------------------------ overview

        function insightText(i) {
            if (i.kind === 'cat') return { icon: category(i.key).emoji, text: t(i.up ? 'ins_cat_up' : 'ins_cat_down', { cat: category(i.key).label, pct: i.pct + '%' }) };
            if (i.kind === 'weekend') return { icon: i.weekendHeavy ? '🎉' : '💼', text: t(i.weekendHeavy ? 'ins_weekend_heavy' : 'ins_weekday_heavy', { x: i.ratio }) };
            var name = i.key === 'all' ? t('budget_overall') : category(i.key).label;
            return i.warn
                ? { icon: '⚠️', text: t('ins_pace_warn', { name: name, pct: Math.round(i.projected * 100) + '%' }) }
                : { icon: '🎯', text: t('ins_pace_ok', { name: name, used: Math.round(i.used * 100) + '%', day: i.day }) };
        }

        /** The slices of the donut and the legend rows: the top 6 categories, then everything else together. */
        function slices(data) {
            var top = data.byCategory.slice(0, 6);
            var rest = data.byCategory.slice(6);
            var list = top.map(function (entry, i) {
                var info = category(entry[0]);
                return { key: entry[0], label: info.label, emoji: info.emoji, color: info.color, amount: entry[1], fallback: F.PALETTE[i % F.PALETTE.length] };
            });
            if (rest.length) {
                list.push({ key: '', label: t('others'), emoji: '', color: F.PALETTE[7], amount: rest.reduce(function (s, e) { return s + e[1]; }, 0), count: rest.length, fallback: F.PALETTE[7] });
            }
            return list;
        }

        function overview() {
            var data = state.month;
            if (!data.count) return emptyMonth();
            var change = data.previousCount ? F.trend(data.total, data.previousTotal) : null;
            var chips = '';
            if (change) chips += '<span class="chip ' + (change.flat ? '' : change.up ? 'up' : 'down') + '">' + h(change.arrow + ' ' + change.text + ' ' + t('vs_last')) + '</span>';
            if (data.streak >= 2) chips += '<span class="chip">🔥 ' + h(t('streak', { n: data.streak })) + '</span>';
            var stats = '';
            if (data.income > 0) {
                var rate = Math.max(0, (data.income - data.total) / data.income);
                stats = '<dl class="stats">' +
                    '<div><dt>' + h(t('income')) + '</dt><dd>' + h(F.money(data.income)) + '</dd></div>' +
                    '<div><dt>' + h(t('net')) + '</dt><dd>' + h(F.money(data.income - data.total)) + '</dd></div>' +
                    '<div><dt>' + h(t('saved')) + '</dt><dd>' + h(F.percent(rate)) + '</dd></div></dl>';
            }
            var list = slices(data);
            var legend = list.map(function (s) {
                var body = '<i class="dot" data-color="' + h(s.color) + '"></i><span class="legend-name">' + h(s.emoji ? s.emoji + ' ' + s.label : s.label + (s.count ? ' (' + s.count + ')' : '')) + '</span>' +
                    '<span class="legend-amount">' + h(F.money(s.amount)) + '</span><span class="legend-share">' + h(F.percent(s.amount / data.total)) + '</span>';
                return s.key
                    ? '<li><button type="button" class="legend-row" data-action="pick-category" data-key="' + h(s.key) + '">' + body + '</button></li>'
                    : '<li><div class="legend-row static">' + body + '</div></li>';
            }).join('');
            var insights = (data.insights || []).map(insightText).slice(0, 3).map(function (i) {
                return '<li><span aria-hidden="true">' + i.icon + '</span><span>' + h(i.text) + '</span></li>';
            }).join('');
            return '<section class="card hero">' +
                '<div class="hero-label">' + h(t('spent')) + '</div>' +
                '<div class="hero-amount">' + h(F.money(data.total)) + '</div>' +
                '<div class="chips">' + chips + '</div>' + stats + '</section>' +
                '<section class="card"><h2>' + h(t('where_it_went')) + '</h2>' +
                '<div class="donut-wrap"><canvas id="chart-donut" role="img" aria-label="' + h(t('chart_donut')) + '"></canvas>' +
                '<div class="donut-center"><b>' + h(F.compactMoney(data.total)) + '</b><span>' + h(t('categories_count', { n: data.byCategory.length })) + '</span></div></div>' +
                '<ul class="legend">' + legend + '</ul><p class="hint small">' + h(t('ranked')) + '</p></section>' +
                (insights ? '<section class="card"><ul class="insights">' + insights + '</ul></section>' : '');
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
            var tile = function (label, value) { return '<div class="tile"><span class="tile-label">' + h(label) + '</span><b class="tile-value">' + h(value) + '</b></div>'; };
            var weekend = (data.insights || []).filter(function (i) { return i.kind === 'weekend'; }).map(insightText).map(function (i) {
                return '<p class="insight"><span aria-hidden="true">' + i.icon + '</span> ' + h(i.text) + '</p>';
            }).join('');
            return '<section class="tiles">' +
                tile(t('busiest'), busiest) + tile(t('average_day'), F.money(data.total / Math.max(1, passed))) +
                tile(t('active_days'), active + ' / ' + passed) + tile('🔥', data.streak >= 2 ? t('streak', { n: data.streak }) : '–') + '</section>' +
                '<section class="card"><h2>' + h(t('daily_spending')) + '</h2><div class="chart-box"><canvas id="chart-days" role="img" aria-label="' + h(t('chart_days')) + '"></canvas></div>' + weekend + '</section>' +
                '<section class="card"><h2>' + h(t('daily_spending')) + '</h2>' + heatCalendar(data) +
                '<p class="heat-detail hint" id="heat-detail" aria-live="polite">' + h(t('heat_legend')) + '</p></section>';
        }

        // ------------------------------------------------------------ budgets

        function budgets() {
            var data = state.month;
            if (!data.budgets.length) {
                return '<section class="card empty"><div class="empty-icon" aria-hidden="true">🎯</div><h2>' + h(t('no_budgets')) + '</h2><p>' + h(t('no_budgets_hint')) + '</p>' +
                    '<button type="button" class="btn" data-action="open-website">' + h(t('open_website')) + '</button></section>';
            }
            var list = data.budgets.map(function (b) {
                var ratio = b.limit > 0 ? b.used / b.limit : 0;
                return { key: b.key, limit: b.limit, used: b.used, ratio: ratio };
            }).sort(function (a, b) { return b.ratio - a.ratio; });
            return list.map(function (b) {
                var status = b.ratio > 1 ? 'over' : b.ratio >= 0.8 ? 'watch' : 'ok';
                var name = b.key === 'all' ? '🎯 ' + t('budget_overall') : category(b.key).emoji + ' ' + category(b.key).label;
                var note = b.ratio > 1 ? t('budget_over', { amount: F.money(b.used - b.limit) }) : t('budget_left', { amount: F.money(b.limit - b.used) });
                return '<article class="card budget ' + status + '">' +
                    '<div class="row"><b>' + h(name) + '</b><span class="pct">' + h(F.percent(b.ratio)) + '</span></div>' +
                    '<div class="track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.min(100, Math.round(b.ratio * 100)) + '"><div class="fill" data-w="' + Math.min(100, b.ratio * 100).toFixed(1) + '"></div></div>' +
                    '<div class="row hint small"><span>' + h(F.money(b.used) + ' / ' + F.money(b.limit)) + '</span><span>' + h(note) + '</span></div></article>';
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
                var chip = change && !change.flat ? '<span class="chip ' + (change.up ? 'up' : 'down') + '">' + h(change.arrow + ' ' + change.text) + '</span>' : '';
                return '<li class="trend-row' + (i === totals.length - 1 ? ' current' : '') + '"><span>' + h(F.monthShort(data.monthStarts[i], state.lang)) + '</span><b>' + h(F.money(v)) + '</b>' + chip + '</li>';
            }).join('');
            return '<section class="tiles two">' +
                '<div class="tile"><span class="tile-label">' + h(t('average_month')) + '</span><b class="tile-value">' + h(F.money(average)) + '</b></div>' +
                '<div class="tile"><span class="tile-label">' + h(t('highest_month')) + '</span><b class="tile-value">' + h(F.monthShort(data.monthStarts[best], state.lang) + ' · ' + F.money(totals[best])) + '</b></div></section>' +
                '<section class="card"><h2>' + h(t('trend_title')) + '</h2><div class="chart-box"><canvas id="chart-trend" role="img" aria-label="' + h(t('chart_trend')) + '"></canvas></div>' +
                '<ul class="trend-list">' + rows + '</ul></section>';
        }

        // ------------------------------------------------------------ history

        function history() {
            var hs = state.history;
            var chips = '<button type="button" class="chip-btn' + (!hs.category ? ' active' : '') + '" data-action="filter-category" data-key="" aria-pressed="' + !hs.category + '">' + h(t('all_categories')) + '</button>' +
                (state.categories || []).filter(function (c) { return c.active || c.key === hs.category; }).map(function (c) {
                    var on = hs.category === c.key;
                    return '<button type="button" class="chip-btn' + (on ? ' active' : '') + '" data-action="filter-category" data-key="' + h(c.key) + '" aria-pressed="' + on + '">' + h(F.emojiFor(c.key) + ' ' + c.label) + '</button>';
                }).join('');
            var groups = [];
            hs.items.forEach(function (item) {
                var key = F.dayKey(item.created_at);
                var last = groups[groups.length - 1];
                if (last && last.key === key) last.items.push(item); else groups.push({ key: key, items: [item] });
            });
            var list = groups.map(function (g) {
                var sum = g.items.reduce(function (s, i) { return s + Math.round(F.toNumber(i.amount) * 100); }, 0) / 100;
                return '<h3 class="day-head"><span>' + h(F.dayLabel(g.key, state.today, state.lang, { today: t('today'), yesterday: t('yesterday') })) + '</span><span>' + h(F.money(sum)) + '</span></h3><ul class="tx">' +
                    g.items.map(function (item) {
                        var info = category(item.category);
                        var title = item.merchant || info.label;
                        return '<li><button type="button" class="tx-row" data-action="edit" data-id="' + h(item.id) + '">' +
                            '<span class="tx-icon" data-color="' + h(info.color) + '" aria-hidden="true">' + h(info.emoji) + '</span>' +
                            '<span class="tx-main"><b>' + h(F.truncate(title, 40)) + '</b><small>' + h(info.label + ' · ' + payment(item.payment)) + '</small></span>' +
                            '<span class="tx-amount">' + h(F.money(item.amount)) + '</span></button></li>';
                    }).join('') + '</ul>';
            }).join('');
            var body = hs.loading && !hs.items.length
                ? '<div class="skeleton"><div class="sk-card sk-list"></div></div>'
                : hs.items.length ? list : '<section class="card empty"><div class="empty-icon" aria-hidden="true">🌱</div><h2>' + h(t('no_data')) + '</h2></section>';
            return '<div class="toolbar"><input type="search" class="search" id="search" data-action="search" placeholder="' + h(t('search')) + '" aria-label="' + h(t('search')) + '" value="' + h(hs.q) + '" maxlength="60" autocomplete="off" enterkeyhint="search"></div>' +
                '<div class="chip-scroll" role="group" aria-label="' + h(t('category')) + '">' + chips + '</div>' +
                '<p class="summary hint">' + h(countText(hs.total) + ' · ' + t('total') + ' ' + F.money(hs.sum)) + '</p>' + body +
                (hs.items.length < hs.total ? '<button type="button" class="btn wide" data-action="load-more"' + (hs.loading ? ' disabled' : '') + '>' + h(t('load_more')) + '</button>' : '');
        }

        // ------------------------------------------------------------ add / edit

        function sheet() {
            var s = state.sheet;
            if (!s) return '';
            var item = s.item || {};
            var editing = s.mode === 'edit';
            var today = state.today;
            var oldest = F.formatKey(today, 'en', {}) && minDate(today, state.maxDaysBack || 400);
            var typed = s.values || {};
            var pick = function (name, fallback) { return typeof typed[name] === 'string' ? typed[name] : fallback; };
            var date = pick('date', editing ? F.dayKey(item.created_at) : today);
            var choices = (state.categories || []).filter(function (c) { return c.active || c.key === item.category; });
            var selectedCategory = pick('category', item.category || '');
            var selectedPayment = pick('payment', item.payment || (state.payments.filter(function (p) { return p.active; })[0] || {}).key || '');
            var payments = (state.payments || []).filter(function (p) { return p.active || p.key === item.payment; });
            var categoriesHtml = choices.map(function (c) {
                return '<label class="choice"><input type="radio" name="category" value="' + h(c.key) + '"' + (c.key === selectedCategory ? ' checked' : '') + '><span>' + h(F.emojiFor(c.key) + ' ' + F.truncate(c.label, 14)) + '</span></label>';
            }).join('');
            var paymentsHtml = payments.map(function (p) {
                return '<label class="choice"><input type="radio" name="payment" value="' + h(p.key) + '"' + (p.key === selectedPayment ? ' checked' : '') + '><span>' + h(F.truncate(p.label, 16)) + '</span></label>';
            }).join('');
            return '<div class="sheet-backdrop" data-action="close-sheet"></div>' +
                '<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">' +
                '<div class="sheet-grab" aria-hidden="true"></div>' +
                '<h2 id="sheet-title">' + h(t(editing ? 'edit_expense' : 'add_expense')) + '</h2>' +
                '<form id="expense-form" novalidate data-id="' + h(item.id || '') + '">' +
                '<label class="field"><span>' + h(t('amount')) + '</span><div class="amount-box"><span aria-hidden="true">RM</span><input name="amount" inputmode="decimal" autocomplete="off" enterkeyhint="done" maxlength="10" placeholder="0.00" value="' + h(pick('amount', editing ? Number(item.amount).toFixed(2) : '')) + '" required></div></label>' +
                '<label class="field"><span>' + h(t('merchant')) + '</span><input name="merchant" maxlength="80" autocomplete="off" placeholder="' + h(t('merchant_placeholder')) + '" value="' + h(pick('merchant', item.merchant || '')) + '"></label>' +
                '<fieldset class="field"><legend>' + h(t('category')) + '</legend><div class="choices">' + categoriesHtml + '</div></fieldset>' +
                '<fieldset class="field"><legend>' + h(t('payment')) + '</legend><div class="choices">' + paymentsHtml + '</div></fieldset>' +
                '<div class="two-cols"><label class="field"><span>' + h(t('date')) + '</span><input type="date" name="date" value="' + h(date) + '" min="' + h(oldest) + '" max="' + h(today) + '"></label>' +
                '<label class="field"><span>' + h(t('note')) + '</span><input name="note" maxlength="200" autocomplete="off" value="' + h(pick('note', item.note && item.note !== 'via Telegram' && item.note !== 'via Mini App' ? item.note : '')) + '"></label></div>' +
                '<p class="form-error" role="alert">' + h(s.error || '') + '</p>' +
                '<div class="sheet-actions">' +
                (editing ? '<button type="button" class="btn danger" data-action="delete">' + h(s.confirmDelete ? t('delete_confirm') : t('delete')) + '</button>' : '') +
                '<button type="button" class="btn" data-action="close-sheet">' + h(t('cancel')) + '</button>' +
                '<button type="submit" class="btn primary"' + (s.saving ? ' disabled' : '') + '>' + h(t('save')) + '</button></div></form></div>';
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
