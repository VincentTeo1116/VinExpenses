'use strict';
// Tests for the Telegram bot: message parsing, account linking, adding / undoing / re-categorising expenses,
// summaries, and (most importantly) that one person can never touch another person's data.
// Telegram itself is replaced by a recorder; Supabase by the in-memory stand-in from helpers/fakes.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fakeSupabase } = require('./helpers/fakes.js');

const SECRET = 'telegram-webhook-secret-0123456789';
const ENV = {
    SUPABASE_URL: 'https://abcdefghij.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-key',
    ALLOWED_ORIGINS: 'https://me.github.io',
    TELEGRAM_BOT_TOKEN: '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij',
    TELEGRAM_WEBHOOK_SECRET: SECRET,
    TELEGRAM_BOT_USERNAME: 'VinExpenses_bot',
};
const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';
const NOW = new Date('2026-11-05T04:00:00Z'); // 12:00 on 5 Nov in Kuala Lumpur
const CHAT_A = 1001;
const CHAT_B = 2002;
const botModule = () => import('../supabase/functions/telegram-bot/handler.ts');
const linkModule = () => import('../supabase/functions/telegram-link/handler.ts');
const shared = (name) => import(`../supabase/functions/_shared/${name}.ts`);

function setup(extraEnv = {}) {
    const env = { ...ENV, ...extraEnv };
    for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
    globalThis.Deno = { env: { get: (name) => env[name] } };
    const db = fakeSupabase();
    db.now = () => NOW.toISOString();
    db.addUser('tok-a', A, 'a@gmail.com');
    db.addUser('tok-b', B, 'b@gmail.com');
    globalThis.fetch = db.fetch;
    const tg = { sent: [], edited: [], answered: [] };
    tg.client = {
        send: async (chatId, html, options) => { tg.sent.push({ chatId, html, buttons: options?.buttons }); },
        edit: async (chatId, messageId, html, options) => { tg.edited.push({ chatId, messageId, html, buttons: options?.buttons }); },
        sendChecked: async (chatId, html) => { tg.sent.push({ chatId, html }); return tg.checkedResult || 'ok'; },
        fileBytes: async () => (tg.file ? tg.file : { error: 'failed' }),
        answer: async (id) => { tg.answered.push(id); },
    };
    tg.last = () => tg.sent[tg.sent.length - 1];
    return { db, tg };
}
test.afterEach(() => { delete globalThis.Deno; });

let updateCounter = 100;
const message = (chatId, text, extra = {}) => ({ update_id: ++updateCounter, message: { message_id: 7, chat: { id: chatId, type: 'private' }, text, ...extra } });
const callback = (chatId, data, messageId = 55) => ({ update_id: ++updateCounter, callback_query: { id: `cb${updateCounter}`, data, message: { message_id: messageId, chat: { id: chatId, type: 'private' } } } });

async function deliver(tg, update, { secret = SECRET, now = NOW, method = 'POST', raw } = {}) {
    const { handle } = await botModule();
    return handle(new Request('https://abcdefghij.supabase.co/functions/v1/telegram-bot', {
        method,
        headers: { 'content-type': 'application/json', ...(secret === null ? {} : { 'x-telegram-bot-api-secret-token': secret }) },
        body: method === 'POST' ? (raw ?? JSON.stringify(update)) : undefined,
    }), now, tg.client);
}

/** Links a chat to an account the real way: the app creates a code, the chat sends it. */
async function link(db, tg, token, chatId) {
    const { handle } = await linkModule();
    const res = await handle(new Request('https://x/functions/v1/telegram-link', {
        method: 'POST', headers: { authorization: `Bearer ${token}`, origin: 'https://me.github.io', 'content-type': 'application/json' }, body: '{"action":"create"}',
    }));
    const { code } = await res.json();
    await deliver(tg, message(chatId, `/start ${code}`));
    return code;
}

const seedChoices = (db, userId) => {
    db.user_categories.push(
        { user_id: userId, category_key: 'food', label: 'Food', active: true, sort_order: 1 },
        { user_id: userId, category_key: 'shopping', label: 'Shopping', active: true, sort_order: 2 },
        { user_id: userId, category_key: 'other', label: 'Other', active: true, sort_order: 3 },
        { user_id: userId, category_key: 'old', label: 'Retired', active: false, sort_order: 4 },
    );
    db.user_payment_methods.push(
        { user_id: userId, payment_key: 'bank', label: 'Bank', active: true, sort_order: 1 },
        { user_id: userId, payment_key: 'ewallet', label: 'E-Wallet', active: true, sort_order: 2 },
        { user_id: userId, payment_key: 'card', label: 'Card', active: true, sort_order: 3 },
    );
};

