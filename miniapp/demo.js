/* miniapp/demo.js
 *
 * A stand-in for the data service, with made-up sample expenses. It is used for the preview (miniapp/index.html?demo=1) so the
 * design can be seen in an ordinary browser, and in tests. It has the same methods as api.js and keeps its data in memory only:
 * nothing is read from or written to any account.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./format.js'), require('./api.js'));
    else root.MiniDemo = factory(root.MiniFormat, root.MiniApi);
})(typeof self !== 'undefined' ? self : this, function (F, Api) {
    'use strict';

    var CATEGORIES = [
        { key: 'food', label: 'Food', color: '#f28c28', active: true },
        { key: 'beverages', label: 'Beverages', color: '#8b5e3c', active: true },
        { key: 'travel', label: 'Travel', color: '#2f6fd0', active: true },
        { key: 'entertain', label: 'Entertainment', color: '#8e5cc8', active: true },
        { key: 'shopping', label: 'Shopping', color: '#d64545', active: true },
        { key: 'utilities', label: 'Utilities', color: '#f2c230', active: true },
        { key: 'car', label: 'Car', color: '#5a6272', active: true },
        { key: 'other', label: 'Other', color: '#3ba55d', active: true },
    ];
    var PAYMENTS = [
        { key: 'cash', label: 'Cash', color: '#3ba55d', active: true },
        { key: 'card', label: 'Card', color: '#2f6fd0', active: true },
        { key: 'ewallet', label: 'E-wallet', color: '#8e5cc8', active: true },
    ];
    var SHOPS = {
        food: ['Nasi Lemak Wanjo', 'Village Park', 'Kopitiam Ah Heng', 'Sushi Zanmai'], beverages: ['Starbucks', 'ZUS Coffee', 'Tealive'],
        travel: ['Grab', 'Touch n Go', 'AirAsia'], entertain: ['GSC Cinemas', 'Steam'], shopping: ['Shopee', 'Uniqlo', 'Watsons'],
        utilities: ['TNB', 'Unifi', 'Air Selangor'], car: ['Petronas', 'Shell'], other: ['Pharmacy', 'Gift'],
    };
    var CAT_WEIGHTS = ['food', 'food', 'food', 'beverages', 'beverages', 'travel', 'travel', 'entertain', 'shopping', 'utilities', 'car', 'other'];

    function seeded(seed) {
        var s = seed >>> 0;
        return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    }

    function monthStartIso(todayKey, offset) {
        var y = +todayKey.slice(0, 4);
        var m = +todayKey.slice(5, 7) - 1 - offset;
        return new Date(Date.UTC(y, m, 1) - F.KL_MS).toISOString();
    }

    function create(options) {
        options = options || {};
        var now = options.now ? new Date(options.now) : new Date();
        var todayKey = F.dayKey(now.toISOString());
        var rand = seeded(20260);
        var rows = [];
        var nextId = 1;

        function put(dayNo, category, amount, merchant) {
            var key = new Date(dayNo * F.DAY_MS).toISOString().slice(0, 10);
            rows.push({ id: 'demo-' + (nextId++), amount: amount, category: category, payment: PAYMENTS[Math.floor(rand() * 3)].key, merchant: merchant, note: '', created_at: new Date(Date.parse(key + 'T12:00:00Z') - F.KL_MS).toISOString() });
        }
        var todayNo = F.dayNumber(todayKey);
        for (var back = 0; back < 200; back++) {
            if (rand() < 0.28) continue;
            var count = 1 + Math.floor(rand() * 3);
            for (var k = 0; k < count; k++) {
                var cat = CAT_WEIGHTS[Math.floor(rand() * CAT_WEIGHTS.length)];
                var base = { food: 14, beverages: 9, travel: 22, entertain: 48, shopping: 85, utilities: 120, car: 70, other: 25 }[cat];
                var shops = SHOPS[cat];
                put(todayNo - back, cat, Math.round((base * (0.5 + rand() * 1.4)) * 100) / 100, shops[Math.floor(rand() * shops.length)]);
            }
        }
        var budgets = [{ key: 'all', limit: 2500 }, { key: 'food', limit: 600 }, { key: 'beverages', limit: 120 }, { key: 'entertain', limit: 150 }];

        function inMonth(offset) {
            var start = monthStartIso(todayKey, offset);
            var end = monthStartIso(todayKey, offset - 1);
            return rows.filter(function (r) { return r.created_at >= start && r.created_at < end; });
        }
        function sum(list) { return Math.round(list.reduce(function (s, r) { return s + r.amount; }, 0) * 100) / 100; }

        function month(offset) {
            var start = monthStartIso(todayKey, offset);
            var end = monthStartIso(todayKey, offset - 1);
            var days = Math.round((Date.parse(end) - Date.parse(start)) / F.DAY_MS);
            var list = inMonth(offset);
            var byCat = {};
            var daily = [];
            for (var i = 0; i < days; i++) daily.push(0);
            list.forEach(function (r) {
                byCat[r.category] = (byCat[r.category] || 0) + r.amount;
                var index = Math.floor((Date.parse(r.created_at) - Date.parse(start)) / F.DAY_MS);
                if (index >= 0 && index < days) daily[index] += r.amount;
            });
            var byCategory = Object.keys(byCat).map(function (k) { return [k, Math.round(byCat[k] * 100) / 100]; }).sort(function (a, b) { return b[1] - a[1]; });
            var todayIndex = offset === 0 ? Math.floor((Date.parse(todayKey + 'T12:00:00Z') - F.KL_MS - Date.parse(start)) / F.DAY_MS) : null;
            var previous = inMonth(offset + 1);
            var totals = [];
            var starts = [];
            for (var m = 5; m >= 0; m--) { totals.push(sum(inMonth(offset + m))); starts.push(monthStartIso(todayKey, offset + m)); }
            var streak = 0;
            if (todayIndex !== null) for (var d = todayIndex; d >= 0 && daily[d] > 0; d--) streak++;
            var insights = [];
            if (byCategory.length) insights.push({ kind: 'cat', key: byCategory[0][0], up: true, pct: 18 });
            insights.push({ kind: 'weekend', weekendHeavy: true, ratio: 1.4 });
            var used = budgets.map(function (b) { return { key: b.key, limit: b.limit, used: b.key === 'all' ? sum(list) : Math.round((byCat[b.key] || 0) * 100) / 100 }; });
            if (offset === 0 && todayIndex !== null) insights.push({ kind: 'pace', key: 'food', warn: used[1].used / used[1].limit / ((todayIndex + 1) / days) > 1.1, projected: used[1].used / used[1].limit / ((todayIndex + 1) / days), used: used[1].used / used[1].limit, day: todayIndex + 1 });
            return {
                offset: offset, start: start, end: end, days: days, firstWeekday: (new Date(Date.parse(start) + F.KL_MS).getUTCDay() + 6) % 7,
                total: sum(list), count: list.length, previousTotal: sum(previous), previousCount: previous.length, income: offset <= 1 ? 4200 : 0,
                byCategory: byCategory, daily: daily.map(function (v) { return Math.round(v * 100) / 100; }), todayIndex: todayIndex,
                budgets: used, monthTotals: totals, monthStarts: starts, streak: streak, insights: insights,
            };
        }

        function respond(value) { return Promise.resolve(value); }
        function fail(code, field) { return Promise.reject(new Api.ApiError(code, field)); }

        function find(id) { for (var i = 0; i < rows.length; i++) if (rows[i].id === id) return i; return -1; }
        function dateToIso(date) { return new Date(Date.parse(date + 'T12:00:00Z') - F.KL_MS).toISOString(); }

        return {
            demo: true,
            bootstrap: function () {
                return respond({ ok: true, name: 'Sample', lang: options.lang || 'en', today: todayKey, categories: CATEGORIES, payments: PAYMENTS, maxOffset: 60, maxAmount: 1000000, maxDaysBack: 400 });
            },
            month: function (offset) { return respond({ ok: true, data: month(offset) }); },
            transactions: function (params) {
                params = params || {};
                var list = inMonth(params.offset || 0);
                if (params.category) list = list.filter(function (r) { return r.category === params.category; });
                if (params.q) { var q = String(params.q).toLowerCase(); list = list.filter(function (r) { return (r.merchant || '').toLowerCase().indexOf(q) !== -1 || (r.note || '').toLowerCase().indexOf(q) !== -1; }); }
                list = list.slice().sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; });
                var skip = params.skip || 0;
                var limit = params.limit || 50;
                return respond({ ok: true, items: list.slice(skip, skip + limit), total: list.length, sum: sum(list) });
            },
            addExpense: function (v) {
                var amount = Number(String(v.amount).replace(',', '.'));
                if (!(amount > 0)) return fail('invalid', 'amount');
                rows.push({ id: 'demo-' + (nextId++), amount: amount, category: v.category, payment: v.payment, merchant: v.merchant || '', note: v.note || 'via Mini App', created_at: dateToIso(v.date || todayKey) });
                return respond({ ok: true });
            },
            updateExpense: function (id, v) {
                var i = find(id);
                if (i < 0) return fail('not_found');
                var amount = Number(String(v.amount).replace(',', '.'));
                if (!(amount > 0)) return fail('invalid', 'amount');
                var row = rows[i];
                row.amount = amount; row.category = v.category; row.payment = v.payment; row.merchant = v.merchant || ''; row.note = v.note || '';
                if (v.date && v.date !== F.dayKey(row.created_at)) row.created_at = dateToIso(v.date);
                return respond({ ok: true });
            },
            deleteExpense: function (id) {
                var i = find(id);
                if (i < 0) return fail('not_found');
                rows.splice(i, 1);
                return respond({ ok: true });
            },
        };
    }

    return { create: create, CATEGORIES: CATEGORIES, PAYMENTS: PAYMENTS };
});
