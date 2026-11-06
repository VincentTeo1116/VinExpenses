/* miniapp/format.js
 *
 * Small helpers shared by every screen of the Mini App: escaping, money, dates and colours.
 * No dependencies. Works in the browser (window.MiniFormat) and in Node (require), so it can be tested exactly.
 * All dates are Kuala Lumpur (UTC+8), the same calendar the bot and the reports use.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.MiniFormat = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var KL_MS = 8 * 3600000;
    var DAY_MS = 86400000;
    var LOCALES = { en: 'en-MY', ms: 'ms-MY', zh: 'zh-CN' };
    var EMOJI = { food: '🍜', beverages: '☕', travel: '✈️', entertain: '🎬', work: '💼', shopping: '🛍️', utilities: '💡', car: '🚗', health: '💊', other: '📦' };
    var PALETTE = ['#2f6fd0', '#f28c28', '#3ba55d', '#f2c230', '#8e5cc8', '#d64545', '#8b5e3c', '#5a6272'];

    /** Makes any text safe to place inside HTML (text or a quoted attribute). */
    function escapeHtml(value) {
        return String(value == null ? '' : value).replace(/[&<>"'`]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c];
        });
    }

    /** Only a plain #rgb / #rrggbb / #rrggbbaa colour is ever used (colours end up in styles). */
    function safeColor(value, fallback) {
        return typeof value === 'string' && /^#[0-9a-f]{3,8}$/i.test(value) ? value : fallback;
    }

    function emojiFor(key) {
        return Object.prototype.hasOwnProperty.call(EMOJI, key) ? EMOJI[key] : '🏷️';
    }

    function toNumber(value) {
        var n = Number(value);
        return isFinite(n) ? n : 0;
    }

    function money(value) {
        var n = toNumber(value);
        try {
            return new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR' }).format(n).replace(/ /g, ' ');
        } catch (_) {
            return 'RM ' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        }
    }

    /** "RM 1.2k" for tight places such as chart axes. */
    function compactMoney(value) {
        var n = toNumber(value);
        var abs = Math.abs(n);
        if (abs >= 1000000) return 'RM ' + (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
        if (abs >= 1000) return 'RM ' + (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
        return 'RM ' + Math.round(n);
    }

    function percent(ratio) {
        return Math.round(Math.max(0, toNumber(ratio)) * 100) + '%';
    }

    /** { arrow, text, up } comparing now with before, or null when there is nothing to compare with. */
    function trend(now, before) {
        var a = toNumber(now);
        var b = toNumber(before);
        if (!(b > 0)) return null;
        var change = (a - b) / b;
        if (Math.abs(change) < 0.005) return { arrow: '＝', text: '0%', up: false, flat: true };
        return { arrow: change > 0 ? '▲' : '▼', text: Math.round(Math.abs(change) * 100) + '%', up: change > 0, flat: false };
    }

    // ---- dates (Kuala Lumpur calendar)

    /** "YYYY-MM-DD" on the Kuala Lumpur calendar for an ISO instant. */
    function dayKey(iso) {
        var t = new Date(iso).getTime();
        if (!isFinite(t)) return '';
        return new Date(t + KL_MS).toISOString().slice(0, 10);
    }

    function dayNumber(key) {
        var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || '');
        return m ? Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY_MS) : NaN;
    }

    /** A date key rendered with Intl in the person's language. */
    function formatKey(key, lang, options) {
        var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || '');
        if (!m) return String(key || '');
        try {
            return new Intl.DateTimeFormat(LOCALES[lang] || LOCALES.en, Object.assign({ timeZone: 'UTC' }, options)).format(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12)));
        } catch (_) {
            return key;
        }
    }

    /** "Today", "Yesterday", or "Tue, 3 Nov". `words` = { today, yesterday }. */
    function dayLabel(key, todayKey, lang, words) {
        var diff = dayNumber(todayKey) - dayNumber(key);
        if (diff === 0) return words.today;
        if (diff === 1) return words.yesterday;
        return formatKey(key, lang, { weekday: 'short', day: 'numeric', month: 'short' });
    }

    /** "November 2026" for the month that starts at this ISO instant (Kuala Lumpur midnight). */
    function monthTitle(startIso, lang) {
        var key = dayKey(new Date(new Date(startIso).getTime() + 12 * 3600000).toISOString());
        return formatKey(key, lang, { month: 'long', year: 'numeric' });
    }

    function monthShort(startIso, lang) {
        var key = dayKey(new Date(new Date(startIso).getTime() + 12 * 3600000).toISOString());
        return formatKey(key, lang, { month: 'short' });
    }

    /** Weekday label for 0 = Monday ... 6 = Sunday. */
    function weekdayShort(index, lang) {
        var base = Date.UTC(2024, 0, 1, 12); // a Monday
        try {
            return new Intl.DateTimeFormat(LOCALES[lang] || LOCALES.en, { weekday: 'short', timeZone: 'UTC' }).format(new Date(base + index * DAY_MS));
        } catch (_) {
            return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][index];
        }
    }

    /** The key of the day with this 0-based index in the month that starts at `startIso`. */
    function keyOfMonthDay(startIso, index) {
        return dayKey(new Date(new Date(startIso).getTime() + index * DAY_MS + 12 * 3600000).toISOString());
    }

    /**
     * Colour step 0-4 for a day's spending, relative to this month's own days (the busiest days are always the strongest
     * step, however few days have spending). 0 = nothing spent.
     */
    function heatLevel(value, positivesSorted) {
        if (!(value > 0)) return 0;
        if (positivesSorted.length === 1) return 2;
        var last = -1;
        for (var i = 0; i < positivesSorted.length; i++) if (positivesSorted[i] === value) last = i;
        var share = last / (positivesSorted.length - 1);
        return share <= 0.25 ? 1 : share <= 0.5 ? 2 : share <= 0.8 ? 3 : 4;
    }

    function truncate(text, max) {
        var chars = Array.from(String(text == null ? '' : text));
        return chars.length <= max ? chars.join('') : chars.slice(0, max - 1).join('') + '…';
    }

    return {
        KL_MS: KL_MS, DAY_MS: DAY_MS, PALETTE: PALETTE, EMOJI: EMOJI,
        escapeHtml: escapeHtml, safeColor: safeColor, emojiFor: emojiFor, money: money, compactMoney: compactMoney,
        percent: percent, trend: trend, dayKey: dayKey, dayNumber: dayNumber, formatKey: formatKey, dayLabel: dayLabel,
        monthTitle: monthTitle, monthShort: monthShort, weekdayShort: weekdayShort, keyOfMonthDay: keyOfMonthDay,
        heatLevel: heatLevel, truncate: truncate, toNumber: toNumber,
    };
});
