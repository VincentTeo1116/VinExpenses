'use strict';
// Tests for the bot's building blocks: the three languages, the formatting helpers, date reading, the report
// maths and layout, and the receipt OCR helper. No database and no Telegram involved.
const test = require('node:test');
const assert = require('node:assert/strict');
const shared = (name) => import(`../supabase/functions/_shared/${name}.ts`);

// ------------------------------------------------------------------ languages
const placeholders = (text) => [...text.matchAll(/\{\{?(\w+)\}?\}/g)].map((m) => m[0]).sort();
const tags = (text) => [...text.matchAll(/<\/?(\w+)>/g)].map((m) => m[0]);

test('i18n: Malay and Chinese have every English message, with the same placeholders', async () => {
    const i18n = await shared('tg-i18n');
    const english = i18n.allKeys();
    assert.ok(english.length > 80);
    for (const lang of ['ms', 'zh']) {
        const have = new Set(i18n.keysOf(lang));
        const missing = english.filter((key) => !have.has(key));
        assert.deepEqual(missing, [], `${lang} is missing keys`);
        assert.deepEqual([...have].filter((k) => !english.includes(k)), [], `${lang} has keys English lacks`);
        for (const key of english) {
            const base = i18n.tr('en', key, {});
            assert.deepEqual(placeholders(i18n.tr(lang, key, {})), placeholders(i18n.tr('en', key, {})), `${lang}.${key}: placeholders differ`);
            assert.ok(i18n.tr(lang, key, {}).trim() !== '' && base.trim() !== '', `${lang}.${key} is empty`);
        }
    }
});

test('i18n: every message is valid Telegram HTML (balanced, only allowed tags) and fits in one message', async () => {
    const i18n = await shared('tg-i18n');
    for (const lang of i18n.LANGS) {
        for (const key of i18n.allKeys()) {
            const text = i18n.tr(lang, key, {});
            const found = tags(text);
            for (const tag of found) assert.match(tag, /^<\/?(b|i|code)>$/, `${lang}.${key}: tag ${tag}`);
            for (const name of ['b', 'i', 'code']) {
                assert.equal(found.filter((t) => t === `<${name}>`).length, found.filter((t) => t === `</${name}>`).length, `${lang}.${key}: unbalanced <${name}>`);
            }
            assert.ok(text.length < 1200, `${lang}.${key} is very long`);
            assert.ok(!/[<>]/.test(text.replace(/<\/?(b|i|code)>/g, '')), `${lang}.${key}: stray angle bracket`);
        }
        assert.ok(i18n.tr(lang, 'help', {}).length < 1500);
    }
});

test('i18n: {values} are escaped, {{values}} are not, missing values vanish, unknown keys never throw', async () => {
    const { tr, asLang } = await shared('tg-i18n');
    assert.equal(tr('en', 'removed', { amount: 'RM 5.00', what: ' · <script>' }), '↩️ Removed <b>RM 5.00</b> · &lt;script&gt;.');
    assert.match(tr('en', 'unknown_cmd', { help: '<b>H</b>' }), /<b>H<\/b>/, 'raw values are inserted as-is');
    assert.equal(tr('en', 'removed', {}), '↩️ Removed <b></b>.');
    assert.equal(tr('ms', 'no_such_key'), 'no_such_key');
    assert.equal(tr('xx', 'saved'), tr('en', 'saved'), 'a bad language code falls back to English');
    assert.equal(asLang('ms'), 'ms');
    assert.equal(asLang('zh'), 'zh');
    for (const bad of [undefined, null, 'fr', 5, {}, 'MS']) assert.equal(asLang(bad), 'en');
});

// ------------------------------------------------------------------ formatting
test('format: bars never overflow, tiny amounts stay visible, and nonsense input is safe', async () => {
    const { bar, pct, trend, truncate, emojiFor } = await shared('tg-format');
    assert.equal(bar(0), '▱▱▱▱▱▱▱▱▱▱');
    assert.equal(bar(0.5), '▰▰▰▰▰▱▱▱▱▱');
    assert.equal(bar(1), '▰▰▰▰▰▰▰▰▰▰');
    assert.equal(bar(7), '▰▰▰▰▰▰▰▰▰▰', 'over 100% still fits');
    assert.equal(bar(0.001), '▰▱▱▱▱▱▱▱▱▱', 'a tiny amount still shows one block');
    for (const bad of [NaN, -1, Infinity, undefined]) assert.equal(bar(bad).length, 10);
    assert.equal(pct(0.456), '46%');
    assert.equal(pct(-3), '0%');
    assert.deepEqual(trend(112, 100), { arrow: '▲', text: '12%', up: true });
    assert.deepEqual(trend(80, 100), { arrow: '▼', text: '20%', up: false });
    assert.equal(trend(100, 100).arrow, '＝');
    assert.equal(trend(50, 0).arrow, '', 'no comparison without a previous period');
    assert.equal(truncate('abcdef', 4), 'abc…');
    assert.equal(truncate('😀😀😀😀😀', 3), '😀😀…', 'never cuts an emoji in half');
    assert.equal(emojiFor('food'), '🍜');
    assert.equal(emojiFor('my own category'), '🏷️');
});

