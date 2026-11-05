'use strict';
// Tests for the Phase 1 experience upgrade: one live card, instant reactions, the bottom menu, one-tap category chips,
// repeat / favourite buttons, settings, toasts, friendlier dates, the "Open VinExpenses" button - and what happens
// when each of those is unavailable.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./helpers/tg-harness.js');
const { A, B, CHAT_A, CHAT_B, setup, message, photoMessage, callback, deliver, link, seedChoices } = H;

test.afterEach(() => { delete globalThis.Deno; });
const shared = (name) => import(`../supabase/functions/_shared/${name}.ts`);
const bot = () => import('../supabase/functions/telegram-bot/handler.ts');

const linked = async (extraEnv = {}) => {
    const ctx = setup(extraEnv);
    seedChoices(ctx.db, A);
    await link(ctx.db, ctx.tg, 'tok-a', CHAT_A);
    return ctx;
};
const seedExpense = (db, user, over) => db.expenses.push({
    id: crypto.randomUUID(), user_id: user, amount: '5', category: 'food', payment: 'bank', merchant: 'x', created_at: '2026-10-20T04:00:00Z', ...over,
});
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(60).fill(7)]);
const RECEIPT = fs.readFileSync(path.join(__dirname, 'fixtures/grab-food-2-truncated.txt'), 'utf8');

