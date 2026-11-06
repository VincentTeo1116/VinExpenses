'use strict';
// The Mini App's page code: formatting, translations, the Telegram bridge, the data client, the screens and the sample-data stand-in.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const F = require('../miniapp/format.js');
const I18n = require('../miniapp/i18n.js');
const Bridge = require('../miniapp/bridge.js');
const Api = require('../miniapp/api.js');
const Views = require('../miniapp/views.js');
const Demo = require('../miniapp/demo.js');

const NOW = '2026-11-06T04:00:00Z'; // 12:00 Friday 6 Nov 2026 in Kuala Lumpur

// ------------------------------------------------------------------ format
test('format: escaping, colours, money and percentages are safe and predictable', () => {
    assert.equal(F.escapeHtml(`<img src=x onerror="a('b')">\`&`), '&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&#96;&amp;');
    assert.equal(F.escapeHtml(null), '');
    assert.equal(F.safeColor('#a1B2c3', '#000'), '#a1B2c3');
    for (const bad of ['red', 'url(x)', '#12', '#12345678a', '#fff;x', 5, null, undefined]) assert.equal(F.safeColor(bad, '#000'), '#000');
    assert.equal(F.emojiFor('food'), '🍜');
    assert.equal(F.emojiFor('__proto__'), '🏷️');
    assert.equal(F.emojiFor('toString'), '🏷️');
    assert.match(F.money(1234.5), /RM\s?1,234\.50/);
    assert.match(F.money('abc'), /RM\s?0\.00/);
    assert.equal(F.compactMoney(1500), 'RM 1.5k');
    assert.equal(F.compactMoney(2000000), 'RM 2M');
    assert.equal(F.compactMoney(86), 'RM 86');
    assert.equal(F.percent(0.456), '46%');
    assert.equal(F.percent(-1), '0%');
});

test('format: trends, Kuala Lumpur dates, month labels and heat levels', () => {
    assert.equal(F.trend(10, 0), null);
    assert.deepEqual(F.trend(150, 100), { arrow: '▲', text: '50%', up: true, flat: false });
    assert.deepEqual(F.trend(50, 100), { arrow: '▼', text: '50%', up: false, flat: false });
    assert.equal(F.trend(100, 100).flat, true);
    assert.equal(F.dayKey('2026-11-05T17:00:00Z'), '2026-11-06', '01:00 the next morning in Kuala Lumpur');
    assert.equal(F.dayKey('nonsense'), '');
    assert.equal(F.dayLabel('2026-11-06', '2026-11-06', 'en', { today: 'Today', yesterday: 'Yesterday' }), 'Today');
    assert.equal(F.dayLabel('2026-11-05', '2026-11-06', 'en', { today: 'Today', yesterday: 'Yesterday' }), 'Yesterday');
    assert.match(F.dayLabel('2026-11-03', '2026-11-06', 'en', { today: 'T', yesterday: 'Y' }), /Tue/);
    assert.match(F.monthTitle('2026-10-31T16:00:00Z', 'en'), /November 2026/);
    assert.equal(F.weekdayShort(0, 'en'), 'Mon');
    assert.equal(F.keyOfMonthDay('2026-10-31T16:00:00Z', 0), '2026-11-01');
    assert.equal(F.keyOfMonthDay('2026-10-31T16:00:00Z', 29), '2026-11-30');
    assert.equal(F.heatLevel(0, [1, 2]), 0);
    assert.equal(F.heatLevel(5, [5]), 2);
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    assert.equal(F.heatLevel(10, sorted), 4, 'the busiest day is always the strongest colour');
    assert.equal(F.heatLevel(1, sorted), 1);
    assert.equal(F.truncate('abcdef', 4), 'abc…');
    assert.equal(F.truncate('😀😀😀', 3), '😀😀😀', 'whole characters, never half an emoji');
});

// ------------------------------------------------------------------ i18n
test('i18n: every language has every text, placeholders match, and a missing key never shows blank', () => {
    const english = Object.keys(I18n.DICTS.en);
    for (const lang of I18n.LANGS) {
        assert.deepEqual(Object.keys(I18n.DICTS[lang]).sort(), english.slice().sort(), `${lang} has exactly the same keys as English`);
        for (const key of english) {
            const holes = (text) => (text.match(/\{\w+\}/g) || []).sort().join();
            assert.equal(holes(I18n.DICTS[lang][key]), holes(I18n.DICTS.en[key]), `${lang}.${key} keeps its {placeholders}`);
        }
    }
    assert.equal(I18n.t('en', 'streak', { n: 4 }).includes('4'), true);
    assert.equal(I18n.t('xx', 'save'), I18n.t('en', 'save'));
    assert.equal(I18n.t('en', 'no_such_key'), 'no_such_key');
    assert.equal(I18n.asLang('ms-MY'), 'ms');
    assert.equal(I18n.asLang('zh-Hans'), 'zh');
    assert.equal(I18n.asLang('fr'), 'en');
    assert.equal(I18n.asLang(undefined), 'en');
});