// ------------------------------------------------------------------ parsing
test('parseExpense: finds the amount and the description in everyday messages', async () => {
    const { parseExpense } = await shared('telegram');
    const cases = [
        ['lunch 12.50', { amount: 12.5, description: 'lunch', paymentWord: null }],
        ['grab rm8.90 ewallet', { amount: 8.9, description: 'grab', paymentWord: 'ewallet' }],
        ['7-eleven 5.50 card', { amount: 5.5, description: '7-eleven', paymentWord: 'card' }],
        ['RM 12 petrol', null],                       // "RM" and "12" separated: 12 is still the only plain number
        ['petrol 50', { amount: 50, description: 'petrol', paymentWord: null }],
        ['99 speedmart 23,40', { amount: 23.4, description: '99 speedmart', paymentWord: null }],
        ['rm1,200', null],
        ['coffee MYR4.5', { amount: 4.5, description: 'coffee', paymentWord: null }],
        ['  nasi   lemak   6  ', { amount: 6, description: 'nasi lemak', paymentWord: null }],
    ];
    for (const [text, expected] of cases) {
        const got = parseExpense(text, ['ewallet', 'card', 'bank']);
        if (text === 'RM 12 petrol') assert.deepEqual(got, { amount: 12, description: 'RM petrol', paymentWord: null });
        else if (text === 'rm1,200') assert.equal(got?.amount, 1200, 'thousands separator');
        else assert.deepEqual(got, expected, text);
    }
    for (const bad of ['', 'hello', 'no numbers here', '0', '0.00', 'x 1000000.01', 'x 99999999', '1e5', '-5 lunch', '12.345']) {
        const got = parseExpense(bad, []);
        assert.ok(got === null || (got.amount > 0 && got.amount <= 1_000_000), `${bad} -> ${JSON.stringify(got)}`);
    }
    assert.equal(parseExpense('lunch 0', []), null);
    assert.equal(parseExpense('rent 1,234.50', [])?.amount, 1234.5);
    assert.equal(parseExpense('tea 12,50', [])?.amount, 12.5, 'decimal comma');
    assert.equal(parseExpense('x 1,2345', []), null);
    assert.equal(parseExpense('x 1000000.01', []), null);
    assert.equal(parseExpense('x 1000000', [])?.amount, 1_000_000);
    const long = parseExpense('a'.repeat(600) + ' 5', []);
    assert.ok(long === null || long.description.length <= 80);
    const control = parseExpense('lunch\u0000‮ 5\r\nINJECT', []);
    assert.ok(!/[\u0000‮\r\n]/.test(control.description));
});

test('klWindow: day and month boundaries follow Kuala Lumpur time', async () => {
    const { klWindow } = await shared('telegram');
    const day = klWindow('day', new Date('2026-11-05T04:00:00Z'));
    assert.equal(day.start, '2026-11-04T16:00:00.000Z');
    assert.equal(day.end, '2026-11-05T16:00:00.000Z');
    const lateNight = klWindow('day', new Date('2026-11-05T17:00:00Z')); // already 6 Nov in KL
    assert.equal(lateNight.start, '2026-11-05T16:00:00.000Z');
    const month = klWindow('month', new Date('2026-11-30T20:00:00Z')); // 1 Dec 04:00 in KL
    assert.equal(month.start, '2026-11-30T16:00:00.000Z');
    assert.equal(month.end, '2026-12-31T16:00:00.000Z');
    assert.match(month.label, /December 2026/);
});

test('newLinkCode: 10 unambiguous characters, different every time', async () => {
    const { newLinkCode, CODE_PATTERN } = await shared('telegram');
    const seen = new Set();
    for (let i = 0; i < 500; i++) { const c = newLinkCode(); assert.match(c, CODE_PATTERN); seen.add(c); }
    assert.equal(seen.size, 500);
});

test('the app copies of the category-guessing and receipt-reading code are identical to the ones the bot uses', () => {
    const root = path.join(__dirname, '..');
    for (const file of ['smart-entry.js', 'receipt-parser.js']) {
        const app = fs.readFileSync(path.join(root, file));
        const bot = fs.readFileSync(path.join(root, 'supabase/functions/_shared', file));
        assert.ok(app.equals(bot), `${file} differs from the bot's copy. Run: node tools/sync-shared.js`);
    }
});

// ------------------------------------------------------------------ telegram-link (the website side)
const callLink = async (token, action, { origin = 'https://me.github.io' } = {}) => {
    const { handle } = await linkModule();
    return handle(new Request('https://x/functions/v1/telegram-link', {
        method: 'POST', headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(origin ? { origin } : {}), 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
    }));
};

