'use strict';
// Behaviour of the Phase 2 reports inside the bot: the picture reports, the navigation buttons that update a report in
// place, the fallbacks when pictures or edits fail, the Monday summary, and the photo upload code of the real client.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers/tg-harness.js');
const { A, B, CHAT_A, CHAT_B, setup, message, deliver, link, seedChoices } = H;

test.afterEach(() => { delete globalThis.Deno; });
const shared = (name) => import(`../supabase/functions/_shared/${name}.ts`);

let counter = 70_000;
/** A button press on a report message: `photo` says whether that message is a picture. */
const nav = (chatId, data, { photo = false, messageId = 55 } = {}) => ({
    update_id: ++counter,
    callback_query: { id: `cb${counter}`, data, message: { message_id: messageId, chat: { id: chatId, type: 'private' }, ...(photo ? { photo: [{ file_id: 'p' }] } : {}) } },
});

const seedMonth = (db, user = A) => {
    const add = (amount, iso, category = 'food', merchant = 'Cafe') => db.expenses.push({ id: crypto.randomUUID(), user_id: user, amount: String(amount), category, payment: 'bank', merchant, created_at: iso });
    add(300, '2026-11-03T04:00:00Z', 'shopping', 'Mydin'); add(60, '2026-11-04T04:00:00Z'); add(40, '2026-11-05T01:00:00Z', 'car', 'Petronas');
    add(80, '2026-10-10T04:00:00Z'); add(120, '2026-10-20T04:00:00Z', 'shopping', 'Mydin');
};
const linked = async (extraEnv = {}) => {
    const ctx = setup(extraEnv);
    seedChoices(ctx.db, A);
    ctx.db.user_categories.push({ user_id: A, category_key: 'car', label: 'Car', active: true, sort_order: 5 });
    await link(ctx.db, ctx.tg, 'tok-a', CHAT_A);
    seedMonth(ctx.db);
    return ctx;
};
const plain = async (html) => (await shared('telegram')).stripTags(html).replace(/ /g, ' ');

// ------------------------------------------------------------------ commands produce pictures
test('/month and /week send a picture with a caption and the navigation buttons; /today and /top stay text', async () => {
    const { tg } = await linked();
    await deliver(tg, message(CHAT_A, '/month'));
    const month = tg.last();
    assert.equal(month.photo, true);
    assert.ok(month.png.length > 1000);
    assert.match(await plain(month.html), /November 2026/);
    assert.deepEqual(month.buttons[0].map((b) => b.callback_data), ['n:d:0', 'n:w:0', 'n:m:0', 'n:p:0']);
    assert.match(month.buttons[0][2].text, /^• /, 'the current view is marked');
    assert.ok(month.buttons.flat().some((b) => b.callback_data === 'n:fm:0'), 'a Details button for the full text');
    assert.deepEqual(tg.actions, [CHAT_A], 'typing… while the picture is made');
    await deliver(tg, message(CHAT_A, '/week'));
    assert.equal(tg.last().photo, true);
    assert.match(await plain(tg.last().html), /Week · 2 Nov – 8 Nov/);
    await deliver(tg, message(CHAT_A, '/today'));
    assert.equal(tg.last().photo, undefined);
    assert.ok(!tg.last().buttons.flat().some((b) => b.callback_data?.startsWith('n:f')), 'no details button on a text view');
    await deliver(tg, message(CHAT_A, '/top'));
    assert.match(tg.last().html, /<pre>/);
    await deliver(tg, message(CHAT_A, '🗓 Month'));
    assert.equal(tg.last().photo, true, 'the bottom-menu button gives the same picture');
});

// ------------------------------------------------------------------ in-place navigation
test('navigation: picture to picture is edited in place - same message, no new message, nothing deleted', async () => {
    const { tg } = await linked();
    await deliver(tg, message(CHAT_A, '/month'));
    const id = tg.lastSent().id;
    const sent = tg.sent.length;
    await deliver(tg, nav(CHAT_A, 'n:w:0', { photo: true, messageId: id }));
    const edit = tg.lastEdit();
    assert.equal(edit.photo, true);
    assert.equal(edit.messageId, id);
    assert.match(await plain(edit.html), /Week/);
    assert.equal(tg.sent.length, sent, 'no extra message');
    assert.deepEqual(tg.removed, []);
    assert.match(edit.buttons[0][1].text, /^• /, 'the marker moved to Week');
    await deliver(tg, nav(CHAT_A, 'n:m:1', { photo: true, messageId: id }));
    assert.match(await plain(tg.lastEdit().html), /October 2026/);
    assert.ok(tg.lastEdit().buttons.flat().some((b) => b.callback_data === 'n:m:0'), 'a way back to the present');
    assert.ok(tg.lastEdit().buttons.flat().some((b) => b.callback_data === 'n:m:2'), 'and further back');
    await deliver(tg, nav(CHAT_A, 'n:m:0', { photo: true, messageId: id }));
    assert.match(await plain(tg.lastEdit().html), /November 2026/);
    assert.ok(!tg.lastEdit().buttons.flat().some((b) => b.callback_data === 'n:m:-1'));
});