test('i18n: every text the screens and the app use exists', () => {
    const keys = new Set(I18n.keys());
    const used = new Set();
    for (const file of ['views.js', 'app.js']) {
        const source = fs.readFileSync(path.join(__dirname, '..', 'miniapp', file), 'utf8');
        for (const m of source.matchAll(/\bt\(\s*'([a-z][a-z_0-9]*[a-z0-9])'/g)) used.add(m[1]);
        for (const m of source.matchAll(/'((?:err|ins|tab|v|budget|expense_count)_[a-z_0-9]+)'/g)) used.add(m[1]);
    }
    for (const field of ['amount', 'category', 'payment', 'date']) used.add(`v_${field}`);
    const missing = [...used].filter((k) => !keys.has(k));
    assert.deepEqual(missing, []);
});

// ------------------------------------------------------------------ bridge
const fakeWindow = (hash, extra = {}) => {
    const store = {};
    const win = {
        location: { hash }, self: null, top: null, parent: null,
        sessionStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
        addEventListener() {},
        ...extra,
    };
    win.self = win; win.top = win; win.parent = win;
    return { win, store };
};

test('bridge: reads launch data from the address fragment and keeps only plain colours', () => {
    const theme = JSON.stringify({ bg_color: '#112233', text_color: 'red', button_color: '#ABCDEF', link_color: 'url(javascript:1)' });
    const hash = `#tgWebAppData=${encodeURIComponent('user=%7B%22id%22%3A5%7D&hash=abc')}&tgWebAppThemeParams=${encodeURIComponent(theme)}&tgWebAppPlatform=ios&tgWebAppVersion=8.0`;
    const launch = Bridge.parseLaunch(hash);
    assert.equal(launch.initData, 'user=%7B%22id%22%3A5%7D&hash=abc');
    assert.deepEqual(launch.themeParams, { bg_color: '#112233', button_color: '#abcdef' });
    assert.equal(launch.platform, 'ios');
    assert.deepEqual(Bridge.parseLaunch('').themeParams, {});
    assert.deepEqual(Bridge.parseLaunch('#tgWebAppThemeParams=not-json').themeParams, {});
    assert.equal(Bridge.parseLaunch(`#tgWebAppData=${'x'.repeat(9000)}`).initData.length, 4096, 'capped');
    assert.equal(Bridge.schemeOf('#000000'), 'dark');
    assert.equal(Bridge.schemeOf('#ffffff'), 'light');
    assert.equal(Bridge.schemeOf('nope'), '');
});

test('bridge: not inside Telegram it has no data and does nothing harmful; inside it posts only small commands', () => {
    const { win } = fakeWindow('');
    const outside = Bridge.create(win);
    assert.equal(outside.isTelegram, false);
    assert.doesNotThrow(() => { outside.start(); outside.haptic('success'); outside.close(); outside.setColors('#112233'); });

    const sent = [];
    const { win: inApp, store } = fakeWindow(`#tgWebAppData=${encodeURIComponent('user=%7B%22id%22%3A5%2C%22language_code%22%3A%22ms%22%7D&hash=h')}`, { TelegramWebviewProxy: { postEvent: (type, data) => sent.push([type, JSON.parse(data)]) } });
    const bridge = Bridge.create(inApp);
    assert.equal(bridge.isTelegram, true);
    assert.equal(bridge.user.language_code, 'ms');
    assert.ok(store[Bridge.STORAGE_KEY], 'remembered for a reload of this tab');
    bridge.start();
    bridge.setColors('#102030');
    bridge.setColors('javascript:alert(1)');
    bridge.haptic('success');
    bridge.openLink('http://insecure.example');
    bridge.openLink('https://ok.example');
    assert.deepEqual(sent.map((s) => s[0]), ['web_app_ready', 'web_app_expand', 'web_app_setup_swipe_behavior', 'web_app_set_header_color', 'web_app_set_background_color', 'web_app_trigger_haptic_feedback', 'web_app_open_link']);
    assert.equal(sent.at(-1)[1].url, 'https://ok.example');

    // after a reload the fragment may be gone: the same tab's earlier launch is used
    const { win: reloaded } = fakeWindow('');
    reloaded.sessionStorage = inApp.sessionStorage;
    assert.equal(Bridge.create(reloaded).initData.startsWith('user='), true);
});

test('bridge: theme changes from Telegram are applied, with only valid colours', () => {
    const { win } = fakeWindow('');
    const bridge = Bridge.create(win);
    let seen = null;
    bridge.onTheme((t) => { seen = t; });
    win.Telegram.WebView.receiveEvent('theme_changed', { theme_params: { bg_color: '#000000', text_color: 'evil' } });
    assert.deepEqual(seen, { bg_color: '#000000' });
    const props = {}; const attrs = {};
    bridge.applyTheme({ style: { setProperty: (k, v) => { props[k] = v; }, removeProperty: (k) => { delete props[k]; } }, setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: (k) => { delete attrs[k]; } });
    assert.equal(props['--tg-bg'], '#000000');
    assert.equal(attrs['data-scheme'], 'dark');
});

test('bridge: a page framed by some other website is refused, Telegram web clients are allowed', () => {
    assert.equal(Bridge.frameAllowed({ self: 1, top: 1 }), true);
    const frame = (origins) => ({ self: 1, top: 2, location: { ancestorOrigins: origins } });
    assert.equal(Bridge.frameAllowed(frame(['https://evil.example'])), false);
    assert.equal(Bridge.frameAllowed(frame(['https://web.telegram.org'])), true);
});

// ------------------------------------------------------------------ api
const reply = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test('api: sends the signed launch data in a header, never a user id, and maps failures to codes', async () => {
    let seen;
    const api = Api.create({ baseUrl: 'https://abcdefghij.supabase.co/', anonKey: 'anon', getInitData: () => 'signed-data', fetchImpl: async (url, init) => { seen = { url, init }; return { ok: true, status: 200, json: async () => ({ ok: true, items: [] }) }; } });
    await api.transactions({ offset: 1, q: 'kopi' });
    assert.equal(seen.url, 'https://abcdefghij.supabase.co/functions/v1/miniapp-api');
    assert.equal(seen.init.method, 'POST');
    assert.equal(seen.init.headers['X-Telegram-Init-Data'], 'signed-data');
    assert.equal(seen.init.credentials, 'omit');
    assert.deepEqual(JSON.parse(seen.init.body), { action: 'transactions', offset: 1, q: 'kopi' });
    assert.ok(!/user_id|userId/.test(seen.init.body));

    const codeOf = async (fetchImpl) => api_with(fetchImpl).bootstrap().then(() => 'no error', (e) => e.code);
    const api_with = (fetchImpl) => Api.create({ baseUrl: 'https://x.supabase.co', getInitData: () => '', fetchImpl });
    assert.equal(await codeOf(reply(401, { ok: false, error: 'expired' })), 'expired');
    assert.equal(await codeOf(reply(401, { ok: false })), 'unauthorized');
    assert.equal(await codeOf(reply(403, { ok: false, error: 'not_linked' })), 'not_linked');
    assert.equal(await codeOf(reply(429, {})), 'limit');
    assert.equal(await codeOf(reply(500, 'not json')), 'unavailable');
    assert.equal(await codeOf(reply(400, { ok: false, error: '<script>' })), 'unavailable', 'unknown codes are never passed on');
    assert.equal(await codeOf(async () => { throw new TypeError('offline'); }), 'network');
    const invalid = await api_with(reply(400, { ok: false, error: 'invalid', field: 'amount' })).addExpense({}).catch((e) => e);
    assert.equal(invalid.code, 'invalid');
    assert.equal(invalid.field, 'amount');
});

// ------------------------------------------------------------------ views
function stateFor(overrides = {}) {
    const demo = Demo.create({ now: NOW });
    return Promise.all([demo.bootstrap(), demo.month(0), demo.transactions({ offset: 0 })]).then(([boot, month, tx]) => ({
        demo, state: Object.assign({
            lang: 'en', tab: 'overview', offset: 0, maxOffset: 60, maxDaysBack: 400, today: boot.today, month: month.data,
            categories: boot.categories, payments: boot.payments, sheet: null,
            history: { items: tx.items, total: tx.total, sum: tx.sum, category: '', q: '', loading: false },
        }, overrides),
    }));
}

test('views: every screen renders in every language without inline styles, scripts or handlers', async () => {
    for (const lang of I18n.LANGS) {
        const { state } = await stateFor({ lang });
        const views = Views.create(state);
        const screens = { bar: views.monthBar(), tabs: views.tabBar(), overview: views.overview(), days: views.days(), budgets: views.budgets(), trend: views.trend(), history: views.history(), skeleton: views.skeleton() };
        state.sheet = { mode: 'add', item: null, values: null, error: '', saving: false };
        screens.sheet = Views.create(state).sheet();
        for (const code of ['open_telegram', 'expired', 'not_linked', 'limit', 'network', 'unavailable']) screens[`problem-${code}`] = views.problem(code, { demoUrl: true });
        for (const [name, html] of Object.entries(screens)) {
            assert.ok(html.length > 20, `${lang} ${name} is not empty`);
            assert.ok(!/\sstyle\s*=/i.test(html), `${lang} ${name}: no inline style attributes`);
            assert.ok(!/<script|\son[a-z]+\s*=|javascript:/i.test(html), `${lang} ${name}: no scripts or handlers`);
        }
    }
});

test('views: text from the server or a person is escaped everywhere it appears', async () => {
    const { state } = await stateFor({ tab: 'history' });
    const evil = '<img src=x onerror=alert(1)>';
    state.categories = state.categories.concat([{ key: 'evil', label: evil, color: 'red;background:url(x)', active: true }]);
    state.payments = state.payments.concat([{ key: 'pay', label: evil, color: '#000', active: true }]);
    state.history.items = [{ id: 'ZZ"><b>', amount: 5, category: 'evil', payment: 'pay', merchant: evil, note: evil, created_at: NOW }];
    state.history.q = '"><script>';
    state.history.category = 'evil';
    const views = Views.create(state);
    state.sheet = { mode: 'edit', item: state.history.items[0], values: null, error: evil, saving: false };
    const html = Views.create(state).history() + Views.create(state).sheet();
    assert.ok(!html.includes('<img'), 'no tag survives');
    assert.ok(!html.includes('ZZ"><b>') && !html.includes('ZZ">') && !html.includes('<script'), 'the injected markup is text, not markup');
    assert.ok(!html.includes('red;background'), 'an invalid colour is replaced, never copied');
    state.month.byCategory = [['evil', 10]];
    state.month.insights = [{ kind: 'cat', key: 'evil', up: true, pct: 10 }];
    assert.ok(!views.overview().includes('<img'));
});

test('views: budgets show the right state, empty months explain themselves, the pager respects its limits', async () => {
    const { state } = await stateFor({ tab: 'budgets' });
    const views = Views.create(state);
    state.month.budgets = [{ key: 'food', limit: 100, used: 50 }, { key: 'car', limit: 100, used: 90 }, { key: 'all', limit: 100, used: 140 }];
    const html = Views.create(state).budgets();
    assert.equal((html.match(/budget over/g) || []).length, 1);
    assert.equal((html.match(/budget watch/g) || []).length, 1);
    assert.equal((html.match(/budget ok/g) || []).length, 1);
    assert.ok(html.indexOf('budget over') < html.indexOf('budget watch'), 'the most urgent first');
    assert.match(html, /data-w="100\.0"/, 'the bar never exceeds 100%');
    state.month.budgets = [];
    assert.match(Views.create(state).budgets(), /open-website/);
    state.month = Object.assign({}, state.month, { count: 0 });
    assert.match(Views.create(state).overview(), /data-action="add"/);
    assert.match(views.monthBar(), /month-next" aria-label="[^"]*" disabled/, 'no later month than this one');
    state.offset = 60;
    assert.match(Views.create(state).monthBar(), /month-prev" aria-label="[^"]*" disabled/);
});

// ------------------------------------------------------------------ demo
test('demo: the sample service behaves like the real one for add, edit, delete and filters', async () => {
    const demo = Demo.create({ now: NOW });
    const boot = await demo.bootstrap();
    assert.equal(boot.today, '2026-11-06');
    const before = (await demo.month(0)).data;
    await demo.addExpense({ amount: '12,50', category: 'food', payment: 'cash', merchant: 'Test Cafe', date: '2026-11-06' });
    const after = (await demo.month(0)).data;
    assert.equal(Math.round((after.total - before.total) * 100), 1250);
    const found = await demo.transactions({ offset: 0, q: 'test cafe' });
    assert.equal(found.total, 1);
    await demo.updateExpense(found.items[0].id, { amount: '20', category: 'food', payment: 'cash', merchant: 'Test Cafe' });
    assert.equal(Math.round(((await demo.month(0)).data.total - before.total) * 100), 2000);
    await demo.deleteExpense(found.items[0].id);
    assert.equal(Math.round(((await demo.month(0)).data.total - before.total) * 100), 0);
    await assert.rejects(demo.deleteExpense('missing'), (e) => e.code === 'not_found');
    await assert.rejects(demo.addExpense({ amount: 'abc', category: 'food', payment: 'cash' }), (e) => e.code === 'invalid' && e.field === 'amount');
    const food = await demo.transactions({ offset: 0, category: 'food' });
    assert.ok(food.items.every((i) => i.category === 'food'));
    const page = await demo.transactions({ offset: 1, limit: 5, skip: 5 });
    assert.ok(page.items.length <= 5 && page.total >= page.items.length);
    // data shape the screens rely on
    const m = (await demo.month(2)).data;
    assert.equal(m.daily.length, m.days);
    assert.equal(m.monthTotals.length, 6);
    assert.equal(m.monthStarts.length, 6);
    assert.equal(m.todayIndex, null);
});