test('format: dates and months render in every language and always in Kuala Lumpur time', async () => {
    const { formatDay, formatMonth } = await shared('tg-format');
    const lateUtc = new Date('2026-11-05T17:00:00Z'); // already 6 Nov in Kuala Lumpur
    for (const lang of ['en', 'ms', 'zh']) {
        assert.ok(/6/.test(formatDay(lateUtc, lang)), `${lang}: ${formatDay(lateUtc, lang)}`);
        assert.ok(formatDay(lateUtc, lang, 'long').length > 5);
        assert.ok(/2026/.test(formatMonth(lateUtc, lang)));
    }
});

test('format: category rows escape names and stay on one line', async () => {
    const { categoryRow } = await shared('tg-format');
    const row = categoryRow('x', '<b>Evil & co</b> with a very very long name', 50, 100);
    assert.ok(!row.includes('<b>Evil'), row);
    assert.ok(row.includes('&lt;b&gt;'));
    assert.ok(!row.includes('\n'));
    assert.match(row, /50%/);
});

// ------------------------------------------------------------------ dates inside messages
const KL_NOW = new Date('2026-11-05T04:00:00Z'); // Thursday 5 Nov 2026, 12:00 in Kuala Lumpur
test('dates: words, slashes, ISO and month names are understood and removed from the text', async () => {
    const { extractDate } = await shared('tg-dates');
    const day = (iso) => new Date(`${iso}T12:00:00+08:00`).getTime();
    const cases = [
        ['yesterday petrol 50', '2026-11-04', 'petrol 50'],
        ['petrol 50 YESTERDAY', '2026-11-04', 'petrol 50'],
        ['kelmarin nasi 8', '2026-11-04', 'nasi 8'],
        ['semalam minyak 50', '2026-11-04', 'minyak 50'],
        ['昨天加油50', '2026-11-04', '加油50'],
        ['3/11 coffee 6', '2026-11-03', 'coffee 6'],
        ['coffee 6 3/11', '2026-11-03', 'coffee 6'],
        ['3/11/2026 coffee 6', '2026-11-03', 'coffee 6'],
        ['3/11/26 coffee 6', '2026-11-03', 'coffee 6'],
        ['28/12 gift 40', '2025-12-28', 'gift 40'],
        ['2026-10-31 rent 900', '2026-10-31', 'rent 900'],
        ['3 nov lunch 12', '2026-11-03', 'lunch 12'],
        ['lunch 12 3 November', '2026-11-03', 'lunch 12'],
        ['3nov lunch 12', '2026-11-03', 'lunch 12'],
        ['15 okt servis 80', '2026-10-15', 'servis 80'],
        ['2 mac baju 30', '2026-03-02', 'baju 30'],
        ['25 dis hadiah 20', '2025-12-25', 'hadiah 20'],
    ];
    for (const [input, iso, text] of cases) {
        const r = extractDate(input, KL_NOW);
        assert.equal(r.error, null, input);
        assert.equal(r.at?.getTime(), day(iso), `${input} -> ${r.at?.toISOString()}`);
        assert.equal(r.text, text, input);
    }
});

test('dates: today and no-date leave the time alone; look-alikes are NOT dates', async () => {
    const { extractDate } = await shared('tg-dates');
    for (const [input, text] of [['today lunch 5', 'lunch 5'], ['hari ini lunch 5', 'lunch 5'], ['今天午餐5', '午餐5'], ['lunch 5', 'lunch 5']]) {
        const r = extractDate(input, KL_NOW);
        assert.equal(r.at, null, input);
        assert.equal(r.error, null);
        assert.equal(r.text, text);
    }
    for (const input of ['7-eleven 5.50', '3 market 20', '99 speedmart 12', '31/02 odd 5', '40/13 odd 5', '5 mango 3', '12.50 grab', '1/2/3/4 x 5', '2026-13-45 y 5']) {
        const r = extractDate(input, KL_NOW);
        assert.equal(r.at, null, `${input} must not be read as a date`);
        assert.equal(r.error, null, input);
        assert.equal(r.text, input.replace(/\s+/g, ' ').trim());
    }
});

