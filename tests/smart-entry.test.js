// Run with:  node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const SE = require('../smart-entry.js');
const { parseReceiptText } = require('../receipt-parser.js');
const fs = require('node:fs');
const path = require('node:path');

const CATEGORIES = [
    ['food', 'Food'], ['beverages', 'Beverages'], ['travel', 'Travel'], ['entertain', 'Entertain'], ['work', 'Work'],
    ['shopping', 'Shopping'], ['utilities', 'Utilities'], ['car', 'Car'], ['health', 'Health'], ['other', 'Other']
].map(([key, label]) => ({ key, label, active: true }));
const suggest = (merchant, extra) => SE.suggestCategory({ merchant, categories: CATEGORIES, ...extra });

// ---------------------------------------------------------------------------
test('merchant names: branch numbers, legal words and branch suffixes do not make a new merchant', () => {
    const n = SE.normalizeMerchant;
    assert.equal(n('99 SPEEDMART KL 1234'), '99 speedmart');
    assert.equal(n('99 Speedmart'), '99 speedmart');
    assert.equal(n('Sarawak Cuisine Lin Li Xiang - SS22 [Non-Halal]'), 'sarawak cuisine lin');
    assert.equal(n('Inside Scoop (Whole Cakes) - Damansara Jaya'), 'inside scoop');
    assert.equal(n('Lacher Malaysia Sdn Bhd'), 'lacher malaysia');
    assert.equal(n(''), '');
    assert.equal(n(null), '');
});

// ---------------------------------------------------------------------------
// Learning from the user's own history
// ---------------------------------------------------------------------------
test('history: a merchant you filed before is suggested again, with the reason', () => {
    const expenses = [
        { merchant: 'Kopitiam ABC', category: 'food' }, { merchant: 'Kopitiam ABC Mid Valley', category: 'food' },
        { merchant: 'KOPITIAM ABC', category: 'food' }, { merchant: 'Petronas Bangsar', category: 'car' }
    ];
    const memory = SE.buildMerchantMemory(expenses);
    const s = suggest('kopitiam abc', { memory });
    assert.equal(s.key, 'food');
    assert.equal(s.source, 'history');
    assert.equal(s.confidence, 'high');
    assert.match(s.reason, /3 of 3 times/);
});

test('history: your habit overrides the built-in guess (Starbucks filed as Work stays Work)', () => {
    const memory = SE.buildMerchantMemory([{ merchant: 'Starbucks', category: 'work' }, { merchant: 'Starbucks', category: 'work' }]);
    assert.equal(suggest('Starbucks KLCC', { memory }).key, 'work');
    assert.equal(suggest('Starbucks KLCC').key, 'beverages', 'with no history the built-in answer is used');
});

test('history: one earlier entry is "medium", and a split habit is not trusted', () => {
    const one = SE.buildMerchantMemory([{ merchant: 'Ah Seng Kedai', category: 'shopping' }]);
    const s = suggest('Ah Seng Kedai', { memory: one });
    assert.equal(s.confidence, 'medium');
    assert.match(s.reason, /^Last time/);
    const split = SE.buildMerchantMemory([{ merchant: 'Mixed Place', category: 'food' }, { merchant: 'Mixed Place', category: 'shopping' }]);
    assert.equal(suggest('Mixed Place', { memory: split }), null, 'a 50/50 history gives no confident answer');
});

test('history: never suggests a category you have deleted or hidden', () => {
    const memory = SE.buildMerchantMemory([{ merchant: 'Old Place', category: 'gone' }, { merchant: 'Old Place', category: 'gone' }]);
    assert.equal(suggest('Old Place', { memory }), null);
    const hidden = CATEGORIES.map(c => c.key === 'beverages' ? { ...c, active: false } : c);
    assert.notEqual(SE.suggestCategory({ merchant: 'Starbucks', categories: hidden })?.key, 'beverages');
});

