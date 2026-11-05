'use strict';
// Feature tests for the Telegram bot: backdated entries, income, budget alerts, duplicate warnings, /recent editing,
// language, the weekly summary, receipt photos - and for each of them what happens when an optional part is missing.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./helpers/tg-harness.js');
const { A, B, NOW, CHAT_A, CHAT_B, setup, message, photoMessage, callback, deliver, link, seedChoices } = H;

test.afterEach(() => { delete globalThis.Deno; });

const add = (db, table, row) => db[table].push({ id: `${table[0]}${db[table].length}-${Math.random().toString(16).slice(2, 8)}`, ...row });
const linked = async (extraEnv = {}) => {
    const ctx = setup(extraEnv);
    seedChoices(ctx.db, A);
    await link(ctx.db, ctx.tg, 'tok-a', CHAT_A);
    return ctx;
};
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(60).fill(7)]);

// ------------------------------------------------------------------ dates in messages
test('backdating: "yesterday" and "3/11" save on that day, shown on the card; the future and old dates are refused', async () => {
    const { db, tg } = await linked();
    await deliver(tg, message(CHAT_A, 'yesterday petrol 50'));
    assert.equal(db.expenses[0].created_at, '2026-11-04T04:00:00.000Z', 'noon in Kuala Lumpur, so it can not slip across a day boundary');
    assert.equal(db.expenses[0].merchant, 'petrol');
    assert.match(tg.last().html, /📅 Yesterday/);
    await deliver(tg, message(CHAT_A, '3/11 coffee 6'));
    assert.equal(db.expenses[1].created_at, '2026-11-03T04:00:00.000Z');
    await deliver(tg, message(CHAT_A, '28/12 gift 40'));
    assert.equal(db.expenses[2].created_at, '2025-12-28T04:00:00.000Z');
    const before = db.expenses.length;
    await deliver(tg, message(CHAT_A, '6/11 lunch 5'));
    assert.match(tg.last().html, /in the future/);
    await deliver(tg, message(CHAT_A, '2024-01-01 lunch 5'));
    assert.match(tg.last().html, /more than a year ago/);
    assert.equal(db.expenses.length, before);
    await deliver(tg, message(CHAT_A, 'today lunch 5'));
    const sent = db.requests.filter((r) => r.method === 'POST' && r.path.includes('/rest/v1/expenses')).at(-1);
    assert.equal(JSON.parse(sent.body).created_at, undefined, '"today" means now: the bot sends no time, the database stamps it');
});

// ------------------------------------------------------------------ income
test('income: "+3000 salary" saves income, the Undo button removes it, other users are untouched', async () => {
    const { db, tg } = await linked();
    await deliver(tg, message(CHAT_A, '+3000 salary'));
    assert.deepEqual([db.incomes[0].user_id, db.incomes[0].amount, db.incomes[0].source], [A, 3000, 'Salary']);
    assert.match(tg.last().html, /Income saved/);
    assert.match(tg.last().html, /RM\s?3,000\.00/);
    assert.equal(db.expenses.length, 0);
    const bobsId = 'bbbbbbbb-1111-4000-8000-000000000009';
    db.incomes.push({ id: bobsId, user_id: B, amount: '99', source: 'Bonus', created_at: '2026-11-01T00:00:00Z' });
    await deliver(tg, callback(CHAT_A, `i:${bobsId}`));
    assert.equal(db.incomes.length, 2, "Alice can not remove Bob's income, even knowing its id");
    await deliver(tg, callback(CHAT_A, `i:${db.incomes[0].id}`));
    assert.deepEqual(db.incomes.map((i) => i.user_id), [B]);
    assert.match(tg.lastEdit().html, /Removed/);
});