test('navigation: switching between a picture and text sends the new view first, then removes the old message', async () => {
    const { tg } = await linked();
    await deliver(tg, message(CHAT_A, '/month'));
    const pictureId = tg.lastSent().id;
    await deliver(tg, nav(CHAT_A, 'n:d:0', { photo: true, messageId: pictureId }));
    assert.equal(tg.last().photo, undefined);
    assert.match(tg.last().html, /Today/);
    assert.deepEqual(tg.removed, [{ chatId: CHAT_A, messageId: pictureId }]);
    const textId = tg.lastSent().id;
    await deliver(tg, nav(CHAT_A, 'n:m:0', { photo: false, messageId: textId }));
    assert.equal(tg.lastSent().photo, true, 'text -> picture: a new picture message');
    assert.deepEqual(tg.removed.at(-1), { chatId: CHAT_A, messageId: textId });
});

test('navigation: text to text is an ordinary edit', async () => {
    const { tg } = await linked();
    await deliver(tg, message(CHAT_A, '/today'));
    const id = tg.lastSent().id;
    const sent = tg.sent.length;
    await deliver(tg, nav(CHAT_A, 'n:p:0', { photo: false, messageId: id }));
    assert.match(tg.lastEdit().html, /Top spending/);
    assert.equal(tg.lastEdit().messageId, id);
    assert.equal(tg.sent.length, sent);
    assert.deepEqual(tg.removed, []);
    await deliver(tg, nav(CHAT_A, 'n:d:1', { photo: false, messageId: id }));
    assert.match(tg.lastEdit().html, /Today/);
});

test('navigation: Details sends the complete text as a NEW message and leaves the picture alone', async () => {
    const { tg } = await linked();
    await deliver(tg, message(CHAT_A, '/month'));
    const id = tg.lastSent().id;
    const edits = tg.edited.length;
    await deliver(tg, nav(CHAT_A, 'n:fm:0', { photo: true, messageId: id }));
    const details = tg.lastSent();
    assert.equal(details.photo, undefined);
    assert.match(details.html, /<b>Categories<\/b>/);
    assert.match(await plain(details.html), /Daily spending/);
    assert.equal(tg.edited.length, edits);
    assert.deepEqual(tg.removed, []);
    await deliver(tg, nav(CHAT_A, 'n:fw:1', { photo: true, messageId: id }));
    assert.match(await plain(tg.lastSent().html), /Week · 26 Oct – 1 Nov/);
});

test('navigation: made-up, out-of-range and stranger presses are ignored, and every press is still acknowledged', async () => {
    const { tg } = await linked();
    await deliver(tg, message(CHAT_A, '/month'));
    const sent = tg.sent.length;
    const before = tg.answered.length;
    const junk = ['n:x:0', 'n:m:', 'n:m:-1', 'n:m:61', 'n:w:105', 'n:d:367', 'n:p:61', 'n:m:1.5', 'n:fm:99', 'n:fx:1', 'n:fd:0', 'N:m:0', 'n:m:0 ', 'n::0', 'n:m:0:1', 'n:m:00000'];
    for (const data of junk) await deliver(tg, nav(CHAT_A, data, { photo: true }));
    assert.equal(tg.sent.length, sent, 'nothing sent');
    assert.equal(tg.edited.length, 0, 'nothing edited');
    assert.equal(tg.answered.length, before + junk.length, 'but no button is left spinning');
    await deliver(tg, nav(CHAT_B, 'n:m:0', { photo: true }));
    assert.equal(tg.sent.length, sent, 'a chat that is not linked gets nothing');
});