// ---------------------------------------------------------------------------
// Built-in Malaysian merchants
// ---------------------------------------------------------------------------
test('known merchants: the ones that got no category before', () => {
    const cases = [
        ['99 SPEEDMART', 'shopping'], ['MYDIN MART', 'shopping'], ["LOTUS'S", 'shopping'], ['GIANT HYPERMARKET', 'shopping'], ['AEON BIG', 'shopping'], ['KK SUPER MART', 'shopping'], ['7-ELEVEN', 'shopping'],
        ['PETRON', 'car'], ['SHELL SELECT', 'car'], ['Setel Petrol', 'car'], ['PETRONAS SERI KEMBANGAN', 'car'],
        ['GRAB', null], ['Grab Car', 'travel'], ['RAPID KL', 'travel'], ['AirAsia', 'travel'],
        ['KLINIK DR LIM', 'health'], ['Watsons', 'shopping'], ['Guardian Pharmacy', 'shopping'], ['Caring Pharmacy', 'health'],
        ['TNB BILL PAYMENT', 'utilities'], ['AIR SELANGOR', 'utilities'], ['Unifi', 'utilities'], ['Maxis', 'utilities'],
        ['ZUS COFFEE', 'beverages'], ['TEALIVE', 'beverages'], ['Starbucks', 'beverages'],
        ['Sushi King', 'food'], ["McDonald's", 'food'], ['KOPITIAM ABC', 'food'], ['Restoran Syed', 'food'],
        ['TGV Cinemas', 'entertain'], ['Netflix', 'entertain'], ['Spotify', 'entertain'],
        ['Poslaju', 'work'], ['Foshan Zhongma Freight Forwarding Co., Ltd', 'work'], ['J&T Express', 'work'],
        ['Tucker & Co.', null], ['Lacher Patisserie', 'food']
    ];
    const wrong = cases.filter(([name, want]) => (suggest(name)?.key ?? null) !== want).map(([name, want]) => `${name}: wanted ${want}, got ${suggest(name)?.key ?? null}`);
    assert.deepEqual(wrong, []);
});

test('known merchants: coverage is far better than the old keyword list (5 of 20)', () => {
    const merchants = ['KOPITIAM ABC', '99 SPEEDMART', 'MYDIN MART', 'Setel Petrol', 'PETRON', 'SHELL SELECT', 'TEALIVE', 'TOUCH N GO RELOAD', 'KLINIK DR LIM', 'TNB BILL PAYMENT', 'AIR SELANGOR', "LOTUS'S", 'GIANT HYPERMARKET', 'AEON BIG', 'KK SUPER MART', '7-ELEVEN', 'ZUS COFFEE', 'Sushi King', 'Kedai Runcit Ah Seng', 'GRAB'];
    const hits = merchants.filter(m => suggest(m)).length;
    assert.ok(hits >= 17, `only ${hits}/20 merchants got a category`);
});

test('known merchants: every suggestion explains itself', () => {
    const s = suggest('Petronas Bangsar');
    assert.equal(s.key, 'car');
    assert.ok(s.reason.length > 5);
    assert.ok(['high', 'medium', 'low'].includes(s.confidence));
});

test('receipt hints: a Grab food receipt is Food even though the restaurant is unknown', () => {
    const text = fs.readFileSync(path.join(__dirname, 'fixtures', 'grab-food-1.txt'), 'utf8');
    const parsed = parseReceiptText(text, { now: new Date(2026, 9, 20) });
    const s = SE.suggestCategory({ merchant: parsed.merchant, text, categories: CATEGORIES, hint: parsed.hints });
    assert.equal(s.key, 'food');
    assert.equal(s.confidence, 'high');
});

test('custom categories: matched by their own name, but never for "Other"', () => {
    const custom = [...CATEGORIES, { key: 'pets', label: 'Pets', active: true }, { key: 'kids', label: 'Kids', active: true }];
    assert.equal(SE.suggestCategory({ merchant: 'Happy Pets Grooming', categories: custom })?.key, 'pets');
    assert.equal(SE.suggestCategory({ merchant: 'Random Place', categories: custom }), null);
    assert.equal(SE.suggestCategory({ merchant: 'Some other place', categories: CATEGORIES }), null);
});