test('dates: the future and more than a year ago are refused, the boundaries are exact', async () => {
    const { extractDate } = await shared('tg-dates');
    assert.equal(extractDate('6/11 lunch 5', KL_NOW).error, 'future');
    assert.equal(extractDate('2026-11-06 lunch 5', KL_NOW).error, 'future');
    assert.equal(extractDate('1/1/2027 lunch 5', KL_NOW).error, 'future');
    assert.equal(extractDate('5/11 lunch 5', KL_NOW).error, null, 'today is fine');
    assert.equal(extractDate('2025-09-30 lunch 5', KL_NOW).error, 'old');
    assert.equal(extractDate('2025-10-01 lunch 5', KL_NOW).error, null, '400 days back is the limit');
    const lateNight = extractDate('yesterday x 5', new Date('2026-11-05T17:00:00Z')); // 6 Nov in KL
    assert.equal(lateNight.at.toISOString(), '2026-11-05T04:00:00.000Z', '"yesterday" follows the KL calendar, not UTC');
});

// ------------------------------------------------------------------ report maths and layout
const rows = (list) => list.map(([category, amount, merchant]) => ({ category, amount, merchant }));

test('reports: totals use exact cents, categories and places are ranked, the biggest expense is found', async () => {
    const { aggregate } = await shared('tg-reports');
    const agg = aggregate(rows([['food', '0.10', 'Cafe A'], ['food', '0.20', 'cafe a'], ['car', 80, 'Petronas'], ['food', '12.55', null]]));
    assert.equal(agg.total, 92.85, 'no floating-point drift (0.1 + 0.2)');
    assert.equal(agg.count, 4);
    assert.deepEqual(agg.byCategory, [['car', 80], ['food', 12.85]]);
    assert.deepEqual(agg.byMerchant.map((p) => [p.name, p.amount, p.n]), [['Petronas', 80, 1], ['Cafe A', 0.3, 2]], 'same place in different case is one place');
    assert.deepEqual(agg.biggest, { amount: 80, merchant: 'Petronas', category: 'car' });
    const empty = aggregate([]);
    assert.deepEqual([empty.total, empty.count, empty.biggest], [0, 0, null]);
    assert.equal(aggregate([{ category: 'x', amount: 'not a number' }]).total, 0, 'bad rows are ignored');
});

test('reports: budgets are measured per category and overall, worst first', async () => {
    const { aggregate, budgetUsage } = await shared('tg-reports');
    const agg = aggregate(rows([['food', 450], ['car', 50]]));
    const usage = budgetUsage([{ category: 'food', amount: 500 }, { category: 'all', amount: 1000 }, { category: 'car', amount: 40 }, { category: 'health', amount: 100 }], agg);
    assert.deepEqual(usage.map((u) => [u.key, u.used, Math.round(u.ratio * 100)]), [['car', 50, 125], ['food', 450, 90], ['all', 500, 50], ['health', 0, 0]]);
});

test('reports: every report is escaped, readable and short enough for one Telegram message', async () => {
    const r = await shared('tg-reports');
    const many = rows(Array.from({ length: 60 }, (_, i) => [`cat${i}`, 10 + i, `<i>Shop ${i}</i> & sons`]));
    const agg = r.aggregate(many);
    const labels = (key) => `<b>${key}</b> & "friends"`;
    const usage = r.budgetUsage(Array.from({ length: 20 }, (_, i) => ({ category: `cat${i}`, amount: 30 })), agg);
    const month = r.renderMonth({ lang: 'en', monthStart: new Date('2026-11-10T00:00:00Z'), agg, previous: r.aggregate(rows([['x', 100]])), income: 5000, budgets: usage, labels });
    const today = r.renderToday({ lang: 'ms', now: new Date('2026-11-05T04:00:00Z'), agg, labels });
    const top = r.renderTop({ lang: 'zh', monthStart: new Date('2026-11-10T00:00:00Z'), agg, labels });
    const digest = r.renderDigest({ lang: 'en', rangeStart: new Date('2026-11-01T16:00:00Z'), rangeEnd: new Date('2026-11-07T16:00:00Z'), agg, previous: null, budgets: usage, labels });
    for (const text of [month, today, top, digest]) {
        assert.ok(text.length < 3800, `message is ${text.length} characters`);
        assert.ok(!/<b>cat\d+<\/b>/.test(text), 'category names are escaped');
        assert.ok(!/<i>Shop/.test(text), 'place names are escaped');
        const open = (text.match(/<b>/g) || []).length;
        assert.equal(open, (text.match(/<\/b>/g) || []).length, 'balanced tags');
    }
    assert.match(month, /🗓/);
    assert.match(month, /▰/);
    assert.match(month, /🔺|🔻/, 'compared with last month');
    assert.match(top, /🥇/);
});

