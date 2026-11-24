// The TypeScript ports of the receipt reader, the category suggester and the CSV reader must behave exactly like the original files
// (which the server and the older tests still use). Same inputs in, same answers out.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const legacyReceipt = require('../legacy/receipt-parser.js');
const legacyEntry = require('../legacy/smart-entry.js');
const legacyCsv = require('../legacy/csv-import.js');
const load = (rel) => import(pathToFileURL(path.join(__dirname, '..', rel)).href);

function rng(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const pick = (r, list) => list[Math.floor(r() * list.length)];
const NOW = new Date(2026, 9, 20);
const fixturesDir = path.join(__dirname, 'fixtures');
const fixtures = fs.readdirSync(fixturesDir).filter((f) => f.endsWith('.txt')).map((f) => [f, fs.readFileSync(path.join(fixturesDir, f), 'utf8')]);

const CATEGORIES = [['food', 'Food'], ['beverages', 'Beverages'], ['travel', 'Travel'], ['entertain', 'Entertain'], ['work', 'Work'], ['shopping', 'Shopping'], ['utilities', 'Utilities'], ['car', 'Car'], ['health', 'Health'], ['other', 'Other']]
    .map(([key, label]) => ({ key, label, active: true }));

test('receipts: every fixture receipt reads the same, whole and cut into pieces', async () => {
    const web = await load('src/features/receipts/receiptParser.ts');
    assert.ok(fixtures.length >= 8, 'the receipt fixtures are missing');
    const r = rng(5);
    for (const [name, text] of fixtures) {
        assert.deepEqual(web.parseReceiptText(text, { now: NOW }), legacyReceipt.parseReceiptText(text, { now: NOW }), name);
        const lines = text.split('\n');
        for (let i = 0; i < 25; i += 1) {
            // a random slice and a random reordering, so many more layouts than the fixtures themselves are compared
            const from = Math.floor(r() * lines.length);
            const slice = lines.slice(from, from + 5 + Math.floor(r() * 30)).join('\n');
            assert.deepEqual(web.parseReceiptText(slice, { now: NOW }), legacyReceipt.parseReceiptText(slice, { now: NOW }), `${name} slice ${i}`);
            const mixed = [...lines].sort(() => r() - 0.5).join('\n');
            assert.deepEqual(web.parseReceiptText(mixed, { now: NOW }), legacyReceipt.parseReceiptText(mixed, { now: NOW }), `${name} mixed ${i}`);
        }
        assert.deepEqual(web.parseBest([text, text.toUpperCase()], { now: NOW }), legacyReceipt.parseBest([text, text.toUpperCase()], { now: NOW }), `${name} best`);
    }
});

test('receipts: amounts, labels and dates on 4,000 random lines', async () => {
    const web = await load('src/features/receipts/receiptParser.ts');
    const r = rng(11);
    const words = ['TOTAL', 'Grand Total', 'Subtotal', 'SST 8%', 'Rounding', 'Discount', 'Cash', 'Change', 'Jumlah', 'Amount Due', 'Qty', 'Delivery fee', 'Nasi lemak', '总计', 'RM', 'MYR', 'USD', 'S$'];
    const numbers = ['12.50', '1,234.50', '12,50', '0.05', '7', '100', '2026.08.27', '12/10/2026', '3 Mar 2026', '2026年3月4日', '(5.00)', '-3.20', 'RM 18.90', 'RM18.9'];
    for (let i = 0; i < 4000; i += 1) {
        const line = `${pick(r, words)} ${r() > 0.5 ? ':' : ''} ${pick(r, numbers)} ${r() > 0.8 ? pick(r, words) : ''}`.trim();
        assert.deepEqual(web.findAmountsInLine(line), legacyReceipt.findAmountsInLine(line), line);
        assert.equal(web.scoreLabel(line), legacyReceipt.scoreLabel(line), line);
        assert.equal(web.parseDate([line], NOW), legacyReceipt.parseDate([line], NOW), line);
        assert.equal(web.normalizeText(line), legacyReceipt.normalizeText(line), line);
    }
});

test('receipts: PDF text pieces are put back into lines the same way', async () => {
    const web = await load('src/features/receipts/receiptParser.ts');
    const r = rng(23);
    for (let i = 0; i < 300; i += 1) {
        const items = Array.from({ length: 3 + Math.floor(r() * 25) }, () => ({
            str: pick(r, ['TOTAL', 'RM', '12.50', ' ', '', 'Nasi', 'lemak', '3', '2026-08-01', 'Sdn Bhd']),
            x: Math.floor(r() * 300), y: Math.floor(r() * 40) * 5, width: Math.floor(r() * 60), height: 6 + Math.floor(r() * 5), hasEOL: r() > 0.7,
        }));
        assert.equal(web.pdfItemsToText(items), legacyReceipt.pdfItemsToText(items));
        assert.equal(web.pdfContentOrderToText(items), legacyReceipt.pdfContentOrderToText(items));
    }
});

test('categories: every brand in every list, a named merchant on its own, and fixture receipts, suggest the same category and reason', async () => {
    const web = await load('src/features/entry/smartEntry.ts');
    assert.equal(web.KNOWN.length, legacyEntry.KNOWN.length);
    web.KNOWN.forEach((row, i) => { assert.equal(row[0], legacyEntry.KNOWN[i][0]); assert.equal(row[1], legacyEntry.KNOWN[i][1]); assert.equal(String(row[2]), String(legacyEntry.KNOWN[i][2])); });

    // pull sample names out of the regex lists themselves, so a new brand is checked without editing this test
    const names = new Set();
    for (const [, , pattern] of legacyEntry.KNOWN) {
        const inside = /\(\?:(.*)\)/.exec(pattern.source);
        if (!inside) continue;
        for (const part of inside[1].split('|')) {
            const plain = part.replace(/\\s\*/g, ' ').replace(/\\s/g, ' ').replace(/\\b/g, '').replace(/\\\./g, '.').replace(/\?|\+|\(|\)|\[|\]|\\/g, '').trim();
            if (plain.length >= 3) names.add(plain.toUpperCase());
        }
    }
    assert.ok(names.size > 600, `only ${names.size} brand names were found`);
    for (const merchant of names) {
        assert.deepEqual(web.suggestCategory({ merchant, categories: CATEGORIES }), legacyEntry.suggestCategory({ merchant, categories: CATEGORIES }), merchant);
        assert.deepEqual(web.suggestCategory({ merchant: merchant.replace(/ /g, '*'), categories: CATEGORIES }), legacyEntry.suggestCategory({ merchant: merchant.replace(/ /g, '*'), categories: CATEGORIES }), merchant);
    }
    for (const [name, text] of fixtures) {
        const parsed = legacyReceipt.parseReceiptText(text, { now: NOW });
        const input = { merchant: parsed.merchant, text, categories: CATEGORIES, hint: parsed.hints };
        assert.deepEqual(web.suggestCategory(input), legacyEntry.suggestCategory(input), name);
    }
});

test('categories: the person\'s own history, their custom category names and inactive categories behave the same', async () => {
    const web = await load('src/features/entry/smartEntry.ts');
    const r = rng(31);
    const places = ['Kopi Corner', 'Kopi Corner KL 2', '99 Speedmart 123', '99 SPEEDMART', 'Petronas Ampang', 'Shell', 'Ah Lee Stall', 'MyGym PJ'];
    const custom = [...CATEGORIES, { key: 'pets', label: 'Pet shop', active: true }, { key: 'gym', label: 'MyGym', active: true }, { key: 'old', label: 'Old thing', active: false }, { key: 'b', label: 'Hobby', active: true, is_builtin: true }];
    for (let i = 0; i < 1500; i += 1) {
        const history = Array.from({ length: Math.floor(r() * 12) }, () => ({ merchant: pick(r, places), category: pick(r, ['food', 'shopping', 'car', 'pets', 'gym', 'old']) }));
        const input = { merchant: pick(r, [...places, 'Pet shop Bangsar', 'random place', '']), text: pick(r, ['', 'service charge table 4 lunch', 'pet shop receipt']), categories: pick(r, [CATEGORIES, custom]) };
        assert.deepEqual(
            web.suggestCategory({ ...input, memory: web.buildMerchantMemory(history) }),
            legacyEntry.suggestCategory({ ...input, memory: legacyEntry.buildMerchantMemory(history) }),
            JSON.stringify({ input, history }),
        );
        assert.equal(web.normalizeMerchant(input.merchant), legacyEntry.normalizeMerchant(input.merchant));
    }
});

test('csv: amounts, dates and whole files read the same, including bank-statement layouts', async () => {
    const web = await load('src/features/csv/csv.ts');
    const r = rng(77);
    const amounts = ['12.50', 'RM 1,234.50', '(12.00)', '-12.00', '12.00 DR', '5.00 CR', '1.234,50', '12,50', '+8.00', 'abc', '', '0', 'MYR 7', '1,2,3'];
    const dates = ['2026-03-04', '04/03/2026', '4-3-26', '4 Mar 2026', '04 Mac 2026', '2026/3/4 10:00', '31/02/2026', '12 Dis 25', 'yesterday', '', '2026-13-01'];
    for (const value of amounts) assert.deepEqual(Object.is(web.parseAmount(value), NaN) ? 'nan' : web.parseAmount(value), Object.is(legacyCsv.parseAmount(value), NaN) ? 'nan' : legacyCsv.parseAmount(value), value);
    for (const value of dates) assert.equal(web.parseDate(value), legacyCsv.parseDate(value), value);

    const layouts = [
        (d, a) => `Date,Description,Amount (RM)\n${d},Shop ${a},${a}`,
        (d, a) => `Date;Details;Debit;Credit\n${d};Pay ${a};${a};`,
        (d, a) => `Transaction Date\tDescription\tDebit\tCredit\n${d}\tIn ${a}\t\t${a}`,
        (d, a) => `Date,Type,Merchant,Category,Payment,Income source,Note,Amount (RM)\n${d},expense,"Say ""hi""",Food,Card,,'=cmd,${a}`,
        (d, a) => `Tarikh,Butiran,Jumlah\n${d},Gaji,${a}`,
        (d, a) => `Date,Amount\n${d},${a}\n${d},-${a}`,
    ];
    for (let i = 0; i < 1500; i += 1) {
        const rows = Array.from({ length: 1 + Math.floor(r() * 4) }, () => pick(r, layouts)(pick(r, dates), pick(r, amounts)).split('\n'));
        const text = [rows[0][0], ...rows.map((x) => x[1]), ...(rows[0].slice(2))].join(r() > 0.5 ? '\r\n' : '\n');
        const w = web.importRecords(text);
        const l = legacyCsv.importRecords(text);
        assert.deepEqual({ records: w.records, total: w.total, tooMany: w.tooMany, skipped: w.skipped.map((s) => s.line), bad: Boolean(w.error) }, { records: l.records, total: l.total, tooMany: l.tooMany, skipped: l.skipped.map((s) => s.line), bad: Boolean(l.error) }, text);
        assert.deepEqual(web.parseCsv(text), legacyCsv.parseCsv(text));
    }
});

test('csv: writing protects formulas, and what is written reads back unchanged', async () => {
    const web = await load('src/features/csv/csv.ts');
    for (const value of ['=1+1', '+5', '-5', '@SUM(A1)', ' =x', 'plain', 'a "quoted" b', 'line\nbreak']) {
        assert.ok(!/^"[=+\-@]/.test(web.csvCell(value)), value);
    }
    const rows = [web.EXPORT_HEADER, ['2026-03-04', 'expense', '=EVIL()', 'Food', 'Card', '', 'say "hi", ok', '12.50'], ['2026-03-05', 'income', '', '', '', 'Salary', '', '3000.00']];
    const back = web.importRecords(web.toCsv(rows));
    assert.equal(back.records.length, 2);
    assert.equal(back.records[0].merchant, '=EVIL()'); // the protective apostrophe is removed again on the way in
    assert.equal(back.records[0].note, 'say "hi", ok');
    assert.equal(back.records[1].type, 'income');
    assert.equal(back.records[1].source, 'Salary');
});

test('monthly report numbers: totals, top merchants, category shares and the comparison match the original on 1,500 random months', async () => {
    const web = await load('src/features/report/insights.ts');
    const r = rng(404);
    const merchants = ['Kopi Corner', 'Kopi Corner KL 2', '99 Speedmart 12', '99 SPEEDMART', 'Petronas', 'Shell', 'Ah Lee Stall', '', null, 'MyGym PJ - Bangsar'];
    const month = () => Array.from({ length: Math.floor(r() * 25) }, () => ({
        type: r() > 0.8 ? 'income' : 'expense',
        amount: pick(r, [`${Math.floor(r() * 500)}.${String(Math.floor(r() * 100)).padStart(2, '0')}`, 12.5, '7', 0, 'x']),
        merchant: pick(r, merchants), category: pick(r, ['food', 'car', 'shopping', 'other']),
    }));
    for (let i = 0; i < 1500; i += 1) {
        const current = month();
        const before = r() > 0.2 ? month() : [];
        const a = legacyEntry.summarizeMonth(current);
        const b = web.summarizeMonth(current);
        assert.deepEqual(b, a, JSON.stringify(current));
        assert.deepEqual(web.compareMonths(b, web.summarizeMonth(before)), legacyEntry.compareMonths(a, legacyEntry.summarizeMonth(before)));
    }
});

test('mini app: the words, the formatting helpers, the Telegram launch reader and the sample data match the original', async () => {
    const legacyFormat = require('../legacy/miniapp/format.js');
    const legacyI18n = require('../legacy/miniapp/i18n.js');
    const legacyBridge = require('../legacy/miniapp/bridge.js');
    const legacyDemo = require('../legacy/miniapp/demo.js');
    const fmt = await load('src/miniapp/format.ts');
    const dict = await load('src/miniapp/dict.ts');
    const bridge = await load('src/miniapp/bridge.ts');
    const demo = await load('src/miniapp/demo.ts');

    // the three languages have the same sentences, and each one reads the same through the new lookup
    const keys = Object.keys(dict.EN);
    assert.deepEqual(keys, legacyI18n.keys());
    for (const lang of ['en', 'ms', 'zh']) {
        assert.ok(keys.every((key) => (lang === 'en' ? dict.EN : lang === 'ms' ? dict.MS : dict.ZH)[key]), `${lang} is missing a sentence`);
        for (const key of keys) assert.equal(fmt.translate(lang, key, { n: 3, amount: 'RM 5', cat: 'Food', pct: '9%', x: 2, name: 'N', used: '1%', day: 4 }), legacyI18n.t(lang, key, { n: 3, amount: 'RM 5', cat: 'Food', pct: '9%', x: 2, name: 'N', used: '1%', day: 4 }), `${lang}:${key}`);
    }
    for (const value of ['en', 'ms', 'ms-MY', 'id', 'zh-CN', 'zh', 'fr', '', null, undefined]) assert.equal(fmt.asLang(value), legacyI18n.asLang(value), String(value));

    const r = rng(2026);
    for (let i = 0; i < 400; i += 1) {
        const n = pick(r, [0, 1, 12.5, 999.99, 1234.5, 123456.789, -5, 'x', null, 1e7, 0.004]);
        assert.equal(fmt.money(n), legacyFormat.money(n), String(n));
        assert.equal(fmt.compactMoney(n), legacyFormat.compactMoney(n), String(n));
        assert.equal(fmt.percent(n), legacyFormat.percent(n), String(n));
        const m = pick(r, [0, 50, 100, 150, 1000, null]);
        assert.deepEqual(fmt.trend(n, m), legacyFormat.trend(n, m));
    }
    for (const iso of ['2026-11-24T10:00:00.000Z', '2026-11-24T17:00:00.000Z', '2026-12-31T16:30:00.000Z', 'nope']) {
        assert.equal(fmt.dayKey(iso), legacyFormat.dayKey(iso));
        if (iso === 'nope') continue; // not a date: neither version can name its month
        for (const lang of ['en', 'ms', 'zh']) { assert.equal(fmt.monthTitle(iso, lang), legacyFormat.monthTitle(iso, lang)); assert.equal(fmt.monthShort(iso, lang), legacyFormat.monthShort(iso, lang)); }
    }
    for (const lang of ['en', 'ms', 'zh']) {
        for (let w = 0; w < 7; w += 1) assert.equal(fmt.weekdayShort(w, lang), legacyFormat.weekdayShort(w, lang));
        for (const key of ['2026-11-24', '2026-11-23', '2026-11-10']) assert.equal(fmt.dayLabel(key, '2026-11-24', lang, { today: 'T', yesterday: 'Y' }), legacyFormat.dayLabel(key, '2026-11-24', lang, { today: 'T', yesterday: 'Y' }));
    }
    for (let i = 0; i < 200; i += 1) {
        const positives = Array.from({ length: 1 + Math.floor(r() * 12) }, () => Math.round(r() * 300)).filter((v) => v > 0).sort((a, b) => a - b);
        const value = pick(r, [0, ...positives]);
        assert.equal(fmt.heatLevel(value, positives), legacyFormat.heatLevel(value, positives));
        const cut = 1 + Math.floor(r() * 30);
        assert.equal(fmt.truncate('A long merchant name 🍜 with emoji', cut), legacyFormat.truncate('A long merchant name 🍜 with emoji', cut));
    }
    for (const color of ['#fff', '#4f46e5', 'red', 'url(x)', '#12345678', null]) assert.equal(fmt.safeColor(color, '#000'), legacyFormat.safeColor(color, '#000'));

    // the launch address
    const sample = `#tgWebAppData=${encodeURIComponent('user=%7B%22language_code%22%3A%22ms%22%7D&hash=ab')}&tgWebAppThemeParams=${encodeURIComponent(JSON.stringify({ bg_color: '#17212b', text_color: 'red', button_color: '#5288C1' }))}&tgWebAppPlatform=ios&tgWebAppVersion=7.2`;
    for (const hash of [sample, '', '#', '#tgWebAppData=x', '#tgWebAppThemeParams=notjson', `#tgWebAppData=${'a'.repeat(5000)}`]) {
        assert.deepEqual(bridge.parseLaunch(hash), legacyBridge.parseLaunch(hash), hash.slice(0, 40));
    }
    for (const hex of ['#000000', '#ffffff', '#17212b', '#f5f5f5', '#7f7f7f', '#808080', '#8c8c8c', '#999999', '#a6a6a6', 'red', '', undefined]) assert.equal(bridge.schemeOf(hex), legacyBridge.schemeOf(hex));
    assert.deepEqual(bridge.userOf('user=%7B%22language_code%22%3A%22ms%22%7D'), legacyBridge.userOf('user=%7B%22language_code%22%3A%22ms%22%7D'));
    assert.deepEqual(Object.keys(bridge.THEME_VARS), Object.keys(legacyBridge.THEME_VARS));

    // the sample data is the same month by month for the same day
    const now = '2026-11-24T05:00:00.000Z';
    const a = legacyDemo.create({ now });
    const b = demo.createDemo({ now: new Date(now) });
    for (const offset of [0, 1, 3, 8]) {
        assert.deepEqual((await b.month(offset)).data, (await a.month(offset)).data, `month ${offset}`);
        for (const params of [{ offset }, { offset, category: 'food' }, { offset, q: 'star' }, { offset, skip: 5, limit: 7 }]) assert.deepEqual(await b.transactions(params), await a.transactions(params), JSON.stringify(params));
    }
});