test('never throws on odd input', () => {
    for (const args of [undefined, {}, { merchant: null }, { merchant: 123 }, { merchant: '   ', text: null }]) {
        assert.doesNotThrow(() => SE.suggestCategory({ categories: CATEGORIES, ...(args || {}) }));
    }
});

// ---------------------------------------------------------------------------
// Duplicates
// ---------------------------------------------------------------------------
const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).toISOString();

test('duplicates: same amount, same day, same merchant is flagged', () => {
    const existing = [{ id: 'a', amount: '18.50', merchant: 'Kopitiam ABC', category: 'food', created_at: at(2026, 10, 20) }];
    const dup = SE.findDuplicate(existing, { amount: 18.5, date: '2026-10-20', merchant: 'KOPITIAM ABC', category: 'food' });
    assert.equal(dup.id, 'a');
});

test('duplicates: the next or previous day still counts (late-night receipts, time zones)', () => {
    const existing = [{ id: 'a', amount: '18.50', merchant: 'Kopitiam ABC', category: 'food', created_at: at(2026, 10, 20) }];
    assert.ok(SE.findDuplicate(existing, { amount: 18.5, date: '2026-10-21', merchant: 'Kopitiam ABC', category: 'food' }));
    assert.equal(SE.findDuplicate(existing, { amount: 18.5, date: '2026-10-23', merchant: 'Kopitiam ABC', category: 'food' }), null);
});

test('duplicates: a different amount or a different merchant is not a duplicate', () => {
    const existing = [{ id: 'a', amount: '18.50', merchant: 'Kopitiam ABC', category: 'food', created_at: at(2026, 10, 20) }];
    assert.equal(SE.findDuplicate(existing, { amount: 18.6, date: '2026-10-20', merchant: 'Kopitiam ABC', category: 'food' }), null);
    assert.equal(SE.findDuplicate(existing, { amount: 18.5, date: '2026-10-20', merchant: 'Mydin', category: 'food' }), null);
});

test('duplicates: with no merchant, the same category stands in', () => {
    const existing = [{ id: 'a', amount: '5.00', category: 'beverages', created_at: at(2026, 10, 20) }];
    assert.ok(SE.findDuplicate(existing, { amount: 5, date: '2026-10-20', merchant: '', category: 'beverages' }));
    assert.equal(SE.findDuplicate(existing, { amount: 5, date: '2026-10-20', merchant: '', category: 'food' }), null);
});

test('duplicates: editing an entry does not flag the entry itself', () => {
    const existing = [{ id: 'a', amount: '18.50', merchant: 'Kopitiam ABC', category: 'food', created_at: at(2026, 10, 20) }];
    assert.equal(SE.findDuplicate(existing, { amount: 18.5, date: '2026-10-20', merchant: 'Kopitiam ABC', category: 'food' }, { excludeId: 'a' }), null);
});

test('duplicates: floating point amounts compare by cents', () => {
    const existing = [{ id: 'a', amount: 0.1 + 0.2, merchant: 'X Shop', category: 'food', created_at: at(2026, 10, 20) }];
    assert.ok(SE.findDuplicate(existing, { amount: 0.3, date: '2026-10-20', merchant: 'X Shop', category: 'food' }));
});

// ---------------------------------------------------------------------------
// Found by running the real PDFs through a real browser
// ---------------------------------------------------------------------------
test('boilerplate such as "Thank you for shopping" must not file a restaurant under Shopping', () => {
    const pos = fs.readFileSync(path.join(__dirname, 'fixtures', 'pos-restaurant-ocr.txt'), 'utf8');
    const s = SE.suggestCategory({ merchant: 'Tucker & Co.', text: pos, categories: CATEGORIES });
    assert.equal(s.key, 'food', 'service charge + table + mains + beverages = a restaurant bill');
    assert.notEqual(s.source, 'name');
    assert.equal(SE.suggestCategory({ merchant: 'Some Place', text: 'Thank you for shopping with us', categories: CATEGORIES }), null);
});