test('reports: empty periods say so nicely, and savings are only shown with income', async () => {
    const r = await shared('tg-reports');
    const nothing = r.aggregate([]);
    const labels = (k) => k;
    assert.match(r.renderToday({ lang: 'en', now: new Date(), agg: nothing, labels }), /No expenses yet/);
    assert.match(r.renderMonth({ lang: 'zh', monthStart: new Date(), agg: nothing, previous: null, income: 0, budgets: [], labels }), /还没有支出/);
    assert.match(r.renderTop({ lang: 'ms', monthStart: new Date(), agg: nothing, labels }), /Belum ada perbelanjaan/);
    assert.match(r.renderDigest({ lang: 'en', rangeStart: new Date(), rangeEnd: new Date(), agg: nothing, previous: null, budgets: [], labels }), /digest off/);
    const some = r.aggregate(rows([['food', 100]]));
    const noIncome = r.renderMonth({ lang: 'en', monthStart: new Date(), agg: some, previous: null, income: 0, budgets: [], labels });
    assert.ok(!/Saved|Net/.test(noIncome), 'no savings line without income');
    const withIncome = r.renderMonth({ lang: 'en', monthStart: new Date(), agg: some, previous: null, income: 1000, budgets: [], labels });
    assert.match(withIncome, /Net/);
    assert.match(withIncome, /90%/, 'savings rate = (1000 - 100) / 1000');
    const overspent = r.renderMonth({ lang: 'en', monthStart: new Date(), agg: some, previous: null, income: 50, budgets: [], labels });
    assert.match(overspent, /▱▱▱▱▱▱▱▱▱▱ <b>0%/, 'a negative savings rate shows as an empty bar, not a broken one');
});

// ------------------------------------------------------------------ OCR helper
test('ocr: the real file type decides, size is limited, and failures are classified', async () => {
    const { runOcr, mimeFromBytes, MAX_IMAGE_BYTES } = await shared('ocr');
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(40).fill(1)]);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, ...new Array(40).fill(1)]);
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 1, 1, 1, 0x57, 0x45, 0x42, 0x50, ...new Array(30).fill(1)]);
    assert.equal(mimeFromBytes(jpeg), 'image/jpeg');
    assert.equal(mimeFromBytes(png), 'image/png');
    assert.equal(mimeFromBytes(webp), 'image/webp');
    assert.equal(mimeFromBytes(new TextEncoder().encode('<html>not an image at all, sorry</html>')), null);
    assert.equal(mimeFromBytes(new Uint8Array(3)), null);

    const calls = [];
    const answer = (body, status = 200) => async (url, init) => { calls.push({ url: String(url), key: init.headers.apikey, file: init.body.get('file').type }); return new Response(JSON.stringify(body), { status }); };
    assert.deepEqual(await runOcr('KEY', jpeg, answer({ ParsedResults: [{ ParsedText: 'TOTAL 5.00' }, { ParsedText: 'page 2' }] })), { ok: true, text: 'TOTAL 5.00\npage 2' });
    assert.deepEqual(calls[0], { url: 'https://api.ocr.space/parse/image', key: 'KEY', file: 'image/jpeg' });
    assert.deepEqual(await runOcr('KEY', jpeg, answer({ IsErroredOnProcessing: true })), { ok: false, reason: 'unreadable' });
    assert.deepEqual(await runOcr('KEY', jpeg, answer({ ParsedResults: [{ ParsedText: '   ' }] })), { ok: false, reason: 'unreadable' });
    assert.deepEqual(await runOcr('KEY', jpeg, answer({}, 500)), { ok: false, reason: 'service' });
    assert.deepEqual(await runOcr('KEY', jpeg, async () => { throw new Error('network'); }), { ok: false, reason: 'service' });
    assert.deepEqual(await runOcr('KEY', new Uint8Array(MAX_IMAGE_BYTES + 1).fill(1), answer({})), { ok: false, reason: 'too_large' });
    assert.deepEqual(await runOcr('KEY', new TextEncoder().encode('GIF89a not supported at all here'), answer({})), { ok: false, reason: 'bad_type' });
});

test('receipt parser (shared copy) reads a real receipt fixture the way the app does', async () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const { loadReceiptParser } = await shared('receipt-parser-loader');
    const parser = await loadReceiptParser();
    assert.ok(parser, 'the parser loads in the edge runtime path');
    const text = fs.readFileSync(path.join(__dirname, 'fixtures/grab-food-2-truncated.txt'), 'utf8');
    const parsed = parser.parseBest([text], { now: new Date('2026-11-05T04:00:00Z') });
    assert.equal(parsed.amount, 125.4);
    assert.equal(parsed.date, '2026-08-25');
    assert.equal(parsed.hints.category, 'food');
    assert.match(parsed.merchant, /Sarawak/);
});