test('navigation: the daily report-view limit is enforced for commands and buttons', async () => {
    const { db, tg } = await linked();
    db.counters.set(`tg-view:${CHAT_A}`, 300);
    await deliver(tg, message(CHAT_A, '/month'));
    assert.match(tg.last().html, /Too many report views/);
    assert.equal(tg.last().photo, undefined);
    await deliver(tg, nav(CHAT_A, 'n:w:0', { photo: true }));
    assert.match(tg.toasts().at(-1), /Too many report views/);
    assert.equal(tg.edited.length, 0);
    await deliver(tg, nav(CHAT_A, 'n:fm:0', { photo: true }));
    assert.match(tg.toasts().at(-1), /Too many report views/);
});

// ------------------------------------------------------------------ fallbacks
test('fallback: when the picture cannot be sent the same report arrives as text, in full, with navigation', async () => {
    const { tg } = await linked();
    tg.photoFails = true;
    await deliver(tg, message(CHAT_A, '/month'));
    const text = tg.last();
    assert.equal(text.photo, undefined);
    assert.match(await plain(text.html), /November 2026/);
    assert.match(await plain(text.html), /Daily spending/, 'the complete report, not a cut-down caption');
    assert.match(await plain(text.html), /Last 6 months/);
    assert.ok(text.buttons[0].some((b) => b.callback_data === 'n:w:0'), 'navigation survives');
    assert.ok(!text.buttons.flat().some((b) => b.callback_data?.startsWith('n:f')), 'no Details button when the report already is the details');
    tg.photoFails = false;
    tg.throwOn.add('sendPhoto');
    await deliver(tg, message(CHAT_A, '/week'));
    assert.equal(tg.last().photo, undefined, 'even a thrown error becomes the text report');
    assert.match(await plain(tg.last().html), /Week/);
});

test('fallback: if editing the picture fails the new view is sent as a new message and the old one removed', async () => {
    const { tg } = await linked();
    await deliver(tg, message(CHAT_A, '/month'));
    const id = tg.lastSent().id;
    tg.editPhotoFails = true;
    await deliver(tg, nav(CHAT_A, 'n:w:0', { photo: true, messageId: id }));
    assert.equal(tg.lastSent().photo, true);
    assert.match(await plain(tg.lastSent().html), /Week/);
    assert.deepEqual(tg.removed, [{ chatId: CHAT_A, messageId: id }]);
    tg.throwOn.add('editPhoto');
    tg.throwOn.add('remove');
    await deliver(tg, nav(CHAT_A, 'n:m:1', { photo: true, messageId: 77 }));
    assert.match(await plain(tg.lastSent().html), /October 2026/, 'a failing edit AND a failing delete still end with a correct report');
});

test('fallback: a client without picture support at all still gets every report as text', async () => {
    const { tg } = await linked();
    for (const name of ['sendPhoto', 'sendPhotoChecked', 'editPhoto', 'remove']) delete tg.client[name];
    await deliver(tg, message(CHAT_A, '/month'));
    assert.match(await plain(tg.last().html), /November 2026/);
    assert.equal(tg.last().photo, undefined);
    await deliver(tg, nav(CHAT_A, 'n:w:0', { photo: true, messageId: 5 }));
    assert.match(await plain(tg.last().html), /Week/);
    await deliver(tg, nav(CHAT_A, 'n:d:0', { photo: false, messageId: 6 }));
    assert.match(tg.lastEdit().html, /Today/);
});