/** Telegram accepts only a few tags; unbalanced or stray ones make it refuse the whole message. */
function assertTelegramHtml(text, where = '') {
    const stack = [];
    for (const m of text.matchAll(/<(\/?)([a-z]+)((?: expandable)?)>/g)) {
        assert.ok(['b', 'i', 'code', 'pre', 'blockquote'].includes(m[2]), `${where}: tag <${m[2]}>`);
        if (m[3]) assert.equal(m[2], 'blockquote', `${where}: "expandable" only belongs on blockquote`);
        if (m[1]) assert.equal(stack.pop(), m[2], `${where}: closing </${m[2]}> does not match`);
        else stack.push(m[2]);
    }
    assert.deepEqual(stack, [], `${where}: unclosed tags`);
    const bare = text.replace(/<\/?[a-z]+(?: expandable)?>/g, '');
    assert.ok(!/[<>]/.test(bare), `${where}: stray < or > in ${JSON.stringify(bare.slice(0, 80))}`);
    assert.ok(!/&(?!(?:amp|lt|gt|quot|#39);)/.test(bare), `${where}: bare & in ${JSON.stringify(bare.slice(0, 80))}`);
    assert.ok(text.length < 4096, `${where}: too long`);
}

// ------------------------------------------------------------------ the real Telegram client
function stubTelegram(plan = []) {
    const calls = [];
    const logged = [];
    const originalError = console.error;
    console.error = (...args) => logged.push(args.join(' '));
    const fetchImpl = async (url, init) => {
        const call = { url: String(url), body: JSON.parse(init.body) };
        calls.push(call);
        const step = plan.shift() ?? { status: 200, body: { ok: true, result: { message_id: 4242 } } };
        return new Response(JSON.stringify(step.body ?? {}), { status: step.status });
    };
    return { calls, logged, fetchImpl, restore: () => { console.error = originalError; } };
}

test('client: every call uses the right method; send returns the new message id; menus and url buttons are shaped correctly', async () => {
    const { telegramClient } = await shared('telegram');
    const t = stubTelegram();
    try {
        const client = telegramClient('123:TOKEN', t.fetchImpl);
        const id = await client.send(5, '<b>hi</b>', { buttons: [[{ text: 'Go', callback_data: 'x' }, { text: 'Open', url: 'https://site.example/a' }]] });
        assert.equal(id, 4242);
        await client.send(5, 'menu', { keyboard: [['A', 'B'], ['C']] });
        await client.edit(5, 9, 'edited');
        await client.answer('cb', 'x'.repeat(500));
        await client.react(5, 9, '👌');
        await client.action(5);
        const [send, menu, edit, answer, react, action] = t.calls;
        assert.equal(send.url, 'https://api.telegram.org/bot123:TOKEN/sendMessage');
        assert.equal(send.body.parse_mode, 'HTML');
        assert.deepEqual(send.body.link_preview_options, { is_disabled: true });
        assert.deepEqual(send.body.reply_markup.inline_keyboard[0][1], { text: 'Open', url: 'https://site.example/a' });
        assert.deepEqual(menu.body.reply_markup, { keyboard: [[{ text: 'A' }, { text: 'B' }], [{ text: 'C' }]], resize_keyboard: true, is_persistent: true });
        assert.match(edit.url, /editMessageText$/);
        assert.equal(edit.body.message_id, 9);
        assert.equal(answer.body.text.length, 180);
        assert.match(react.url, /setMessageReaction$/);
        assert.deepEqual(react.body.reaction, [{ type: 'emoji', emoji: '👌' }]);
        assert.deepEqual(action.body, { chat_id: 5, action: 'typing' });
    } finally { t.restore(); }
});

test('client: if Telegram refuses the formatting the message is re-sent as plain text, never lost', async () => {
    const { telegramClient } = await shared('telegram');
    const refuse = { status: 400, body: { ok: false, description: "Bad Request: can't parse entities: Unsupported start tag \"blockquote\" at byte offset 12" } };
    const t = stubTelegram([refuse]);
    try {
        const client = telegramClient('123:TOKEN', t.fetchImpl);
        const id = await client.send(5, '<b>RM 5.00</b> &amp; <blockquote expandable>notes &lt;3</blockquote>');
        assert.equal(id, 4242, 'the retry succeeded and its id is returned');
        assert.equal(t.calls.length, 2);
        assert.equal(t.calls[1].body.parse_mode, undefined);
        assert.equal(t.calls[1].body.text, 'RM 5.00 & notes <3');
        assert.equal(t.logged.length, 0, 'a recovered problem is not an error');
    } finally { t.restore(); }
    const other = stubTelegram([{ status: 400, body: { ok: false, description: 'Bad Request: chat not found' } }]);
    try {
        const client = telegramClient('123:TOKEN', other.fetchImpl);
        assert.equal(await client.send(5, 'x'), null, 'a different 400 is not retried');
        assert.equal(other.calls.length, 1);
        assert.deepEqual(other.logged, ['telegram sendMessage failed with status 400']);
    } finally { other.restore(); }
});

test('client: "message is not modified" is quiet, failures return null / statuses, and the token never reaches the log', async () => {
    const { telegramClient } = await shared('telegram');
    const t = stubTelegram([
        { status: 400, body: { ok: false, description: 'Bad Request: message is not modified: specified new message content and reply markup are exactly the same' } },
        { status: 403, body: { ok: false, description: 'Forbidden: bot was blocked by the user' } },
        { status: 500, body: {} },
        { status: 200, body: { ok: true, result: { message_id: 1 } } },
    ]);
    try {
        const client = telegramClient('123:TOKEN', t.fetchImpl);
        await client.edit(1, 2, 'same');
        assert.equal(t.logged.length, 0, 'pressing a button that changes nothing is not an error');
        assert.equal(await client.sendChecked(1, 'x'), 'blocked');
        assert.equal(await client.sendChecked(1, 'x'), 'failed');
        assert.equal(await client.sendChecked(1, 'x'), 'ok');
        const broken = telegramClient('123:TOKEN', async () => { throw new Error('boom https://api.telegram.org/bot123:TOKEN/x'); });
        assert.equal(await broken.send(1, 'x'), null);
        await broken.react(1, 2, '👌');
        await broken.action(1);
        assert.ok(t.logged.every((l) => !l.includes('TOKEN')), t.logged.join('|'));
    } finally { t.restore(); }
});

test('client: stripTags makes a readable plain-text version', async () => {
    const { stripTags } = await shared('telegram');
    assert.equal(stripTags('<b>A</b> &amp; <i>B</i> &lt;c&gt; &quot;d&quot; &#39;e&#39;<blockquote expandable>q</blockquote>'), `A & B <c> "d" 'e'q`);
});

// ------------------------------------------------------------------ friendlier dates
test('dayLabel: Today, Yesterday, then the date, in every language and by Kuala Lumpur days', async () => {
    const { dayLabel } = await shared('tg-i18n');
    const now = new Date('2026-11-05T04:00:00Z'); // Thursday 12:00 KL
    assert.equal(dayLabel(new Date('2026-11-05T01:00:00Z'), now, 'en'), 'Today');
    assert.equal(dayLabel(new Date('2026-11-04T16:00:00Z'), now, 'en'), 'Today', '00:00 KL on the 5th');
    assert.equal(dayLabel(new Date('2026-11-04T15:59:00Z'), now, 'en'), 'Yesterday');
    assert.equal(dayLabel(new Date('2026-11-04T04:00:00Z'), now, 'ms'), 'Semalam');
    assert.equal(dayLabel(new Date('2026-11-05T04:00:00Z'), now, 'zh'), '今天');
    assert.match(dayLabel(new Date('2026-10-20T04:00:00Z'), now, 'en'), /20 Oct/);
    assert.match(dayLabel(new Date('2026-10-20T04:00:00Z'), now, 'zh'), /20/);
});

// ------------------------------------------------------------------ category chips
test('chips: current category ticked first, then the ones used most; at most 4; only active ones; indexes match the menu', async () => {
    const { categoryChips } = await bot();
    const cats = [
        { key: 'food', label: 'Food', active: true }, { key: 'shopping', label: 'Shopping', active: true },
        { key: 'old', label: 'Retired', active: false }, { key: 'other', label: 'Other', active: true },
        { key: 'car', label: 'Car', active: true }, { key: 'health', label: 'Health', active: true },
    ];
    const history = [...Array(3).fill({ category: 'car' }), ...Array(2).fill({ category: 'other' }), { category: 'health' }];
    const rows = categoryChips('11111111-1111-4111-8111-111111111111', cats, 'food', history);
    const flat = rows.flat();
    assert.deepEqual(flat.map((b) => b.text), ['✓ 🍜 Food', '🚗 Car', '📦 Other', '💊 Health']);
    assert.deepEqual(rows.map((r) => r.length), [2, 2]);
    assert.deepEqual(flat.map((b) => b.callback_data.split(':')[2]), ['0', '3', '2', '4'], 'index into the ACTIVE list (the Retired one is skipped)');
    const other = categoryChips('11111111-1111-4111-8111-111111111111', cats, 'other', history).flat().map((b) => b.text);
    assert.equal(other[0], '✓ 📦 Other');
    assert.equal(categoryChips('x'.repeat(36), [cats[0]], 'food', []), null, 'one category: nothing to choose from');
    assert.equal(categoryChips('x'.repeat(36), cats.map((c) => ({ ...c, active: false })), 'food', []), null);
    for (const b of flat) assert.ok(b.callback_data.length <= 64, 'Telegram limits button data to 64 bytes');
});

test('card: amount first, details in italics, notes tucked in a collapsible quote, alerts stay visible', async () => {
    const { db, tg } = await linked();
    db.budgets.push({ user_id: A, category: 'food', amount: '100' });
    seedExpense(db, A, { amount: '70', merchant: 'Groceries', created_at: '2026-11-02T04:00:00Z' });
    await deliver(tg, message(CHAT_A, 'lunch 20'));
    const card = tg.last();
    const lines = card.html.replace(/\u00a0/g, ' ').split('\n');
    assert.equal(lines[0], '✅ <b>RM 20.00</b> · 🍜 Food');
    assert.equal(lines[1], '<i>Saved · lunch · 💳 Bank · 📅 Today</i>');
    const quote = card.html.indexOf('<blockquote expandable>');
    assert.ok(quote > 0);
    assert.ok(card.html.indexOf('Heads-up') > 0 && card.html.indexOf('Heads-up') < quote, 'the 90% warning is visible, not hidden');
    assert.ok(card.html.indexOf('▰') > quote, 'the budget bar is inside the quote');
    assert.match(card.html.slice(quote), /Auto: .*lunch.*Food/s);
    assertTelegramHtml(card.html, 'card');
    assert.deepEqual(card.buttons.at(-1).map((b) => b.text), ['➕ More', '↩️ Undo', '✏️ Edit']);
    assert.ok(card.buttons.length >= 2, 'category chips sit above the action row');
    assert.match(card.buttons[0][0].text, /^✓ 🍜 Food$/);
});

test('card: with only one category the classic buttons are used; yesterday and older dates read naturally', async () => {
    const { db, tg } = setup();
    db.user_categories.push({ user_id: A, category_key: 'other', label: 'Other', active: true, sort_order: 1 });
    await link(db, tg, 'tok-a', CHAT_A);
    await deliver(tg, message(CHAT_A, 'yesterday kopi 4'));
    assert.deepEqual(tg.last().buttons.map((r) => r.map((b) => b.text)), [['↩️ Undo', '🏷 Category', '✏️ Edit']]);
    assert.match(tg.last().html, /📅 Yesterday/);
    await deliver(tg, message(CHAT_A, '15 okt servis 80'));
    assert.match(tg.last().html, /📅 15 Oct/);
});

test('chips: one tap moves the expense, a toast confirms, the tick moves, and tapping the same one changes nothing', async () => {
    const { db, tg } = await linked();
    await deliver(tg, message(CHAT_A, 'lunch 12.50'));
    const id = db.expenses[0].id;
    const shopping = tg.last().buttons[0][1];
    assert.match(shopping.text, /Shopping/);
    await deliver(tg, callback(CHAT_A, shopping.callback_data));
    assert.equal(db.expenses[0].category, 'shopping');
    assert.deepEqual(tg.toasts().at(-1), 'Moved to Shopping ✓');
    const edited = tg.lastEdit();
    assert.match(edited.html, /^🏷 <b>RM\s12\.50<\/b> · 🛍️ Shopping/);
    assert.match(edited.html, /Updated/);
    assert.equal(edited.buttons[0][0].text, '✓ 🛍️ Shopping', 'the ticked chip is now first');
    const editsBefore = tg.edited.length;
    await deliver(tg, callback(CHAT_A, edited.buttons[0][0].callback_data));
    assert.equal(tg.toasts().at(-1), 'Already in Shopping');
    assert.equal(tg.edited.length, editsBefore, 'no pointless re-edit');
    await deliver(tg, callback(CHAT_A, `k:${id}:99`));
    assert.equal(db.expenses[0].category, 'shopping', 'a made-up chip index changes nothing');
    await deliver(tg, callback(CHAT_A, `c:${id}`));
    assert.match(tg.lastEdit().html, /Choose a category/);
});

test('chips: category names with "&" show correctly in buttons and toasts (which do not understand HTML)', async () => {
    const { db, tg } = setup();
    db.user_categories.push(
        { user_id: A, category_key: 'food', label: 'Food & Drink', active: true, sort_order: 1 },
        { user_id: A, category_key: 'other', label: 'Other', active: true, sort_order: 2 },
    );
    await link(db, tg, 'tok-a', CHAT_A);
    await deliver(tg, message(CHAT_A, 'zzqx 5'));                          // unknown -> Other
    const foodChip = tg.last().buttons.flat().find((b) => /Food & Drink/.test(b.text));
    assert.ok(foodChip, JSON.stringify(tg.last().buttons));
    assert.ok(!/&amp;/.test(foodChip.text));
    await deliver(tg, callback(CHAT_A, foodChip.callback_data));
    assert.equal(tg.toasts().at(-1), 'Moved to Food & Drink ✓');
    assert.match(tg.lastEdit().html, /Food &amp; Drink/, 'inside the message it is escaped');
    assertTelegramHtml(tg.lastEdit().html, 'edited card');
});

// ------------------------------------------------------------------ reactions, typing, toasts
test('reaction: the person\'s own message gets an instant 👌 once the expense is really saved', async () => {
    const { db, tg } = await linked();
    await deliver(tg, message(CHAT_A, 'lunch 5'));
    assert.deepEqual(tg.reactions, [{ chatId: CHAT_A, messageId: 7, emoji: '👌' }]);
    await deliver(tg, message(CHAT_A, '+100 bonus'));
    assert.equal(tg.reactions.length, 2);
    await deliver(tg, message(CHAT_A, 'hello there'));
    await deliver(tg, message(CHAT_A, '6/11 lunch 5'));
    assert.equal(tg.reactions.length, 2, 'no reaction when nothing was saved');
    db.failures.add('expenses');
    await deliver(tg, message(CHAT_A, 'lunch 6'));
    assert.equal(tg.reactions.length, 2, 'and none when saving failed');
});

test('fallbacks: reactions, typing indicators and chips failing never stop the expense or its card', async () => {
    const { db, tg } = await linked();
    tg.throwOn.add('react');
    tg.throwOn.add('action');
    await deliver(tg, message(CHAT_A, 'lunch 5'));
    assert.equal(db.expenses.length, 1);
    assert.match(tg.last().html, /Saved/);
    await deliver(tg, message(CHAT_A, '/month'));
    assert.match(tg.last().html, /November 2026/);
    db.failures.add('user_payment_methods');
    db.failures.add('user_categories');
    await deliver(tg, message(CHAT_A, 'kopi 4'));
    assert.equal(db.expenses.length, 2, 'built-in categories are used when the lists cannot be read');
});

test('toasts: undo, delete, income undo and receipt save each confirm with a pop-up; every press is acknowledged', async () => {
    const { db, tg, hooks } = await linked({ OCR_SPACE_API_KEY: 'k' });
    await deliver(tg, message(CHAT_A, 'lunch 5'));
    const id = db.expenses[0].id;
    await deliver(tg, callback(CHAT_A, `u:${id}`));
    assert.equal(tg.toasts().at(-1), 'Undone ✓');
    await deliver(tg, message(CHAT_A, 'lunch 6'));
    const second = db.expenses[0].id;
    await deliver(tg, callback(CHAT_A, `d:${second}`));
    await deliver(tg, callback(CHAT_A, `y:${second}`));
    assert.equal(tg.toasts().at(-1), 'Deleted ✓');
    await deliver(tg, message(CHAT_A, '+50'));
    await deliver(tg, callback(CHAT_A, `i:${db.incomes[0].id}`));
    assert.equal(tg.toasts().at(-1), 'Undone ✓');
    hooks.ocr = async () => new Response(JSON.stringify({ ParsedResults: [{ ParsedText: RECEIPT }] }), { status: 200 });
    tg.file = { bytes: JPEG };
    await deliver(tg, photoMessage(CHAT_A));
    await deliver(tg, callback(CHAT_A, 'r:s'));
    assert.equal(tg.toasts().at(-1), 'Saved ✓');
    const pressed = tg.answered.length;
    await deliver(tg, callback(CHAT_A, 'garbage'));
    await deliver(tg, callback(CHAT_B, `u:${id}`));
    assert.equal(tg.answered.length, pressed + 2, 'even junk and strangers get the button acknowledged (no endless spinner)');
});

// ------------------------------------------------------------------ the bottom menu
test('menu: the five buttons arrive as text and run the matching action - in any language', async () => {
    const { tg } = await linked();
    await deliver(tg, message(CHAT_A, '📊 Today'));
    assert.match(tg.last().html, /Today<\/b>/);
    await deliver(tg, message(CHAT_A, '🗓 Month'));
    assert.match(tg.last().html, /November 2026/);
    await deliver(tg, message(CHAT_A, '🧾 Recent'));
    assert.match(tg.last().html, /Nothing recorded yet/);
    await deliver(tg, message(CHAT_A, '⚙️ Settings'));
    assert.match(tg.last().html, /Settings/);
    await deliver(tg, message(CHAT_A, '➕ Add'));
    assert.match(tg.last().html, /What did you spend/);
    await deliver(tg, message(CHAT_A, '📊 Hari ini'));
    assert.match(tg.last().html, /Today<\/b>/, 'the Malay label works even while the chat language is English (and the answer follows the chat language)');
    await deliver(tg, message(CHAT_A, '🗓 本月'));
    assert.match(tg.last().html, /November 2026/);
    await deliver(tg, message(CHAT_A, '/add'));
    assert.match(tg.last().html, /What did you spend/);
    await deliver(tg, message(CHAT_A, '/settings'));
    assert.match(tg.last().html, /Settings/);
});

test('menu: shown on welcome, /menu and /help for connected people - not for strangers - and it follows a language change', async () => {
    const { db, tg } = setup();
    seedChoices(db, A);
    await deliver(tg, message(CHAT_A, '/help'));
    assert.equal(tg.last().keyboard, undefined, 'an unconnected chat has no use for the menu');
    await deliver(tg, message(CHAT_A, '📊 Today'));
    assert.match(tg.last().html, /isn't connected/, 'the menu buttons do nothing for strangers');
    await link(db, tg, 'tok-a', CHAT_A);
    assert.deepEqual(tg.last().keyboard, [['➕ Add', '📊 Today'], ['🗓 Month', '🧾 Recent'], ['⚙️ Settings']]);
    assert.match(tg.last().html, /You're connected/);
    await deliver(tg, message(CHAT_A, '/menu'));
    assert.ok(tg.last().keyboard);
    await deliver(tg, message(CHAT_A, '/help'));
    assert.ok(tg.last().keyboard);
    await deliver(tg, message(CHAT_A, '/start'));
    assert.ok(tg.last().keyboard);
    await deliver(tg, callback(CHAT_A, 'l:ms'));
    assert.deepEqual(tg.lastSent().keyboard[0], ['➕ Tambah', '📊 Hari ini'], 'the old English buttons are replaced');
    assert.match(tg.lastSent().html, /Guna menu/);
    await deliver(tg, callback(CHAT_A, 'l:zh'));
    assert.deepEqual(tg.lastSent().keyboard[2], ['⚙️ 设置']);
});

// ------------------------------------------------------------------ Add prompt, repeat and favourites
test('add: with no history it is just a friendly prompt; with history it offers Repeat last and your usual ones', async () => {
    const { db, tg } = await linked();
    await deliver(tg, message(CHAT_A, '➕ Add'));
    assert.match(tg.last().html, /What did you spend/);
    assert.equal(tg.last().buttons, undefined);
    assert.ok(!/usual/.test(tg.last().html));
    for (let i = 0; i < 3; i++) seedExpense(db, A, { amount: '12', merchant: 'Lunch', created_at: `2026-10-0${i + 1}T04:00:00Z` });
    for (let i = 0; i < 2; i++) seedExpense(db, A, { amount: '4', merchant: 'Kopi', category: 'food', created_at: `2026-10-1${i}T04:00:00Z` });
    seedExpense(db, A, { amount: '8', merchant: 'Grab', category: 'shopping', created_at: '2026-11-04T04:00:00Z' });
    seedExpense(db, B, { amount: '99', merchant: 'Bobs thing', created_at: '2026-11-05T01:00:00Z' });
    await deliver(tg, message(CHAT_A, '➕ Add'));
    const rows = tg.last().buttons;
    assert.match(rows[0][0].text, /^🔁 Repeat last: .*Grab.*RM\s?8\.00/);
    assert.deepEqual(rows[1].map((b) => b.text.replace(/\s+/g, ' ')).map((t) => /Lunch/.test(t) ? 'lunch' : /Kopi/.test(t) ? 'kopi' : t), ['lunch', 'kopi'], 'most-used first');
    assert.match(tg.last().html, /usual/);
    assert.ok(!JSON.stringify(rows).includes('Bobs'), "never another person's expenses");
    assertTelegramHtml(tg.last().html, 'add prompt');
});

test('add: tapping a button saves a fresh copy as a new message; it can not copy someone else\'s expense; limits apply', async () => {
    const { db, tg } = await linked();
    const template = { id: 'aaaaaaaa-1111-4111-8111-000000000001', user_id: A, amount: '12', category: 'food', payment: 'ewallet', merchant: 'Lunch', created_at: '2026-10-01T04:00:00Z' };
    db.expenses.push(template);
    const bobs = { id: 'bbbbbbbb-1111-4111-8111-000000000002', user_id: B, amount: '99', category: 'food', payment: 'bank', merchant: 'Secret', created_at: '2026-10-01T04:00:00Z' };
    db.expenses.push(bobs);
    const sentBefore = tg.sent.length;
    await deliver(tg, callback(CHAT_A, `f:${template.id}`));
    const copy = db.expenses.at(-1);
    assert.deepEqual([copy.user_id, copy.amount, copy.merchant, copy.category, copy.payment, copy.note], [A, 12, 'Lunch', 'food', 'ewallet', 'via Telegram (repeat)']);
    assert.notEqual(copy.id, template.id);
    assert.ok(tg.sent.length > sentBefore, 'the new card is a new message; the prompt stays as it is');
    assert.match(tg.lastSent().html, /^🔁 <b>RM\s12\.00<\/b>/);
    assert.match(tg.lastSent().html, /Saved again/);
    assert.equal(tg.toasts().at(-1), 'Saved ✓');
    const count = db.expenses.length;
    await deliver(tg, callback(CHAT_A, `f:${bobs.id}`));
    assert.equal(db.expenses.length, count, "Alice can not repeat Bob's expense");
    assert.match(tg.lastEdit().html, /no longer exists/);
    db.counters.set(`tg-add:${CHAT_A}`, 100);
    await deliver(tg, callback(CHAT_A, `f:${template.id}`));
    assert.equal(db.expenses.length, count, 'the daily limit applies to repeats too');
    assert.match(tg.toasts().at(-1), /Daily limit/);
});

test('add: if the history can not be read the prompt still appears, just without buttons', async () => {
    const { db, tg, hooks } = await linked();
    seedExpense(db, A, {});
    hooks.breakWhen.push((method, url) => method === 'GET' && url.pathname.endsWith('/expenses'));
    await deliver(tg, message(CHAT_A, '➕ Add'));
    assert.match(tg.last().html, /What did you spend/);
    assert.equal(tg.last().buttons, undefined);
});

// ------------------------------------------------------------------ settings
test('settings: language, weekly summary and disconnect from one screen', async () => {
    const { db, tg } = await linked();
    await deliver(tg, message(CHAT_A, '⚙️ Settings'));
    const screen = tg.last();
    assert.match(screen.html, /Language: <b>English<\/b>/);
    assert.match(screen.html, /Weekly summary: <b>off<\/b>/);
    assert.deepEqual(screen.buttons.map((r) => r[0].callback_data), ['s:lang', 's:dg', 's:ul']);
    assertTelegramHtml(screen.html, 'settings');
    await deliver(tg, callback(CHAT_A, 's:dg'));
    assert.equal(db.telegram_links[0].digest_on, true);
    assert.match(tg.lastEdit().html, /Weekly summary: <b>on<\/b>/);
    assert.match(tg.lastEdit().buttons[1][0].text, /Turn off/);
    await deliver(tg, callback(CHAT_A, 's:dg'));
    assert.equal(db.telegram_links[0].digest_on, false);
    await deliver(tg, callback(CHAT_A, 's:lang'));
    assert.deepEqual(tg.lastEdit().buttons[0].map((b) => b.callback_data), ['l:en', 'l:ms', 'l:zh']);
    await deliver(tg, callback(CHAT_A, 's:ul'));
    assert.match(tg.lastEdit().html, /Disconnect this chat/);
    assert.ok(db.telegram_links.length === 1, 'asking is not disconnecting');
    await deliver(tg, callback(CHAT_A, 's:back'));
    assert.match(tg.lastEdit().html, /Settings/);
    await deliver(tg, callback(CHAT_A, 's:ul'));
    await deliver(tg, callback(CHAT_A, 's:uy'));
    assert.equal(db.telegram_links.length, 0);
    assert.match(tg.lastEdit().html, /Disconnected/);
    await deliver(tg, message(CHAT_A, 'lunch 5'));
    assert.match(tg.last().html, /isn't connected/);
});

test('settings: an unavailable weekly-summary column gives a polite pop-up and changes nothing', async () => {
    const { db, tg, hooks } = await linked();
    hooks.breakWhen.push((method, url, init) => method === 'PATCH' && String(init.body).includes('digest_on'));
    await deliver(tg, message(CHAT_A, '/settings'));
    await deliver(tg, callback(CHAT_A, 's:dg'));
    assert.equal(tg.toasts().at(-1), 'Not available yet');
    assert.equal(db.telegram_links[0].digest_on, undefined);
});

test('settings: junk and stranger presses are ignored', async () => {
    const { db, tg } = await linked();
    const before = JSON.stringify(db.telegram_links);
    for (const data of ['s:', 's:drop', 's:uy;x', 'S:uy', 's:uy ']) await deliver(tg, callback(CHAT_A, data));
    await deliver(tg, callback(CHAT_B, 's:uy'));
    assert.equal(JSON.stringify(db.telegram_links), before);
});

test('open button: "Open VinExpenses" appears on reports and settings only when SITE_URL is a clean https address', async () => {
    const withSite = await linked({ SITE_URL: 'https://me.github.io/VinExpenses/' });
    await deliver(withSite.tg, message(CHAT_A, '/month'));
    const openButtons = (m) => (m.buttons ?? []).flat().filter((b) => b.url);
    assert.deepEqual(openButtons(withSite.tg.last()), [{ text: '🔗 Open VinExpenses', url: 'https://me.github.io/VinExpenses' }]);
    await deliver(withSite.tg, message(CHAT_A, '/today'));
    assert.equal(openButtons(withSite.tg.last()).length, 1);
    await deliver(withSite.tg, message(CHAT_A, '/top'));
    assert.equal(openButtons(withSite.tg.last()).length, 1);
    await deliver(withSite.tg, message(CHAT_A, '/settings'));
    assert.ok(withSite.tg.last().buttons.flat().some((b) => b.url));
    delete globalThis.Deno;

    for (const bad of [undefined, 'http://me.github.io', 'javascript:alert(1)', 'https://user:pw@evil.example', 'not a url']) {
        const ctx = await linked({ SITE_URL: bad });
        await deliver(ctx.tg, message(CHAT_A, '/month'));
        assert.equal((ctx.tg.last().buttons ?? []).flat().filter((b) => b.url).length, 0, `SITE_URL=${bad}`);
        await deliver(ctx.tg, message(CHAT_A, '/settings'));
        assert.ok(!ctx.tg.last().buttons.flat().some((b) => b.url), `settings, SITE_URL=${bad}`);
        delete globalThis.Deno;
    }
});

// ------------------------------------------------------------------ one live message for receipts
test('live card: when "Reading…" has an id the result replaces it; if Telegram gave no id the result is simply sent', async () => {
    const live = await linked({ OCR_SPACE_API_KEY: 'k' });
    live.hooks.ocr = async () => new Response(JSON.stringify({ ParsedResults: [{ ParsedText: 'KEDAI ALI\nthank you' }] }), { status: 200 });
    live.tg.file = { bytes: JPEG };
    await deliver(live.tg, photoMessage(CHAT_A));
    const reading = live.tg.lastSent();
    assert.match(reading.html, /Reading/);
    assert.equal(live.tg.lastEdit().messageId, reading.id);
    assert.match(live.tg.lastEdit().html, /couldn't find a reliable total/, 'even the explanation replaces "Reading…"');
    assert.deepEqual(live.tg.actions, [CHAT_A], 'a typing indicator while it works');
    live.tg.file = { error: 'too_large' };
    await deliver(live.tg, photoMessage(CHAT_A));
    assert.match(live.tg.lastEdit().html, /too large/);
    delete globalThis.Deno;

    const blind = await linked({ OCR_SPACE_API_KEY: 'k' });
    blind.tg.noIds = true;
    blind.hooks.ocr = async () => new Response(JSON.stringify({ ParsedResults: [{ ParsedText: RECEIPT }] }), { status: 200 });
    blind.tg.file = { bytes: JPEG };
    await deliver(blind.tg, photoMessage(CHAT_A));
    assert.match(blind.tg.lastSent().html, /Receipt found/);
    assert.equal(blind.tg.edited.length, 0, 'no edit of a message we have no id for');
    await deliver(blind.tg, callback(CHAT_A, 'r:s'));
    assert.equal(blind.db.expenses.length, 1);
});

// ------------------------------------------------------------------ every message Telegram will see is valid
test('every message the bot produces is valid Telegram HTML, in all three languages', async () => {
    const { db, tg } = await linked({ SITE_URL: 'https://me.github.io/VinExpenses', OCR_SPACE_API_KEY: 'k' });
    db.budgets.push({ user_id: A, category: 'food', amount: '30' }, { user_id: A, category: 'all', amount: '60' });
    db.user_categories.push({ user_id: A, category_key: 'pets', label: '<b>Pets</b> & "co" \'x\'', active: true, sort_order: 9 });
    for (const lang of ['en', 'ms', 'zh']) {
        await deliver(tg, callback(CHAT_A, `l:${lang}`));
        for (const text of ['lunch 20 & <i>friends</i>', 'dinner 25', '+500 <b>bonus</b>', 'yesterday kopi 4', '/today', '/month', '/top', '/recent', '/help', '/settings', '/digest', '➕ Add', '/language', 'hello', '99999999 x']) {
            await deliver(tg, message(CHAT_A, text));
        }
        await deliver(tg, callback(CHAT_A, `c:${db.expenses.at(-1).id}`));
        await deliver(tg, callback(CHAT_A, `v:${db.expenses.at(-1).id}`));
        await deliver(tg, callback(CHAT_A, `d:${db.expenses.at(-1).id}`));
    }
    const all = [...tg.sent, ...tg.edited];
    assert.ok(all.length > 60);
    for (const m of all) assertTelegramHtml(m.html, m.html.slice(0, 40));
    for (const m of all) for (const b of (m.buttons ?? []).flat()) {
        assert.ok(!/&(amp|lt|gt|quot|#39);/.test(b.text), `button text is not HTML, so it must not contain entities: ${b.text}`);
        assert.ok(b.text.length > 0 && b.text.length <= 64, `button length: ${b.text}`);
        if (b.callback_data !== undefined) assert.ok(Buffer.byteLength(b.callback_data) <= 64, `callback data too long: ${b.callback_data}`);
    }
});

// ------------------------------------------------------------------ the "/" command menu
test('command menu: three languages, same commands, valid for Telegram', () => {
    const { COMMANDS } = require('../tools/telegram-commands.js');
    assert.deepEqual(Object.keys(COMMANDS).sort(), ['default', 'ms', 'zh']);
    const names = (list) => list.map(([c]) => c);
    assert.deepEqual(names(COMMANDS.ms), names(COMMANDS.default));
    assert.deepEqual(names(COMMANDS.zh), names(COMMANDS.default));
    for (const list of Object.values(COMMANDS)) {
        assert.ok(list.length <= 100);
        for (const [command, description] of list) {
            assert.match(command, /^[a-z0-9_]{1,32}$/);
            assert.ok([...description].length >= 3 && [...description].length <= 256, description);
        }
    }
    const source = fs.readFileSync(path.join(__dirname, '../tools/set-telegram-webhook.js'), 'utf8');
    assert.match(source, /language_code/);
    assert.match(source, /Object\.entries\(COMMANDS\)/);
});