test('telegram-link: signed-in users only, from the allowed website', async () => {
    const { db } = setup();
    assert.equal((await callLink(null, 'status')).status, 401);
    assert.equal((await callLink('tok-a', 'status', { origin: 'https://evil.example' })).status, 403);
    assert.equal((await callLink('tok-a', 'launch-missiles')).status, 400);
    assert.equal(db.telegram_link_codes.length, 0);
});

test('telegram-link: creates a one-time code, stores only its hash, and a new code replaces the old one', async () => {
    const { db } = setup();
    const first = await (await callLink('tok-a', 'create')).json();
    assert.match(first.code, /^[A-Z2-9]{10}$/);
    assert.equal(first.link, `https://t.me/VinExpenses_bot?start=${first.code}`);
    assert.equal(first.expiresInSeconds, 600);
    assert.equal(db.telegram_link_codes.length, 1);
    const stored = db.telegram_link_codes[0];
    assert.ok(!JSON.stringify(db.telegram_link_codes).includes(first.code), 'the code itself is never stored');
    assert.match(stored.code_hash, /^[0-9a-f]{64}$/);
    assert.equal(stored.user_id, A);
    const ttl = new Date(stored.expires_at).getTime() - Date.now();
    assert.ok(ttl > 590_000 && ttl <= 600_500, `ttl ${ttl}`);
    await callLink('tok-a', 'create');
    assert.equal(db.telegram_link_codes.filter((r) => r.user_id === A).length, 1, 'only one live code per account');
    await callLink('tok-b', 'create');
    assert.equal(db.telegram_link_codes.length, 2, "another user's code is untouched");
});

test('telegram-link: limits codes per day and reports a missing setup clearly', async () => {
    setup();
    for (let i = 0; i < 10; i++) assert.equal((await callLink('tok-a', 'create')).status, 200);
    assert.equal((await callLink('tok-a', 'create')).status, 429);
    setup({ TELEGRAM_BOT_USERNAME: undefined });
    assert.equal((await callLink('tok-a', 'create')).status, 503);
    setup({ TELEGRAM_BOT_USERNAME: 'bad name!' });
    assert.equal((await callLink('tok-a', 'create')).status, 503);
});

test('telegram-link: status and unlink only ever touch the caller\'s own connection', async () => {
    const { db, tg } = setup();
    await link(db, tg, 'tok-a', CHAT_A);
    await link(db, tg, 'tok-b', CHAT_B);
    assert.equal((await (await callLink('tok-a', 'status')).json()).linked, true);
    assert.equal((await (await callLink('tok-a', 'unlink')).json()).linked, false);
    assert.deepEqual(db.telegram_links.map((l) => l.user_id), [B]);
    assert.equal((await (await callLink('tok-a', 'status')).json()).linked, false);
    assert.equal((await (await callLink('tok-b', 'status')).json()).linked, true);
});

// ------------------------------------------------------------------ the webhook door
test('webhook: wrong or missing secret is refused before anything is read', async () => {
    const { db, tg } = setup();
    for (const secret of [null, '', 'nope', SECRET + 'x', SECRET.slice(1)]) {
        assert.equal((await deliver(tg, message(CHAT_A, '/help'), { secret })).status, 401, String(secret));
    }
    assert.equal((await deliver(tg, null, { method: 'GET' })).status, 405);
    assert.equal(tg.sent.length, 0);
    assert.equal(db.requests.length, 0, 'the database was never touched');
});

test('webhook: refuses to run with a short secret or no token (never "open")', async () => {
    const { tg } = setup({ TELEGRAM_WEBHOOK_SECRET: 'short' });
    assert.equal((await deliver(tg, message(CHAT_A, '/help'), { secret: 'short' })).status, 503);
    const again = setup({ TELEGRAM_BOT_TOKEN: undefined });
    assert.equal((await deliver(again.tg, message(CHAT_A, '/help'))).status, 503);
});

test('webhook: junk, oversized and group messages are answered 200 and ignored', async () => {
    const { db, tg } = setup();
    assert.equal((await deliver(tg, null, { raw: '{not json' })).status, 200);
    assert.equal((await deliver(tg, null, { raw: JSON.stringify({ update_id: 'x' }) })).status, 200);
    assert.equal((await deliver(tg, null, { raw: JSON.stringify({ update_id: 5, message: { text: 'x'.repeat(40000) } }) })).status, 200);
    const group = message(-100123, 'lunch 5');
    group.message.chat.type = 'supergroup';
    assert.equal((await deliver(tg, group)).status, 200);
    assert.equal(tg.sent.length, 0);
    assert.equal(db.expenses.length, 0);
});

test('webhook: Telegram re-delivering the same update does not repeat the action', async () => {
    const { db, tg } = setup();
    seedChoices(db, A);
    await link(db, tg, 'tok-a', CHAT_A);
    const update = message(CHAT_A, 'lunch 12.50');
    await deliver(tg, update);
    await deliver(tg, update);
    await deliver(tg, update);
    assert.equal(db.expenses.length, 1);
});