test('income: sources, dates and look-alike words behave sensibly', async () => {
    const { db, tg } = await linked();
    await deliver(tg, message(CHAT_A, '+50'));
    assert.equal(db.incomes[0].source, 'Salary', 'no word: the default source');
    await deliver(tg, message(CHAT_A, 'income 500 ang pow'));
    assert.equal(db.incomes[1].source, 'Ang pow');
    await deliver(tg, message(CHAT_A, '+100 bonus yesterday'));
    assert.equal(db.incomes[2].source, 'Bonus');
    assert.equal(db.incomes[2].created_at, '2026-11-04T04:00:00.000Z');
    await deliver(tg, message(CHAT_A, 'income tax 500'));
    assert.equal(db.incomes.length, 3, '"income tax 500" is an expense, not income');
    assert.equal(db.expenses.length, 1);
    await deliver(tg, message(CHAT_A, '+ salary'));
    assert.match(tg.last().html, /couldn't find an amount/);
});

// ------------------------------------------------------------------ budgets
test('budgets: progress bar on every expense, a heads-up when 80% is crossed, an alert at 100%, never repeated', async () => {
    const { db, tg } = await linked();
    add(db, 'budgets', { user_id: A, category: 'food', amount: '500' });
    add(db, 'budgets', { user_id: A, category: 'all', amount: '2000' });
    add(db, 'budgets', { user_id: B, category: 'food', amount: '1' });
    add(db, 'expenses', { user_id: A, amount: '350', category: 'food', payment: 'bank', merchant: 'Groceries', created_at: '2026-11-02T00:00:00Z' });
    add(db, 'expenses', { user_id: A, amount: '900', category: 'food', payment: 'bank', merchant: 'Last month', created_at: '2026-10-02T00:00:00Z' });
    await deliver(tg, message(CHAT_A, 'lunch 20'));
    assert.match(tg.last().html, /Food<\/b> ▰▰▰▰▰▰▰▱▱▱ 74%\s+\(RM\s?370\.00 of RM\s?500\.00\)/);
    assert.match(tg.last().html, /Overall<\/b> ▰▰▱▱▱▱▱▱▱▱ 19%/);
    assert.ok(!/Heads-up|Over budget/.test(tg.last().html));
    await deliver(tg, message(CHAT_A, 'dinner 40'));                       // 410 -> 82%
    assert.match(tg.last().html, /Heads-up:<\/b> 82% of your Food budget is used/);
    await deliver(tg, message(CHAT_A, 'dinner 40'));                       // 450 -> 90%: already warned
    assert.ok(!/Heads-up/.test(tg.last().html), 'no repeat of the warning');
    await deliver(tg, message(CHAT_A, 'dinner 60'));                       // 510 -> over
    assert.match(tg.last().html, /Over budget:<\/b> Food is RM\s?10\.00 above its limit/);
    await deliver(tg, message(CHAT_A, 'dinner 5'));
    assert.ok(!/Over budget/.test(tg.last().html), 'no repeat of the alert');
    assert.match(tg.last().html, /103%/);
});

test('budgets: a backdated expense is measured against ITS month, and categories without a budget show nothing', async () => {
    const { db, tg } = await linked();
    add(db, 'budgets', { user_id: A, category: 'food', amount: '100' });
    add(db, 'expenses', { user_id: A, amount: '95', category: 'food', payment: 'bank', merchant: 'Oct meal', created_at: '2026-10-10T00:00:00Z' });
    await deliver(tg, message(CHAT_A, '15 okt lunch 10'));
    assert.match(tg.last().html, /105%/);
    assert.match(tg.last().html, /Over budget/);
    await deliver(tg, message(CHAT_A, 'petronas 30'));
    assert.ok(!/budget/i.test(tg.last().html.replace(/<i>.*<\/i>/s, '')), 'car has no budget: no budget lines');
});

test('budgets: if the budgets table fails the expense is still saved, just without the budget lines', async () => {
    const { db, tg } = await linked();
    add(db, 'budgets', { user_id: A, category: 'food', amount: '100' });
    db.failures.add('budgets');
    await deliver(tg, message(CHAT_A, 'lunch 20'));
    assert.equal(db.expenses.length, 1);
    assert.match(tg.last().html, /Saved/);
    assert.ok(!/▰/.test(tg.last().html));
});

// ------------------------------------------------------------------ duplicates
test('duplicates: the same amount and place on the same day is flagged but still saved; different ones are not flagged', async () => {
    const { db, tg } = await linked();
    await deliver(tg, message(CHAT_A, 'grab 8.90'));
    assert.ok(!/duplicate/.test(tg.last().html));
    await deliver(tg, message(CHAT_A, 'grab 8.90'));
    assert.match(tg.last().html, /Possible duplicate:<\/b> you already logged RM\s?8\.90 at grab/);
    assert.equal(db.expenses.length, 2, 'warned, not blocked: two real trips are possible');
    await deliver(tg, message(CHAT_A, 'grab 9.90'));
    assert.ok(!/duplicate/.test(tg.last().html));
    await deliver(tg, message(CHAT_A, 'kfc 8.90'));
    assert.ok(!/duplicate/.test(tg.last().html));
    await deliver(tg, message(CHAT_A, 'yesterday grab 8.90'));
    assert.ok(!/duplicate/.test(tg.last().html), 'another day is not a duplicate');
});

test('duplicates: another person\'s identical expense is never mentioned, and a failing lookup is silent', async () => {
    const { db, tg, hooks } = await linked();
    add(db, 'expenses', { user_id: B, amount: '8.9', category: 'travel', payment: 'bank', merchant: 'grab', created_at: '2026-11-05T01:00:00Z' });
    await deliver(tg, message(CHAT_A, 'grab 8.90'));
    assert.ok(!/duplicate/.test(tg.last().html));
    hooks.breakWhen.push((method, url) => method === 'GET' && url.pathname.endsWith('/expenses') && url.searchParams.has('id'));
    await deliver(tg, message(CHAT_A, 'grab 8.90'));
    assert.match(tg.last().html, /Saved/);
    assert.ok(!/duplicate/.test(tg.last().html));
});

// ------------------------------------------------------------------ /recent and editing
test('recent: list, open one, change its amount, back, and delete with a confirmation', async () => {
    const { db, tg } = await linked();
    await deliver(tg, message(CHAT_A, 'lunch 12.50'));
    await deliver(tg, message(CHAT_A, 'kopi 4'));
    await deliver(tg, message(CHAT_A, '/recent'));
    const list = tg.last();
    assert.match(list.html, /Recent expenses/);
    assert.equal(list.buttons.length, 2);
    const id = db.expenses[0].id;
    await deliver(tg, callback(CHAT_A, `v:${id}`));
    assert.match(tg.lastEdit().html, /RM\s?12\.50/);
    assert.deepEqual(tg.lastEdit().buttons.flat().map((b) => b.text), ['✏️ Amount', '🏷 Category', '🗑 Delete', '⬅️ Back']);
    await deliver(tg, callback(CHAT_A, `a:${id}`));
    assert.match(tg.lastEdit().html, /Send the new amount/);
    await deliver(tg, message(CHAT_A, 'abc'));
    assert.match(tg.last().html, /doesn't look like an amount/);
    assert.equal(db.expenses[0].amount, 12.5, 'unchanged while the amount is invalid');
    await deliver(tg, message(CHAT_A, 'rm25'));
    assert.equal(db.expenses[0].amount, 25);
    assert.match(tg.last().html, /Amount updated/);
    assert.equal(db.telegram_pending.length, 0, 'the question is closed');
    await deliver(tg, message(CHAT_A, '30'));
    assert.equal(db.expenses.length, 3, 'a bare number with nothing pending is a (nameless) new expense, not an edit');
    await deliver(tg, callback(CHAT_A, 'b:0'));
    assert.match(tg.lastEdit().html, /Recent expenses/);
    await deliver(tg, callback(CHAT_A, `d:${id}`));
    assert.match(tg.lastEdit().html, /Delete <b>RM\s?25\.00/);
    assert.equal(db.expenses.length, 3, 'asking is not deleting');
    await deliver(tg, callback(CHAT_A, `u:${id}`));
    assert.equal(db.expenses.length, 2);
});

test('recent: typing a whole new expense, or /cancel, ends the "send the new amount" question', async () => {
    const { db, tg } = await linked();
    await deliver(tg, message(CHAT_A, 'lunch 12.50'));
    const id = db.expenses[0].id;
    await deliver(tg, callback(CHAT_A, `a:${id}`));
    await deliver(tg, message(CHAT_A, 'kopi 4'));
    assert.equal(db.expenses.length, 2);
    assert.equal(db.expenses[0].amount, 12.5, 'the old expense was NOT overwritten');
    assert.equal(db.telegram_pending.length, 0);
    await deliver(tg, callback(CHAT_A, `a:${id}`));
    await deliver(tg, message(CHAT_A, '/cancel'));
    assert.match(tg.last().html, /Cancelled/);
    await deliver(tg, message(CHAT_A, '99'));
    assert.equal(db.expenses[0].amount, 12.5);
    await deliver(tg, callback(CHAT_A, `a:${id}`));
    await deliver(tg, message(CHAT_A, '/today'));
    assert.equal(db.telegram_pending.length, 0, 'any other command also closes the question');
});

test('recent: an expired question is not answered by a later number, and nobody can edit someone else\'s expense', async () => {
    const { db, tg } = await linked();
    await link(db, tg, 'tok-b', CHAT_B);
    await deliver(tg, message(CHAT_B, 'bob lunch 99'));
    const bobs = db.expenses[0].id;
    await deliver(tg, callback(CHAT_A, `a:${bobs}`));
    assert.match(tg.lastEdit().html, /no longer exists/);
    assert.equal(db.telegram_pending.filter((p) => p.chat_id === CHAT_A).length, 0);
    await deliver(tg, message(CHAT_A, 'lunch 5'));
    const mine = db.expenses.at(-1).id;
    await deliver(tg, callback(CHAT_A, `a:${mine}`));
    db.telegram_pending[0].expires_at = new Date(Date.now() - 1000).toISOString();
    await deliver(tg, message(CHAT_A, '77'));
    assert.equal(db.expenses.find((e) => e.id === mine).amount, 5, 'the expired question did not capture the number');
    assert.equal(db.expenses.find((e) => e.id === bobs).amount, 99);
});

test('recent: with nothing recorded it says so; with the pending table broken ordinary entry still works', async () => {
    const { db, tg } = await linked();
    await deliver(tg, message(CHAT_A, '/recent'));
    assert.match(tg.last().html, /Nothing recorded yet/);
    db.failures.add('telegram_pending');
    await deliver(tg, message(CHAT_A, 'lunch 5'));
    assert.equal(db.expenses.length, 1);
    assert.match(tg.last().html, /Saved/);
});

// ------------------------------------------------------------------ reports
test('/month shows income, spending, savings, last-month trend, categories and budgets; /top ranks places', async () => {
    const { db, tg } = await linked();
    const addX = (amount, at, category = 'food', merchant = 'Cafe') => add(db, 'expenses', { user_id: A, amount: String(amount), category, payment: 'bank', merchant, created_at: at });
    addX(200, '2026-11-02T00:00:00Z', 'food', 'Cafe');
    addX(100, '2026-11-03T00:00:00Z', 'food', 'cafe');
    addX(50, '2026-11-04T00:00:00Z', 'shopping', 'Mall');
    addX(175, '2026-10-10T00:00:00Z');
    add(db, 'incomes', { user_id: A, amount: '3000', source: 'Salary', created_at: '2026-11-01T00:00:00Z' });
    add(db, 'budgets', { user_id: A, category: 'food', amount: '400' });
    await deliver(tg, message(CHAT_A, '/month'));
    const month = tg.last().html;
    assert.match(month, /🗓 <b>November 2026<\/b>/);
    assert.match(month, /Spent\s+<b>RM\s?350\.00<\/b>\s+🔺 100% <i>vs last month/);
    assert.match(month, /Net\s+<b>RM\s?2,650\.00/);
    assert.match(month, /Saved\s+▰▰▰▰▰▰▰▰▰▱ <b>88%/);
    assert.match(month, /🍜 Food\s+▰▰▰▰▰▰▰▰▰▱ 86%/);
    assert.match(month, /🟢 🍜 Food\s+▰▰▰▰▰▰▰▰▱▱ <b>75%/);
    await deliver(tg, message(CHAT_A, '/top'));
    const top = tg.last().html;
    assert.match(top, /🥇 🍜 Food/);
    assert.match(top, /🥇 Cafe\s+<b>RM\s?300\.00<\/b>\s+<i>×2<\/i>/, 'the same place in different letter case counts once');
    assert.match(top, /🥈 Mall/);
});

// ------------------------------------------------------------------ language
test('language: /language offers three choices, the choice is remembered, and replies switch language', async () => {
    const { db, tg } = await linked();
    await deliver(tg, message(CHAT_A, '/language'));
    assert.deepEqual(tg.last().buttons[0].map((b) => b.callback_data), ['l:en', 'l:ms', 'l:zh']);
    await deliver(tg, callback(CHAT_A, 'l:ms'));
    assert.equal(db.telegram_links[0].lang, 'ms');
    assert.match(tg.lastEdit().html, /Bahasa Melayu/);
    await deliver(tg, message(CHAT_A, 'makan tengah hari 12.50'));
    assert.match(tg.last().html, /Disimpan/);
    assert.deepEqual(tg.last().buttons.at(-1).map((b) => b.text), ["➕ Lagi", "↩️ Buat asal", "✏️ Ubah"]);
    await deliver(tg, message(CHAT_A, '/today'));
    assert.match(tg.last().html, /Hari ini/);
    await deliver(tg, callback(CHAT_A, 'l:zh'));
    await deliver(tg, message(CHAT_A, '午餐12.5'));
    assert.match(tg.last().html, /已保存/);
    assert.equal(db.expenses.at(-1).amount, 12.5, 'Chinese text without spaces still gives the amount');
    await deliver(tg, message(CHAT_A, '/month'));
    assert.match(tg.last().html, /支出/);
    await deliver(tg, callback(CHAT_A, 'l:fr'));
    assert.equal(db.telegram_links[0].lang, 'zh', 'an unknown language code is ignored');
});

test('language: the first greeting and the first link follow the person\'s Telegram language', async () => {
    const { db, tg } = setup();
    await deliver(tg, message(CHAT_A, '/start', { from: { language_code: 'ms' } }));
    assert.match(tg.last().html, /Hai!/);
    await deliver(tg, message(CHAT_A, 'lunch 5', { from: { language_code: 'zh-hans' } }));
    assert.match(tg.last().html, /尚未连接/);
    seedChoices(db, A);
    await link(db, tg, 'tok-a', CHAT_A, { language_code: 'zh-hans' });
    assert.match(tg.last().html, /连接成功/);
    assert.equal(db.telegram_links[0].lang, 'zh');
});

test('language: if the database has no language column yet, everything still works in English', async () => {
    const ctx = setup();
    seedChoices(ctx.db, A);
    ctx.hooks.breakWhen.push((method, url) => url.pathname.endsWith('/telegram_links') && url.searchParams.get('select') === 'lang,digest_on');
    ctx.hooks.breakWhen.push((method, url, init) => (method === 'POST' || method === 'PATCH') && url.pathname.endsWith('/telegram_links') && String(init.body).includes('"lang"'));
    await link(ctx.db, ctx.tg, 'tok-a', CHAT_A, { language_code: 'ms' });
    assert.equal(ctx.db.telegram_links.length, 1, 'linking retried without the new column');
    await deliver(ctx.tg, message(CHAT_A, 'lunch 12.50'));
    assert.match(ctx.tg.last().html, /Saved/);
    await deliver(ctx.tg, message(CHAT_A, '/language'));
    await deliver(ctx.tg, callback(CHAT_A, 'l:zh'));
    assert.match(ctx.tg.lastEdit().html, /isn't available yet/);
});

// ------------------------------------------------------------------ weekly summary switch
test('/digest: shows the state, switches on and off, and explains if the database is not updated', async () => {
    const { db, tg, hooks } = await linked();
    await deliver(tg, message(CHAT_A, '/digest'));
    assert.match(tg.last().html, /off/);
    await deliver(tg, message(CHAT_A, '/digest on'));
    assert.equal(db.telegram_links[0].digest_on, true);
    assert.match(tg.last().html, /Weekly summary is on/);
    await deliver(tg, message(CHAT_A, '/digest'));
    assert.match(tg.last().html, /<b>on<\/b>/);
    await deliver(tg, message(CHAT_A, '/digest OFF'));
    assert.equal(db.telegram_links[0].digest_on, false);
    await deliver(tg, message(CHAT_A, '/digest maybe'));
    assert.match(tg.last().html, /off/);
    hooks.breakWhen.push((method, url, init) => method === 'PATCH' && String(init.body).includes('digest_on'));
    await deliver(tg, message(CHAT_A, '/digest on'));
    assert.match(tg.last().html, /isn't available yet/);
});

// ------------------------------------------------------------------ receipts
const RECEIPT = fs.readFileSync(path.join(__dirname, 'fixtures/grab-food-2-truncated.txt'), 'utf8');
const ocrReturns = (hooks, body, status = 200) => { hooks.ocr = async () => new Response(JSON.stringify(body), { status }); };

test('receipt: a photo is read, shown for confirmation, and saved only after Save', async () => {
    const { db, tg, hooks } = await linked({ OCR_SPACE_API_KEY: 'ocr-key' });
    ocrReturns(hooks, { ParsedResults: [{ ParsedText: RECEIPT }] });
    tg.file = { bytes: JPEG };
    await deliver(tg, photoMessage(CHAT_A));
    assert.match(tg.lastSent().html, /Reading your receipt/);
    const card = tg.last();
    assert.equal(tg.lastEdit().messageId, tg.lastSent().id, 'ONE live message: "Reading…" itself turns into the card');
    assert.equal(tg.sent.length > 0 && tg.sent.filter((m) => /Receipt found/.test(m.html)).length, 0, 'no second message for the result');
    assert.match(card.html, /Receipt found/);
    assert.match(card.html, /<b>RM\s?125\.40<\/b> · Food/);
    assert.match(card.html, /Sarawak/);
    assert.match(card.html, /25 Aug/);
    assert.deepEqual(card.buttons[0].map((b) => b.callback_data), ['r:s', 'r:e', 'r:x']);
    assert.equal(db.expenses.length, 0, 'nothing is saved before the person confirms');
    assert.equal(db.telegram_pending[0].kind, 'receipt');
    await deliver(tg, callback(CHAT_A, 'r:s'));
    const saved = db.expenses[0];
    assert.deepEqual([saved.user_id, saved.amount, saved.category, saved.note], [A, 125.4, 'food', 'via Telegram receipt']);
    assert.match(saved.merchant, /Sarawak/);
    assert.equal(saved.created_at, '2026-08-25T04:00:00.000Z', 'dated by the receipt');
    assert.match(tg.lastEdit().html, /Saved from receipt/);
    assert.equal(db.telegram_pending.length, 0);
    await deliver(tg, callback(CHAT_A, 'r:s'));
    assert.match(tg.lastEdit().html, /expired/);
    assert.equal(db.expenses.length, 1, 'pressing Save twice does not save twice');
});

test('receipt: Edit amount, Cancel and an expired card', async () => {
    const { db, tg, hooks } = await linked({ OCR_SPACE_API_KEY: 'ocr-key' });
    ocrReturns(hooks, { ParsedResults: [{ ParsedText: RECEIPT }] });
    tg.file = { bytes: JPEG };
    await deliver(tg, photoMessage(CHAT_A));
    await deliver(tg, callback(CHAT_A, 'r:e'));
    assert.match(tg.lastEdit().html, /Send the new amount/);
    await deliver(tg, message(CHAT_A, 'rm99'));
    assert.match(tg.last().html, /Receipt found/);
    assert.match(tg.last().html, /<b>RM\s?99\.00<\/b>/);
    await deliver(tg, callback(CHAT_A, 'r:s'));
    assert.equal(db.expenses[0].amount, 99);
    await deliver(tg, photoMessage(CHAT_A));
    await deliver(tg, callback(CHAT_A, 'r:x'));
    assert.match(tg.lastEdit().html, /discarded/);
    assert.equal(db.expenses.length, 1);
    await deliver(tg, photoMessage(CHAT_A));
    db.telegram_pending[0].expires_at = new Date(Date.now() - 1000).toISOString();
    await deliver(tg, callback(CHAT_A, 'r:s'));
    assert.match(tg.lastEdit().html, /expired/);
    assert.equal(db.expenses.length, 1);
});

test('receipt: when no reliable total is found the bot asks for the amount instead of guessing', async () => {
    const { db, tg, hooks } = await linked({ OCR_SPACE_API_KEY: 'ocr-key' });
    ocrReturns(hooks, { ParsedResults: [{ ParsedText: 'KEDAI ALI\nNasi lemak\nTeh tarik\nThank you' }] });
    tg.file = { bytes: JPEG };
    await deliver(tg, photoMessage(CHAT_A));
    assert.match(tg.last().html, /couldn't find a reliable total/);
    assert.equal(db.telegram_pending[0].kind, 'receipt_amount');
    assert.equal(db.expenses.length, 0);
    await deliver(tg, message(CHAT_A, '8.50'));
    assert.match(tg.last().html, /<b>RM\s?8\.50<\/b>/);
    await deliver(tg, callback(CHAT_A, 'r:s'));
    assert.equal(db.expenses[0].amount, 8.5);
});

test('receipt: every failure has a friendly fallback that points back to typing the expense', async () => {
    const { db, tg, hooks } = await linked({ OCR_SPACE_API_KEY: 'ocr-key' });
    tg.file = { bytes: JPEG };
    ocrReturns(hooks, { IsErroredOnProcessing: true });
    await deliver(tg, photoMessage(CHAT_A));
    assert.match(tg.last().html, /couldn't read that photo/);
    ocrReturns(hooks, {}, 500);
    await deliver(tg, photoMessage(CHAT_A));
    assert.match(tg.last().html, /Photo reading isn't available/);
    tg.file = { error: 'too_large' };
    await deliver(tg, photoMessage(CHAT_A));
    assert.match(tg.last().html, /too large/);
    tg.file = { error: 'failed' };
    await deliver(tg, photoMessage(CHAT_A));
    assert.match(tg.last().html, /couldn't read that photo/);
    tg.file = { bytes: new TextEncoder().encode('this is not an image file, it is plain text') };
    ocrReturns(hooks, { ParsedResults: [{ ParsedText: RECEIPT }] });
    await deliver(tg, photoMessage(CHAT_A));
    assert.match(tg.last().html, /couldn't read that photo/);
    tg.file = { bytes: JPEG };
    db.counters.set(`ocr:${A}`, 30);
    await deliver(tg, photoMessage(CHAT_A));
    assert.match(tg.last().html, /receipt-scan limit/);
    assert.equal(db.expenses.length, 0);
    assert.equal(db.telegram_pending.length, 0);
});

test('receipt: no OCR key, an unlinked chat, a non-image file and huge pictures are all handled', async () => {
    const noKey = await linked();
    noKey.tg.file = { bytes: JPEG };
    await deliver(noKey.tg, photoMessage(CHAT_A));
    assert.match(noKey.tg.last().html, /Photo reading isn't available/);
    delete globalThis.Deno;

    const { db, tg, hooks } = setup({ OCR_SPACE_API_KEY: 'ocr-key' });
    await deliver(tg, photoMessage(CHAT_A));
    assert.match(tg.last().html, /isn't connected/);
    seedChoices(db, A);
    await link(db, tg, 'tok-a', CHAT_A);
    tg.file = { bytes: JPEG };
    ocrReturns(hooks, { ParsedResults: [{ ParsedText: RECEIPT }] });
    const before = tg.sent.length;
    await deliver(tg, { update_id: 99991, message: { message_id: 9, chat: { id: CHAT_A, type: 'private' }, document: { file_id: 'd', mime_type: 'application/pdf', file_size: 1000 } } });
    assert.match(tg.last().html, /couldn't read that photo/);
    await deliver(tg, { update_id: 99992, message: { message_id: 9, chat: { id: CHAT_A, type: 'private' }, document: { file_id: 'd', mime_type: 'image/png', file_size: 5_000_000 } } });
    assert.match(tg.last().html, /too large/);
    await deliver(tg, photoMessage(CHAT_A, [{ file_id: 'huge', file_size: 4_000_000 }]));
    assert.ok(tg.sent.length > before);
    await deliver(tg, { update_id: 99993, message: { message_id: 9, chat: { id: CHAT_A, type: 'private' }, document: { file_id: 'd', mime_type: 'image/png', file_size: 90_000 } } });
    assert.match(tg.last().html, /Receipt found/, 'a PNG sent as a file works too');
});

test('receipt: a pending receipt of one person can not be saved from another person\'s chat', async () => {
    const { db, tg, hooks } = await linked({ OCR_SPACE_API_KEY: 'ocr-key' });
    seedChoices(db, B);
    await link(db, tg, 'tok-b', CHAT_B);
    ocrReturns(hooks, { ParsedResults: [{ ParsedText: RECEIPT }] });
    tg.file = { bytes: JPEG };
    await deliver(tg, photoMessage(CHAT_A));
    await deliver(tg, callback(CHAT_B, 'r:s'));
    assert.match(tg.lastEdit().html, /expired/, 'Bob has no pending receipt');
    assert.equal(db.expenses.length, 0);
    await deliver(tg, callback(CHAT_A, 'r:s'));
    assert.deepEqual(db.expenses.map((e) => e.user_id), [A]);
});

// ------------------------------------------------------------------ weekly summary sender
const digestModule = () => import('../supabase/functions/telegram-digest/handler.ts');
const MONDAY = new Date('2026-11-09T02:00:00Z'); // Monday 10:00 in Kuala Lumpur
const cron = (over = {}) => new Request('https://abcdefghij.supabase.co/functions/v1/telegram-digest', {
    method: 'POST', headers: { 'x-cron-secret': H.ENV.MONTHLY_REPORT_CRON_SECRET, ...over }, body: '{}',
});

async function digestWorld() {
    const ctx = setup();
    const { db } = ctx;
    add(db, 'telegram_links', { chat_id: CHAT_A, user_id: A, lang: 'en', digest_on: true, last_digest_week: null });
    add(db, 'telegram_links', { chat_id: CHAT_B, user_id: B, lang: 'ms', digest_on: false, last_digest_week: null });
    const spend = (user, amount, at, category = 'food', merchant = 'Cafe') => add(db, 'expenses', { user_id: user, amount: String(amount), category, payment: 'bank', merchant, created_at: at });
    spend(A, 50, '2026-11-03T04:00:00Z');                       // this week (Mon 2 - Sun 8 Nov)
    spend(A, 30, '2026-11-08T15:59:00Z', 'car', 'Petronas');   // last minute of Sunday in KL
    spend(A, 999, '2026-11-08T16:00:00Z');                      // Monday 9 Nov in KL: next week, not counted
    spend(A, 40, '2026-10-28T04:00:00Z');                       // the week before
    spend(B, 10, '2026-11-03T04:00:00Z');
    return ctx;
}

test('weekly summary: only the scheduler can start it, and only on Monday morning in Kuala Lumpur', async () => {
    const { handle } = await digestModule();
    const { tg } = await digestWorld();
    assert.equal((await handle(new Request('https://x', { method: 'GET' }), MONDAY, tg.client)).status, 405);
    assert.equal((await handle(cron({ 'x-cron-secret': 'wrong' }), MONDAY, tg.client)).status, 401);
    assert.equal((await handle(new Request('https://x', { method: 'POST' }), MONDAY, tg.client)).status, 401);
    for (const when of ['2026-11-10T02:00:00Z', '2026-11-08T02:00:00Z', '2026-11-09T00:30:00Z']) { // Tue, Sun, Monday 08:30 KL
        const out = await (await handle(cron(), new Date(when), tg.client)).json();
        assert.match(out.message, /Monday from 09:00/, when);
    }
    assert.equal(tg.sent.length, 0);
    delete globalThis.Deno;
    setup({ MONTHLY_REPORT_CRON_SECRET: undefined });
    assert.equal((await handle(cron({ 'x-cron-secret': '' }), MONDAY, tg.client)).status, 503, 'an unset secret never means "anyone"');
    delete globalThis.Deno;
    setup({ TELEGRAM_BOT_TOKEN: undefined });
    assert.equal((await handle(cron(), MONDAY, tg.client)).status, 503);
});

test('weekly summary: sends the right numbers to opted-in people only, once per week', async () => {
    const { handle } = await digestModule();
    const { db, tg } = await digestWorld();
    const out = await (await handle(cron(), MONDAY, tg.client)).json();
    assert.deepEqual([out.week, out.sent, out.failed, out.blocked], ['2026-11-09', 1, 0, 0]);
    assert.deepEqual(tg.sent.map((m) => m.chatId), [CHAT_A], 'the person who did not opt in gets nothing');
    const text = tg.sent[0].html;
    assert.match(text, /Your week<\/b> · 2 Nov – 8 Nov/);
    assert.match(text, /Spent\s+<b>RM\s?80\.00<\/b>\s+🔺 100% <i>vs last week/);
    assert.match(text, /Biggest\s+<b>RM\s?50\.00<\/b> · Cafe/);
    assert.match(text, /🍜 food/);
    assert.ok(!/999/.test(text), 'Monday 9 Nov belongs to next week');
    assert.equal(db.telegram_links[0].last_digest_week, '2026-11-09');
    const again = await (await handle(cron(), MONDAY, tg.client)).json();
    assert.equal(again.sent, 0);
    assert.equal(tg.sent.length, 1, 'never twice in one week');
    const later = await (await handle(cron(), new Date('2026-11-16T03:00:00Z'), tg.client)).json();
    assert.equal(later.week, '2026-11-16');
});

test('weekly summary: two overlapping runs send once; a blocked person is switched off; a temporary failure is retried', async () => {
    const { handle } = await digestModule();
    const { db, tg } = await digestWorld();
    const both = await Promise.all([handle(cron(), MONDAY, tg.client), handle(cron(), MONDAY, tg.client), handle(cron(), MONDAY, tg.client)].map((p) => p.then((r) => r.json())));
    assert.equal(both.reduce((n, r) => n + r.sent, 0), 1);
    assert.equal(tg.sent.length, 1);

    db.telegram_links[0].last_digest_week = null;
    tg.checkedResult = 'failed';
    const failed = await (await handle(cron(), MONDAY, tg.client)).json();
    assert.equal(failed.failed, 1);
    assert.equal(db.telegram_links[0].last_digest_week, null, 'released, so the next hourly run tries again');
    assert.equal(db.telegram_links[0].digest_on, true);

    tg.checkedResult = 'blocked';
    const blocked = await (await handle(cron(), MONDAY, tg.client)).json();
    assert.equal(blocked.blocked, 1);
    assert.equal(db.telegram_links[0].digest_on, false, 'a person who blocked the bot is not messaged again');
});

test('weekly summary: a quiet fortnight sends nothing; the database being down answers with an error and sends nothing', async () => {
    const { handle } = await digestModule();
    const { db, tg } = await digestWorld();
    db.expenses.length = 0;
    const quiet = await (await handle(cron(), MONDAY, tg.client)).json();
    assert.deepEqual([quiet.sent, quiet.skipped], [0, 1]);
    assert.equal(tg.sent.length, 0);
    db.telegram_links[0].last_digest_week = null;
    db.failures.add('telegram_links');
    const down = await handle(cron(), MONDAY, tg.client);
    assert.equal(down.status, 502);
    assert.equal(tg.sent.length, 0);
});

test('weekly summary: sent in the person\'s language', async () => {
    const { handle } = await digestModule();
    const { db, tg } = await digestWorld();
    db.telegram_links[1].digest_on = true;
    await handle(cron(), MONDAY, tg.client);
    const malay = tg.sent.find((m) => m.chatId === CHAT_B);
    assert.match(malay.html, /Minggu anda/);
});