test('fallback: a database error gives a polite message or pop-up, never a broken report', async () => {
    const { db, tg } = await linked();
    db.failures.add('expenses');
    await deliver(tg, message(CHAT_A, '/month'));
    assert.match(tg.last().html, /went wrong/);
    await deliver(tg, nav(CHAT_A, 'n:w:0', { photo: true }));
    assert.match(tg.toasts().at(-1), /Couldn't update that view/);
    await deliver(tg, nav(CHAT_A, 'n:fm:0', { photo: true }));
    assert.match(tg.toasts().at(-1), /Couldn't update that view/);
    db.failures.clear();
    await deliver(tg, message(CHAT_A, '/month'));
    assert.equal(tg.last().photo, true, 'and it works again once the database does');
});

test('fallback: typing and deletion failing change nothing', async () => {
    const { tg } = await linked();
    tg.throwOn.add('action');
    await deliver(tg, message(CHAT_A, '/month'));
    assert.equal(tg.last().photo, true);
});

// ------------------------------------------------------------------ privacy and consistency
test('privacy: each person only ever sees their own numbers, in every view and on every button press', async () => {
    const { db, tg } = await linked();
    seedChoices(db, B);
    await link(db, tg, 'tok-b', CHAT_B);
    db.expenses.push({ id: crypto.randomUUID(), user_id: B, amount: '7777', category: 'food', payment: 'bank', merchant: 'Bobs Secret', created_at: '2026-11-04T04:00:00Z' });
    for (const text of ['/month', '/week', '/today', '/top']) {
        await deliver(tg, message(CHAT_A, text));
        assert.ok(!/7,?777|Bobs/.test(await plain(tg.last().html)), `Alice's ${text}`);
    }
    for (const data of ['n:m:0', 'n:w:0', 'n:d:0', 'n:p:0', 'n:fm:0', 'n:fw:0']) {
        await deliver(tg, nav(CHAT_A, data, { photo: true }));
        assert.ok(!/7,?777|Bobs/.test(await plain(tg.last().html)), `Alice's ${data}`);
    }
    await deliver(tg, message(CHAT_B, '/month'));
    assert.match(await plain(tg.last().html), /RM 7,777\.00/);
    assert.ok(!/300\.00|Mydin/.test(await plain(tg.last().html)), "Bob never sees Alice's");
});

test('every report, in every language, stays within Telegram limits and has valid, plain-text buttons', async () => {
    const { db, tg } = await linked();
    db.budgets.push({ user_id: A, category: 'all', amount: '400' }, { user_id: A, category: 'shopping', amount: '350' });
    db.user_categories.push({ user_id: A, category_key: 'pets', label: '<b>Pets</b> & "co"', active: true, sort_order: 9 });
    const { stripTags } = await shared('telegram');
    for (const lang of ['en', 'ms', 'zh']) {
        await deliver(tg, H.callback(CHAT_A, `l:${lang}`));
        for (const text of ['/month', '/week', '/today', '/top']) await deliver(tg, message(CHAT_A, text));
        for (const data of ['n:m:1', 'n:w:1', 'n:fm:0', 'n:fw:0']) await deliver(tg, nav(CHAT_A, data, { photo: true }));
    }
    const all = [...tg.sent, ...tg.edited];
    assert.ok(all.length > 30);
    for (const m of all) {
        if (m.photo) assert.ok(stripTags(m.html).length <= 1024, `caption ${stripTags(m.html).length}`);
        else assert.ok(m.html.length < 4096);
        for (const b of (m.buttons ?? []).flat()) {
            assert.ok(!/&(amp|lt|gt|quot|#39);/.test(b.text), b.text);
            if (b.callback_data) assert.ok(Buffer.byteLength(b.callback_data) <= 64, b.callback_data);
        }
    }
});

// ------------------------------------------------------------------ the Monday summary with a picture
const digestModule = () => import('../supabase/functions/telegram-digest/handler.ts');
const MONDAY = new Date('2026-11-09T02:00:00Z');
const cron = () => new Request('https://abcdefghij.supabase.co/functions/v1/telegram-digest', { method: 'POST', headers: { 'x-cron-secret': H.ENV.MONTHLY_REPORT_CRON_SECRET }, body: '{}' });
function digestWorld(extraEnv = {}) {
    const ctx = setup(extraEnv);
    const { db } = ctx;
    db.telegram_links.push({ id: 1, chat_id: CHAT_A, user_id: A, lang: 'en', digest_on: true, last_digest_week: null });
    const spend = (amount, iso, category = 'food', merchant = 'Cafe') => db.expenses.push({ id: crypto.randomUUID(), user_id: A, amount: String(amount), category, payment: 'bank', merchant, created_at: iso });
    spend(50, '2026-11-03T04:00:00Z'); spend(30, '2026-11-08T15:59:00Z', 'car', 'Petronas'); spend(40, '2026-10-28T04:00:00Z');
    return ctx;
}

test('weekly summary: a picture with the week in the caption, a tip, and navigation continuing from last week', async () => {
    const { handle } = await digestModule();
    const { tg } = digestWorld({ SITE_URL: 'https://me.github.io/VinExpenses' });
    const out = await (await handle(cron(), MONDAY, tg.client)).json();
    assert.equal(out.sent, 1);
    const m = tg.sent.at(-1);
    assert.equal(m.photo, true);
    assert.ok(m.png.length > 1000);
    const text = await plain(m.html);
    assert.match(text, /Your week · 2 Nov – 8 Nov/);
    assert.match(text, /Spent\s+RM 80\.00/);
    assert.match(text, /digest off/, 'the tip is added when it fits');
    assert.ok(text.length <= 1024);
    assert.deepEqual(m.buttons.flat().map((b) => b.callback_data ?? b.url).slice(4), ['n:w:2', 'n:w:0', 'n:fw:1', 'https://me.github.io/VinExpenses'], 'earlier / later continue from the week that was reported');
});

test('weekly summary: if the picture fails it falls back to the complete text; if the person blocked the bot nothing else is tried', async () => {
    const { handle } = await digestModule();
    const first = digestWorld();
    first.tg.checkedPhotoResult = 'failed';
    first.tg.checkedResult = 'ok';
    const out = await (await handle(cron(), MONDAY, first.tg.client)).json();
    assert.equal(out.sent, 1, 'delivered as text');
    assert.equal(first.tg.sent.length, 2);
    assert.equal(first.tg.sent[1].photo, undefined);
    assert.match(await plain(first.tg.sent[1].html), /Your week/);
    assert.equal(first.db.telegram_links[0].last_digest_week, '2026-11-09');
    delete globalThis.Deno;

    const blocked = digestWorld();
    blocked.tg.checkedPhotoResult = 'blocked';
    const b = await (await handle(cron(), MONDAY, blocked.tg.client)).json();
    assert.equal(b.blocked, 1);
    assert.equal(blocked.tg.sent.length, 1, 'no second attempt at someone who blocked the bot');
    assert.equal(blocked.db.telegram_links[0].digest_on, false);
    delete globalThis.Deno;

    const broken = digestWorld();
    broken.tg.checkedPhotoResult = 'failed';
    broken.tg.checkedResult = 'failed';
    const f = await (await handle(cron(), MONDAY, broken.tg.client)).json();
    assert.equal(f.failed, 1);
    assert.equal(broken.db.telegram_links[0].last_digest_week, null, 'released: the next hourly run tries again');
});

test('weekly summary: a quiet week after a busy one is a short text; a quiet fortnight sends nothing', async () => {
    const { handle } = await digestModule();
    const quiet = digestWorld();
    quiet.db.expenses.length = 0;
    quiet.db.expenses.push({ id: 'e1', user_id: A, amount: '40', category: 'food', payment: 'bank', merchant: 'Cafe', created_at: '2026-10-28T04:00:00Z' });
    await handle(cron(), MONDAY, quiet.tg.client);
    assert.equal(quiet.tg.sent.length, 1);
    assert.equal(quiet.tg.sent[0].photo, undefined);
    assert.match(await plain(quiet.tg.sent[0].html), /No expenses yet/);
    delete globalThis.Deno;
    const nothing = digestWorld();
    nothing.db.expenses.length = 0;
    const out = await (await handle(cron(), MONDAY, nothing.tg.client)).json();
    assert.deepEqual([out.sent, out.skipped], [0, 1]);
    assert.equal(nothing.tg.sent.length, 0);
});

test('weekly summary: the caption never exceeds Telegram\'s limit, even with many categories', async () => {
    const { handle } = await digestModule();
    const { db, tg } = digestWorld();
    for (let i = 0; i < 40; i++) db.expenses.push({ id: crypto.randomUUID(), user_id: A, amount: String(5 + i), category: `category${i}`, payment: 'bank', merchant: `Shop ${i}`, created_at: '2026-11-04T04:00:00Z' });
    await handle(cron(), MONDAY, tg.client);
    assert.ok((await plain(tg.sent.at(-1).html)).length <= 1024);
});

// ------------------------------------------------------------------ the real Telegram client, pictures
function stub(plan = []) {
    const calls = [];
    const logged = [];
    const original = console.error;
    console.error = (...args) => logged.push(args.join(' '));
    return {
        calls, logged, restore: () => { console.error = original; },
        fetchImpl: async (url, init) => {
            calls.push({ url: String(url), body: init.body });
            const step = plan.shift() ?? { status: 200, body: { ok: true, result: { message_id: 4242 } } };
            return new Response(JSON.stringify(step.body ?? {}), { status: step.status });
        },
    };
}
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, ...new Array(40).fill(9)]);

test('client: sendPhoto uploads the picture with its caption, parse mode and buttons', async () => {
    const { telegramClient } = await shared('telegram');
    const t = stub();
    try {
        const client = telegramClient('123:TOKEN', t.fetchImpl);
        const id = await client.sendPhoto(5, PNG, '<b>Caption</b>', { buttons: [[{ text: 'Go', callback_data: 'n:m:0' }, { text: 'Open', url: 'https://site.example' }]] });
        assert.equal(id, 4242);
        const call = t.calls[0];
        assert.equal(call.url, 'https://api.telegram.org/bot123:TOKEN/sendPhoto');
        assert.ok(call.body instanceof FormData);
        assert.equal(call.body.get('chat_id'), '5');
        assert.equal(call.body.get('caption'), '<b>Caption</b>');
        assert.equal(call.body.get('parse_mode'), 'HTML');
        const file = call.body.get('photo');
        assert.equal(file.type, 'image/png');
        assert.deepEqual(new Uint8Array(await file.arrayBuffer()), PNG);
        assert.deepEqual(JSON.parse(call.body.get('reply_markup')).inline_keyboard[0][1], { text: 'Open', url: 'https://site.example' });
        assert.equal(await client.sendPhotoChecked(5, PNG, 'x'), 'ok');
    } finally { t.restore(); }
});

test('client: a caption Telegram refuses (formatting or length) is re-sent as plain text; other failures are reported', async () => {
    const { telegramClient } = await shared('telegram');
    const parse = { status: 400, body: { ok: false, description: "Bad Request: can't parse entities: Unsupported start tag" } };
    const long = { status: 400, body: { ok: false, description: 'Bad Request: message caption is too long' } };
    const ok = { status: 200, body: { ok: true, result: { message_id: 4242 } } };
    const t = stub([parse, ok, long, ok]);
    try {
        const client = telegramClient('123:TOKEN', t.fetchImpl);
        assert.equal(await client.sendPhoto(5, PNG, '<b>RM 5</b> &amp; <blockquote expandable>x</blockquote>'), 4242);
        assert.equal(t.calls[1].body.get('parse_mode'), null);
        assert.equal(t.calls[1].body.get('caption'), 'RM 5 & x');
        assert.equal(await client.sendPhoto(5, PNG, 'y'.repeat(3000)), 4242);
        assert.equal(t.calls[3].body.get('caption').length, 1000, 'plain, cut to a safe length');
        assert.equal(t.logged.length, 0, 'recovered problems are not errors');
    } finally { t.restore(); }
    const bad = stub([{ status: 403, body: { ok: false, description: 'Forbidden: bot was blocked by the user' } }, { status: 500, body: {} }, { status: 400, body: { ok: false, description: 'Bad Request: chat not found' } }]);
    try {
        const client = telegramClient('123:TOKEN', bad.fetchImpl);
        assert.equal(await client.sendPhotoChecked(5, PNG, 'x'), 'blocked');
        assert.equal(await client.sendPhotoChecked(5, PNG, 'x'), 'failed');
        assert.equal(await client.sendPhoto(5, PNG, 'x'), null);
        assert.ok(bad.logged.every((line) => !line.includes('TOKEN')));
        const down = telegramClient('123:TOKEN', async () => { throw new Error('boom'); });
        assert.equal(await down.sendPhoto(5, PNG, 'x'), null);
        assert.equal(await down.editPhoto(5, 9, PNG, 'x'), false);
    } finally { bad.restore(); }
});

test('client: editPhoto replaces the picture and caption in place; "not modified" counts as success; remove deletes', async () => {
    const { telegramClient } = await shared('telegram');
    const t = stub([
        { status: 200, body: { ok: true, result: true } },
        { status: 400, body: { ok: false, description: 'Bad Request: message is not modified' } },
        { status: 400, body: { ok: false, description: 'Bad Request: message to edit not found' } },
        { status: 200, body: { ok: true, result: true } },
    ]);
    try {
        const client = telegramClient('123:TOKEN', t.fetchImpl);
        assert.equal(await client.editPhoto(5, 9, PNG, '<b>New</b>', { buttons: [[{ text: 'A', callback_data: 'x' }]] }), true);
        const call = t.calls[0];
        assert.match(call.url, /editMessageMedia$/);
        assert.equal(call.body.get('message_id'), '9');
        assert.deepEqual(JSON.parse(call.body.get('media')), { type: 'photo', media: 'attach://photo', caption: '<b>New</b>', parse_mode: 'HTML' });
        assert.equal(call.body.get('photo').type, 'image/png');
        assert.equal(await client.editPhoto(5, 9, PNG, 'same'), true, 'nothing changed is fine');
        assert.equal(await client.editPhoto(5, 9, PNG, 'gone'), false);
        assert.equal(t.logged.length, 1, 'only the real failure is logged');
        await client.remove(5, 9);
        assert.match(t.calls[3].url, /deleteMessage$/);
        assert.deepEqual(JSON.parse(t.calls[3].body), { chat_id: 5, message_id: 9 });
    } finally { t.restore(); }
});