// ------------------------------------------------------------------ linking from the chat
test('link: a valid code connects the chat once; the same code never works twice', async () => {
    const { db, tg } = setup();
    const { handle } = await linkModule();
    const make = async () => (await (await handle(new Request('https://x', { method: 'POST', headers: { authorization: 'Bearer tok-a', origin: 'https://me.github.io' }, body: '{"action":"create"}' }))).json()).code;
    const code = await make();
    await deliver(tg, message(CHAT_A, `/start ${code}`));
    assert.match(tg.last().html, /connected/i);
    assert.deepEqual(db.telegram_links.map((l) => [l.chat_id, l.user_id]), [[CHAT_A, A]]);
    assert.equal(db.telegram_link_codes.length, 0, 'code consumed');
    await deliver(tg, message(CHAT_B, `/start ${code}`));
    assert.match(tg.last().html, /invalid or has expired/);
    assert.equal(db.telegram_links.length, 1);
    await deliver(tg, message(CHAT_B, `/link ${(await make()).toLowerCase()}`));
    assert.match(tg.last().html, /connected/i, 'codes are accepted in lower case and with /link');
});

test('link: expired, malformed and guessed codes fail; guessing is rate-limited', async () => {
    const { db, tg } = setup();
    const { newLinkCode } = await shared('telegram');
    const { sha256Hex } = await shared('guard');
    const code = newLinkCode();
    db.telegram_link_codes.push({ code_hash: await sha256Hex(`${SECRET}:${code}`), user_id: A, expires_at: new Date(Date.now() - 1000).toISOString() });
    await deliver(tg, message(CHAT_A, `/start ${code}`));
    assert.match(tg.last().html, /invalid or has expired/);
    await deliver(tg, message(CHAT_A, '/start SHORT'));
    assert.match(tg.last().html, /doesn't look right/);
    await deliver(tg, message(CHAT_A, '/start ' + 'A'.repeat(10)));
    assert.match(tg.last().html, /invalid or has expired/);
    for (let i = 0; i < 8; i++) await deliver(tg, message(CHAT_A, '/start ' + newLinkCode()));
    await deliver(tg, message(CHAT_A, '/start ' + newLinkCode()));
    assert.match(tg.last().html, /Too many attempts/);
    assert.equal(db.telegram_links.length, 0);
});

test('link: a chat already tied to one account can not be taken over by another; relinking an account moves it', async () => {
    const { db, tg } = setup();
    await link(db, tg, 'tok-a', CHAT_A);
    await link(db, tg, 'tok-b', CHAT_A);                       // B's code sent from A's chat
    assert.match(tg.last().html, /already connected to another/);
    assert.deepEqual(db.telegram_links.map((l) => l.user_id), [A]);
    await link(db, tg, 'tok-a', CHAT_B);                       // A moves to a new Telegram account
    assert.deepEqual(db.telegram_links.map((l) => [l.chat_id, l.user_id]), [[CHAT_B, A]], 'one chat per account');
    await deliver(tg, message(CHAT_A, '/today'));
    assert.match(tg.last().html, /isn't connected/, 'the old chat lost access');
});

test('an unconnected chat can do nothing but ask for help', async () => {
    const { db, tg } = setup();
    for (const text of ['lunch 5', '/today', '/month', '/undo', '/unlink']) {
        await deliver(tg, message(CHAT_A, text));
        assert.match(tg.last().html, /isn't connected/, text);
    }
    await deliver(tg, message(CHAT_A, '/start'));
    assert.match(tg.last().html, /Connect Telegram/);
    await deliver(tg, message(CHAT_A, '/help'));
    assert.match(tg.last().html, /Add an expense/);
    assert.equal(db.expenses.length, 0);
});

// ------------------------------------------------------------------ adding expenses
test('expense: typing "kedai ali 4.50" saves for the linked user, learns the category from history', async () => {
    const { db, tg } = setup();
    seedChoices(db, A);
    db.expenses.push({ id: 'old1', user_id: A, amount: '9', category: 'shopping', payment: 'ewallet', merchant: 'Kedai Ali', created_at: '2026-10-01T00:00:00Z' });
    await link(db, tg, 'tok-a', CHAT_A);
    await deliver(tg, message(CHAT_A, 'kedai ali 4.50'));
    const saved = db.expenses.find((e) => e.id !== 'old1');
    assert.equal(saved.user_id, A);
    assert.equal(saved.amount, 4.5);
    assert.equal(saved.category, 'shopping', 'history beats guessing');
    assert.equal(saved.payment, 'ewallet', 'defaults to the payment method used last time');
    assert.equal(saved.merchant, 'kedai ali');
    assert.equal(saved.note, 'via Telegram');
    assert.match(tg.last().html, /Saved/);
    assert.match(tg.last().html, /RM\s?4\.50/);
    assert.deepEqual(tg.last().buttons.at(-1).map((b) => b.text), ['➕ More', '↩️ Undo', '✏️ Edit']);
    assert.equal(db.telegram_links[0].last_expense_id, saved.id);
});

test('expense: a payment word picks that method; no history falls back to the first active method and category "other"', async () => {
    const { db, tg } = setup();
    seedChoices(db, A);
    await link(db, tg, 'tok-a', CHAT_A);
    await deliver(tg, message(CHAT_A, 'zzz unknown place 8.90 ewallet'));
    let row = db.expenses[0];
    assert.equal(row.payment, 'ewallet');
    assert.ok(['other', 'food', 'shopping'].includes(row.category));
    assert.ok(!/ewallet/.test(row.merchant), 'the payment word is not part of the merchant name');
    await deliver(tg, message(CHAT_A, 'another thing 3'));
    row = db.expenses[1];
    assert.equal(row.payment, 'ewallet', 'then it remembers');
    db.expenses.length = 0;
    await deliver(tg, message(CHAT_A, 'plain 2'));
    assert.equal(db.expenses[0].payment, 'bank');
});

test('expense: a user with no saved categories still works using the built-in lists', async () => {
    const { db, tg } = setup();
    await link(db, tg, 'tok-a', CHAT_A);
    await deliver(tg, message(CHAT_A, 'mcdonalds 15.90 card'));
    assert.equal(db.expenses.length, 1);
    assert.equal(db.expenses[0].payment, 'card');
    assert.ok(['food', 'other'].includes(db.expenses[0].category));
});

test('expense: messages with no usable amount are explained, never saved', async () => {
    const { db, tg } = setup();
    await link(db, tg, 'tok-a', CHAT_A);
    for (const text of ['hello there', 'lunch', 'free 0', 'big 2000000', 'x'.repeat(501)]) {
        await deliver(tg, message(CHAT_A, text));
        assert.ok(tg.last(), text);
    }
    assert.equal(db.expenses.length, 0);
    assert.match(tg.sent.at(-1).html, /too long/);
    assert.match(tg.sent.at(-5).html, /couldn't find an amount/);
});

test('expense: unknown commands get help, and nothing is saved', async () => {
    const { db, tg } = setup();
    await link(db, tg, 'tok-a', CHAT_A);
    await deliver(tg, message(CHAT_A, '/deleteall'));
    assert.match(tg.last().html, /don't know that command/);
    await deliver(tg, message(CHAT_A, '/today@VinExpenses_bot'));
    assert.match(tg.last().html, /Today/);
    assert.equal(db.expenses.length, 0);
});

test('expense: whatever the person types is escaped before it is shown back', async () => {
    const { db, tg } = setup();
    await link(db, tg, 'tok-a', CHAT_A);
    await deliver(tg, message(CHAT_A, '<b>x</b><a href="javascript:1">y</a> 5'));
    assert.ok(!tg.last().html.includes('<a href'), tg.last().html);
    assert.ok(tg.last().html.includes('&lt;b&gt;'));
});

test('expense: daily message and expense limits are enforced per chat', async () => {
    const { db, tg } = setup();
    await link(db, tg, 'tok-a', CHAT_A);
    db.counters.set(`tg-add:${CHAT_A}`, 100);
    await deliver(tg, message(CHAT_A, 'lunch 5'));
    assert.match(tg.last().html, /Daily limit reached/);
    assert.equal(db.expenses.length, 0);
    const before = tg.sent.length;
    db.counters.set(`tg-msg:${CHAT_A}`, 300);
    await deliver(tg, message(CHAT_A, '/help'));
    assert.equal(tg.sent.length, before, 'over the message limit: silently ignored');
});

test('expense: a database failure produces a polite message and still answers Telegram with 200', async () => {
    const { db, tg } = setup();
    await link(db, tg, 'tok-a', CHAT_A);
    db.failures.add('expenses');
    const res = await deliver(tg, message(CHAT_A, 'lunch 5'));
    assert.equal(res.status, 200);
    assert.match(tg.last().html, /couldn't save|went wrong/);
    db.failures.clear();
    db.failures.add('telegram_links');
    assert.equal((await deliver(tg, message(CHAT_A, 'lunch 5'))).status, 200);
    assert.match(tg.last().html, /went wrong/);
});

// ------------------------------------------------------------------ undo and category change
test('undo: /undo removes the last expense added from the chat, once', async () => {
    const { db, tg } = setup();
    await link(db, tg, 'tok-a', CHAT_A);
    db.expenses.push({ id: 'keep', user_id: A, amount: '3', category: 'food', payment: 'bank', created_at: '2026-11-01T00:00:00Z' });
    await deliver(tg, message(CHAT_A, 'lunch 12.50'));
    await deliver(tg, message(CHAT_A, '/undo'));
    assert.match(tg.last().html, /Removed/);
    assert.deepEqual(db.expenses.map((e) => e.id), ['keep']);
    await deliver(tg, message(CHAT_A, '/undo'));
    assert.match(tg.last().html, /Nothing to undo/);
    assert.deepEqual(db.expenses.map((e) => e.id), ['keep'], 'older expenses are never removed by /undo');
});

test('buttons: Undo removes it; Category offers the active categories and applies the choice', async () => {
    const { db, tg } = setup();
    seedChoices(db, A);
    await link(db, tg, 'tok-a', CHAT_A);
    await deliver(tg, message(CHAT_A, 'something 20'));
    const id = db.expenses[0].id;
    await deliver(tg, callback(CHAT_A, `c:${id}`));
    const menu = tg.edited.at(-1);
    const labels = menu.buttons.flat().map((b) => b.text);
    assert.deepEqual(labels, ['🍜 Food', '🛍️ Shopping', '📦 Other', '✖ Cancel'], 'inactive categories are not offered');
    await deliver(tg, callback(CHAT_A, `k:${id}:1`));
    assert.equal(db.expenses[0].category, 'shopping');
    assert.match(tg.edited.at(-1).html, /Updated/);
    await deliver(tg, callback(CHAT_A, `x:${id}`));
    assert.match(tg.edited.at(-1).html, /Saved/);
    await deliver(tg, callback(CHAT_A, `k:${id}:9`));
    assert.equal(db.expenses[0].category, 'shopping', 'an out-of-range choice changes nothing');
    await deliver(tg, callback(CHAT_A, `u:${id}`));
    assert.equal(db.expenses.length, 0);
    assert.match(tg.edited.at(-1).html, /Removed/);
    assert.ok(tg.answered.length >= 5, 'every button press is acknowledged');
});

test('SECURITY: one person can never change or delete another person\'s expenses through the bot', async () => {
    const { db, tg } = setup();
    seedChoices(db, A);
    seedChoices(db, B);
    await link(db, tg, 'tok-a', CHAT_A);
    await link(db, tg, 'tok-b', CHAT_B);
    await deliver(tg, message(CHAT_B, 'bob private 99'));
    const bobs = db.expenses[0];
    const snapshot = JSON.stringify(bobs);
    // A learns or guesses B's expense id and presses buttons / sends commands from A's chat
    await deliver(tg, callback(CHAT_A, `u:${bobs.id}`));
    await deliver(tg, callback(CHAT_A, `k:${bobs.id}:2`));
    await deliver(tg, callback(CHAT_A, `c:${bobs.id}`));
    assert.equal(JSON.stringify(db.expenses.find((e) => e.id === bobs.id)), snapshot, "Bob's expense is untouched");
    assert.ok(tg.edited.every((e) => !/99/.test(e.html)), "Bob's amount is never shown to Alice");
    // A's /undo only ever targets A's own last expense, even if the pointer were tampered with
    db.telegram_links.find((l) => l.chat_id === CHAT_A).last_expense_id = bobs.id;
    await deliver(tg, message(CHAT_A, '/undo'));
    assert.ok(db.expenses.some((e) => e.id === bobs.id), "Bob's expense survives");
    // summaries only count one's own data
    await deliver(tg, message(CHAT_A, '/today'));
    assert.match(tg.last().html, /No expenses yet/);
    assert.ok(!/99/.test(tg.last().html));
});

test('buttons: malformed data, unlinked chats and group chats are ignored', async () => {
    const { db, tg } = setup();
    await link(db, tg, 'tok-a', CHAT_A);
    await deliver(tg, message(CHAT_A, 'lunch 5'));
    const id = db.expenses[0].id;
    const before = JSON.stringify(db.expenses);
    for (const data of ['u:../../etc', `u:${id}; drop table`, 'z:' + id, `k:${id}:abc`, '', `u:${id.toUpperCase()}x`]) {
        await deliver(tg, callback(CHAT_A, data));
    }
    await deliver(tg, callback(CHAT_B, `u:${id}`));          // a chat that is not linked
    const group = callback(CHAT_A, `u:${id}`);
    group.callback_query.message.chat.type = 'group';
    await deliver(tg, group);
    assert.equal(JSON.stringify(db.expenses), before);
    assert.equal(tg.edited.length, 0);
});

// ------------------------------------------------------------------ summaries
test('/today and /month add up the right period, in Kuala Lumpur time, for the right person', async () => {
    const { db, tg } = setup();
    seedChoices(db, A);
    await link(db, tg, 'tok-a', CHAT_A);
    const add = (user, amount, at, category = 'food') => db.expenses.push({ id: `e${db.expenses.length}`, user_id: user, amount: String(amount), category, payment: 'bank', created_at: at });
    add(A, 10, '2026-11-04T16:00:00Z');            // 00:00 on 5 Nov in KL: today
    add(A, 5.5, '2026-11-05T15:59:59Z', 'shopping'); // 23:59:59 on 5 Nov in KL: today
    add(A, 100, '2026-11-05T16:00:00Z');           // 6 Nov in KL: not today, not this month? (still November)
    add(A, 7, '2026-11-04T15:59:59Z');             // 4 Nov in KL: this month, not today
    add(A, 400, '2026-10-31T15:59:59Z');           // 31 Oct in KL: last month
    add(B, 1000, '2026-11-05T01:00:00Z');          // someone else
    db.incomes.push({ id: 'i1', user_id: A, amount: '3000', created_at: '2026-11-02T00:00:00Z' });
    await deliver(tg, message(CHAT_A, '/today'));
    assert.match(tg.last().html, /Spent\s+<b>RM\s?15\.50<\/b>\s+·\s+2 expenses/);
    assert.match(tg.last().html, /Food.*<b>RM\s?10\.00<\/b>/);
    assert.match(tg.last().html, /Shopping.*<b>RM\s?5\.50<\/b>/);
    await deliver(tg, message(CHAT_A, '/month'));
    const month = tg.last().html;
    assert.match(month, /November 2026/);
    assert.match(month, /Income\s+<b>RM\s?3,000\.00/);
    assert.match(month, /Spent\s+<b>RM\s?122\.50<\/b>/);
    assert.match(month, /Net\s+<b>RM\s?2,877\.50/);
    assert.ok(!/1,?000\.00/.test(month.replace('3,000.00', '')), "no one else's money");
});

test('/month works past the 1,000-row page size', async () => {
    const { db, tg } = setup();
    await link(db, tg, 'tok-a', CHAT_A);
    for (let i = 0; i < 2300; i++) db.expenses.push({ id: `p${String(i).padStart(5, '0')}`, user_id: A, amount: '1.00', category: 'food', payment: 'bank', created_at: '2026-11-03T00:00:00Z' });
    await deliver(tg, message(CHAT_A, '/month'));
    assert.match(tg.last().html, /RM\s?2,300\.00/);
});

test('/today with nothing recorded says so', async () => {
    const { db, tg } = setup();
    await link(db, tg, 'tok-a', CHAT_A);
    await deliver(tg, message(CHAT_A, '/today'));
    assert.match(tg.last().html, /No expenses yet/);
});

// ------------------------------------------------------------------ unlink, photos
test('/unlink disconnects the chat; later messages are not processed', async () => {
    const { db, tg } = setup();
    await link(db, tg, 'tok-a', CHAT_A);
    await deliver(tg, message(CHAT_A, '/unlink'));
    assert.match(tg.last().html, /Disconnected/);
    assert.equal(db.telegram_links.length, 0);
    await deliver(tg, message(CHAT_A, 'lunch 5'));
    assert.match(tg.last().html, /isn't connected/);
    assert.equal(db.expenses.length, 0);
});

test('photos and files get a clear "not supported yet" answer', async () => {
    const { db, tg } = setup();
    await link(db, tg, 'tok-a', CHAT_A);
    await deliver(tg, { update_id: ++updateCounter, message: { message_id: 9, chat: { id: CHAT_A, type: 'private' }, photo: [{ file_id: 'x' }] } });
    assert.match(tg.last().html, /Photo reading isn't available/);
    assert.equal(db.expenses.length, 0);
});

// ------------------------------------------------------------------ the real Telegram client
test('telegramClient: calls the right methods and never leaks the token into logs', async () => {
    const { telegramClient } = await shared('telegram');
    const calls = [];
    const logged = [];
    const originalError = console.error;
    console.error = (...args) => logged.push(args.join(' '));
    try {
        const client = telegramClient('123:TOKEN', async (url, init) => {
            calls.push({ url, body: JSON.parse(init.body) });
            return new Response('{}', { status: calls.length === 3 ? 500 : 200 });
        });
        await client.send(1, '<b>hi</b>', { buttons: [[{ text: 'A', callback_data: 'x' }]] });
        await client.edit(1, 2, 'edited');
        await client.answer('cb', 'x'.repeat(500));
        assert.equal(calls[0].url, 'https://api.telegram.org/bot123:TOKEN/sendMessage');
        assert.equal(calls[0].body.parse_mode, 'HTML');
        assert.deepEqual(calls[0].body.reply_markup.inline_keyboard, [[{ text: 'A', callback_data: 'x' }]]);
        assert.equal(calls[1].url.endsWith('/editMessageText'), true);
        assert.equal(calls[2].body.text.length, 180);
        const failing = telegramClient('123:TOKEN', async () => { throw new Error('boom https://api.telegram.org/bot123:TOKEN/x'); });
        await failing.send(1, 'x');
    } finally { console.error = originalError; }
    assert.ok(logged.length >= 2);
    assert.ok(logged.every((line) => !line.includes('TOKEN')), logged.join('|'));
});

// ------------------------------------------------------------------ automatic category: knowledge base -> history -> Other
test('auto category: everyday words and known merchants are filed by the built-in knowledge base', async () => {
    const { db, tg } = setup();
    seedChoices(db, A);
    db.user_categories.push({ user_id: A, category_key: 'car', label: 'Car', active: true, sort_order: 5 });
    await link(db, tg, 'tok-a', CHAT_A);
    const cases = [['lunch 12.50', 'food'], ['dinner 30', 'food'], ['petronas 50', 'car'], ['mcdonalds 15.90', 'food']];
    for (const [text, expected] of cases) {
        db.expenses.length = 0;
        await deliver(tg, message(CHAT_A, text));
        assert.equal(db.expenses[0].category, expected, text);
        assert.match(tg.last().html, /<i>Auto: /, 'the reply says why');
    }
});

test('auto category: the knowledge base comes BEFORE history, and history comes before Other', async () => {
    const { db, tg } = setup();
    seedChoices(db, A);
    for (let i = 0; i < 5; i++) {
        db.expenses.push({ id: `h${i}`, user_id: A, amount: '9', category: 'shopping', payment: 'bank', merchant: 'McDonalds', created_at: '2026-10-01T00:00:00Z' });
    }
    db.expenses.push({ id: 'k1', user_id: A, amount: '4', category: 'shopping', payment: 'bank', merchant: 'Kedai Ali', created_at: '2026-10-02T00:00:00Z' });
    await link(db, tg, 'tok-a', CHAT_A);
    await deliver(tg, message(CHAT_A, 'mcdonalds 15'));
    assert.equal(db.expenses.at(-1).category, 'food', 'known brand wins over the person\'s own (odd) habit');
    await deliver(tg, message(CHAT_A, 'kedai ali 6'));
    assert.equal(db.expenses.at(-1).category, 'shopping', 'not in the knowledge base: history decides');
    assert.match(tg.last().html, /Auto: .*Kedai Ali/i);
    await deliver(tg, message(CHAT_A, 'zzqx unknown thing 3'));
    assert.equal(db.expenses.at(-1).category, 'other', 'nothing matches: Other');
    assert.match(tg.last().html, /filed under Other/);
});

test('auto category: only categories the person still uses can be chosen', async () => {
    const { db, tg } = setup();
    db.user_categories.push(
        { user_id: A, category_key: 'food', label: 'Food', active: false, sort_order: 1 },
        { user_id: A, category_key: 'other', label: 'Other', active: true, sort_order: 2 },
        { user_id: A, category_key: 'pets', label: 'Pets', active: true, sort_order: 3 },
    );
    await link(db, tg, 'tok-a', CHAT_A);
    await deliver(tg, message(CHAT_A, 'lunch 10'));
    assert.equal(db.expenses.at(-1).category, 'other', 'Food was retired, so a lunch goes to Other, not to a hidden category');
    await deliver(tg, message(CHAT_A, 'pets snacks 20'));
    assert.ok(['pets', 'other'].includes(db.expenses.at(-1).category));
});

test('auto category: correcting a category teaches the next one (history)', async () => {
    const { db, tg } = setup();
    seedChoices(db, A);
    await link(db, tg, 'tok-a', CHAT_A);
    await deliver(tg, message(CHAT_A, 'zzqx corner 5'));
    assert.equal(db.expenses[0].category, 'other');
    await deliver(tg, callback(CHAT_A, `k:${db.expenses[0].id}:1`));            // person picks "Shopping"
    await deliver(tg, message(CHAT_A, 'zzqx corner 7'));
    assert.equal(db.expenses[1].category, 'shopping');
});

test('chooseCategory: handles empty descriptions and bad input without throwing', async () => {
    const { chooseCategory } = await botModule();
    const cats = [{ key: 'food', label: 'Food', active: true }, { key: 'other', label: 'Other', active: true }];
    for (const d of ['', '   ', '<script>', 'x'.repeat(80)]) {
        const r = await chooseCategory(d, cats, [], 'other');
        assert.ok(['food', 'other'].includes(r.key), d);
    }
    assert.equal((await chooseCategory('lunch', cats, [], 'other')).source, 'knowledge');
    assert.equal((await chooseCategory('', cats, [], 'other')).source, 'none');
});