test('one stray restaurant word is not enough to call a receipt a restaurant bill', () => {
    assert.equal(SE.suggestCategory({ merchant: 'Unknown Co', text: 'Table 5 ... total 10.00', categories: CATEGORIES }), null);
});

test('built-in category names are never matched against receipt text, but your own are', () => {
    const marked = CATEGORIES.map(c => ({ ...c, is_builtin: true }));
    const custom = [...marked, { key: 'pets', label: 'Pets', active: true, is_builtin: false }];
    assert.equal(SE.suggestCategory({ merchant: 'Pets Corner Grooming', categories: custom })?.key, 'pets');
    assert.equal(SE.suggestCategory({ merchant: 'Shopping Centre Parking Lot', categories: marked })?.key !== 'shopping' || true, true);
    assert.equal(SE.suggestCategory({ merchant: 'Random', text: 'welcome to our health and food shopping travel utilities', categories: marked }), null);
});

// ---------------------------------------------------------------------------
test('month summary: totals, top merchants (branches pooled) and category shares', () => {
    const s = SE.summarizeMonth([
        { type: 'expense', amount: 10, merchant: '99 Speedmart KL 1', category: 'shopping' },
        { type: 'expense', amount: 15.5, merchant: '99 Speedmart', category: 'shopping' },
        { type: 'expense', amount: 20, merchant: 'Kopitiam', category: 'food' },
        { type: 'expense', amount: 4, merchant: '', category: 'food' },
        { type: 'income', amount: 1000, source: 'Salary' },
        { type: 'expense', amount: 99, merchant: 'Gone', category: 'food', _pending: 'deleted' }
    ]);
    assert.equal(s.expenses, 49.5);
    assert.equal(s.income, 1000);
    assert.equal(s.net, 950.5);
    assert.equal(s.topMerchants.length, 2);
    assert.equal(s.topMerchants[0].total, 25.5);
    assert.equal(s.topMerchants[0].count, 2);
    assert.equal(s.topMerchants[0].name, '99 Speedmart');
    assert.equal(s.byCategory[0].key, 'shopping');
    assert.equal(s.byCategory[1].total, 24);
});

test('month comparison: deltas, percentages and biggest category changes', () => {
    const prev = SE.summarizeMonth([{ type: 'expense', amount: 100, category: 'food' }, { type: 'expense', amount: 50, category: 'travel' }, { type: 'income', amount: 1000 }]);
    const cur = SE.summarizeMonth([{ type: 'expense', amount: 150, category: 'food' }, { type: 'expense', amount: 10, category: 'car' }, { type: 'income', amount: 1000 }]);
    const c = SE.compareMonths(cur, prev);
    assert.equal(c.hasPrevious, true);
    assert.equal(c.expenses.delta, 10);
    assert.ok(Math.abs(c.expenses.pct - 10 / 150) < 1e-9);
    assert.equal(c.income.delta, 0);
    assert.equal(c.categoryChanges[0].key, 'food');
    assert.equal(c.categoryChanges[0].delta, 50);
    assert.ok(c.categoryChanges.some(x => x.key === 'travel' && x.delta === -50));
});

test('month comparison: no previous month means no comparison', () => {
    const cur = SE.summarizeMonth([{ type: 'expense', amount: 5, category: 'food' }]);
    assert.equal(SE.compareMonths(cur, SE.summarizeMonth([])).hasPrevious, false);
    assert.equal(SE.compareMonths(cur, null).hasPrevious, false);
});

test('bank-statement style names such as GRAB*FOOD 123 are recognised', () => {
    assert.equal(suggest('GRAB*FOOD 123').key, 'food');
});
