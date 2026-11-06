'use strict';
// Tests for the Mini App's server side: Telegram's signature check, and the data service behind it.
// The signature is produced here with Node's own crypto (a separate implementation from the one in the function), so the
// check is not simply agreeing with itself.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { ENV, A, B, NOW, CHAT_A, CHAT_B, setup } = require('./helpers/tg-harness.js');

test.afterEach(() => { delete globalThis.Deno; });
const webapp = () => import('../supabase/functions/_shared/tg-webapp.ts');
const api = () => import('../supabase/functions/miniapp-api/handler.ts');
const TOKEN = ENV.TELEGRAM_BOT_TOKEN;
const SITE = 'https://me.github.io';

/** initData signed the way Telegram does it. `fields` are the visible fields; `skip` are left out of the signed text. */
function signedInitData(fields, { token = TOKEN, skip = ['hash'], tamper } = {}) {
    const text = Object.entries(fields).filter(([k]) => !skip.includes(k)).map(([k, v]) => `${k}=${v}`).sort().join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
    const hash = crypto.createHmac('sha256', secret).update(text).digest('hex');
    const params = new URLSearchParams({ ...fields, hash: tamper ? hash.replace(/^./, (c) => (c === 'a' ? 'b' : 'a')) : hash });
    return params.toString();
}
const user = (id = CHAT_A, extra = {}) => JSON.stringify({ id, first_name: 'Vin', language_code: 'en', ...extra });
const seconds = (date) => Math.floor(date.getTime() / 1000);
const fresh = (id = CHAT_A, over = {}) => ({ auth_date: String(seconds(NOW) - 60), query_id: 'AAH123', user: user(id), ...over });

// ------------------------------------------------------------------ the signature check
test('initData: a genuine launch is accepted and gives the verified user', async () => {
    const { verifyInitData } = await webapp();
    const result = await verifyInitData(signedInitData(fresh()), TOKEN, NOW);
    assert.deepEqual(result, { ok: true, authDate: seconds(NOW) - 60, user: { id: CHAT_A, first_name: 'Vin', language_code: 'en' } });
    const noisy = await verifyInitData(signedInitData(fresh(CHAT_A, { user: user(CHAT_A, { first_name: 'X'.repeat(300), language_code: 'zh-hans-extra-long', is_premium: true }) })), TOKEN, NOW);
    assert.equal(noisy.user.first_name.length, 64, 'names are trimmed');
    assert.equal(noisy.user.language_code.length, 8);
});

test('initData: anything not signed by YOUR bot token is refused, however small the change', async () => {
    const { verifyInitData } = await webapp();
    const good = signedInitData(fresh());
    assert.equal((await verifyInitData(good, 'another-bot-token', NOW)).reason, 'bad_signature');
    assert.equal((await verifyInitData(signedInitData(fresh(), { token: '999:ANOTHERTOKENANOTHERTOKENANOTHERTOK' }), TOKEN, NOW)).reason, 'bad_signature', 'signed by a different bot');
    assert.equal((await verifyInitData(signedInitData(fresh(), { tamper: true }), TOKEN, NOW)).reason, 'bad_signature', 'one character of the hash changed');
    const changedUser = new URLSearchParams(good);
    changedUser.set('user', user(CHAT_B));
    assert.equal((await verifyInitData(changedUser.toString(), TOKEN, NOW)).reason, 'bad_signature', 'someone else\'s id with the old signature');
    const extra = new URLSearchParams(good);
    extra.set('chat_type', 'private');
    assert.equal((await verifyInitData(extra.toString(), TOKEN, NOW)).reason, 'bad_signature', 'a field added afterwards');
    const dropped = new URLSearchParams(good);
    dropped.delete('query_id');
    assert.equal((await verifyInitData(dropped.toString(), TOKEN, NOW)).reason, 'bad_signature', 'a field removed afterwards');
    const older = new URLSearchParams(good);
    older.set('auth_date', String(seconds(NOW) - 5));
    assert.equal((await verifyInitData(older.toString(), TOKEN, NOW)).reason, 'bad_signature', 'a refreshed date with the old signature');
});

test('initData: the "signature" field newer Telegram versions add is handled both ways', async () => {
    const { verifyInitData } = await webapp();
    const fields = fresh(CHAT_A, { signature: 'ZmFrZXNpZ25hdHVyZQ' });
    assert.equal((await verifyInitData(signedInitData(fields), TOKEN, NOW)).ok, true, 'hash covers every field except hash');
    assert.equal((await verifyInitData(signedInitData(fields, { skip: ['hash', 'signature'] }), TOKEN, NOW)).ok, true, 'hash covers every field except hash and signature');
    assert.equal((await verifyInitData(signedInitData(fields, { skip: ['hash', 'signature', 'query_id'] }), TOKEN, NOW)).ok, false, 'but not an arbitrary subset');
    assert.equal((await verifyInitData(signedInitData(fields, { token: 'x' }), TOKEN, NOW)).ok, false, 'and never without the bot token');
});

test('initData: old launches expire, future ones are refused, the limit is exact and configurable', async () => {
    const { verifyInitData } = await webapp();
    const at = (age) => signedInitData(fresh(CHAT_A, { auth_date: String(seconds(NOW) - age) }));
    assert.equal((await verifyInitData(at(6 * 3600), TOKEN, NOW)).ok, true, 'exactly at the limit');
    assert.equal((await verifyInitData(at(6 * 3600 + 1), TOKEN, NOW)).reason, 'expired');
    assert.equal((await verifyInitData(at(7 * 86400), TOKEN, NOW)).reason, 'expired', 'a week-old copy');
    assert.equal((await verifyInitData(at(-200), TOKEN, NOW)).ok, true, 'a little clock difference is fine');
    assert.equal((await verifyInitData(at(-400), TOKEN, NOW)).reason, 'expired', 'a launch from the future');
    assert.equal((await verifyInitData(at(100), TOKEN, NOW, 60)).reason, 'expired', 'a stricter limit');
    for (const date of ['abc', '0', '-5', '1.5', '']) {
        assert.equal((await verifyInitData(signedInitData(fresh(CHAT_A, { auth_date: date })), TOKEN, NOW)).reason, 'malformed', `auth_date ${JSON.stringify(date)}`);
    }
});

test('initData: malformed, duplicated and oversized input is refused without throwing', async () => {
    const { verifyInitData } = await webapp();
    for (const bad of [undefined, null, '', 5, {}, [], 'hash=abc', 'user=%7B%7D', 'a'.repeat(5000), `hash=${'A'.repeat(64)}&auth_date=1`, `hash=${'a'.repeat(63)}`]) {
        const result = await verifyInitData(bad, TOKEN, NOW);
        assert.equal(result.ok, false, String(bad).slice(0, 30));
    }
    assert.equal((await verifyInitData(signedInitData(fresh()), '', NOW)).ok, false, 'no bot token configured');
    const good = signedInitData(fresh());
    assert.equal((await verifyInitData(`${good}&auth_date=${seconds(NOW)}`, TOKEN, NOW)).reason, 'malformed', 'a repeated field');
    const missingUser = { auth_date: String(seconds(NOW)), query_id: 'x' };
    assert.equal((await verifyInitData(signedInitData(missingUser), TOKEN, NOW)).reason, 'no_user');
    for (const badUser of ['not json', '{}', '{"id":"5"}', '{"id":-5}', '{"id":1.5}', '{"id":0}', '{"id":9007199254740993}', 'null', '[]']) {
        const r = await verifyInitData(signedInitData(fresh(CHAT_A, { user: badUser })), TOKEN, NOW);
        assert.equal(r.reason, 'no_user', badUser);
    }
});

// ------------------------------------------------------------------ the service: set-up
function world(extraEnv = {}) {
    const ctx = setup(extraEnv);
    ctx.db.telegram_links.push({ chat_id: CHAT_A, user_id: A, lang: 'en', digest_on: false });
    ctx.db.telegram_links.push({ chat_id: CHAT_B, user_id: B, lang: 'ms', digest_on: false });
    for (const u of [A, B]) {
        ctx.db.user_categories.push(
            { user_id: u, category_key: 'food', label: 'Food', color: '#ef4444', active: true, sort_order: 1 },
            { user_id: u, category_key: 'shopping', label: 'Shopping', color: '#8b5cf6', active: true, sort_order: 2 },
            { user_id: u, category_key: 'old', label: 'Retired', color: '#999999', active: false, sort_order: 3 },
        );
        ctx.db.user_payment_methods.push(
            { user_id: u, payment_key: 'bank', label: 'Bank', color: '#4f46e5', active: true, sort_order: 1 },
            { user_id: u, payment_key: 'old_card', label: 'Old card', color: '#4f46e5', active: false, sort_order: 2 },
        );
    }
    return ctx;
}
const expense = (db, user, over = {}) => { const row = { id: crypto.randomUUID(), user_id: user, amount: '10', category: 'food', payment: 'bank', merchant: 'Cafe', note: null, created_at: '2026-11-03T04:00:00Z', ...over }; db.expenses.push(row); return row; };

async function call(body, { chat = CHAT_A, initData, origin = SITE, method = 'POST', now = NOW, raw, headers = {} } = {}) {
    const { handle } = await api();
    const init = initData === undefined ? signedInitData(fresh(chat)) : initData;
    return handle(new Request('https://abcdefghij.supabase.co/functions/v1/miniapp-api', {
        method,
        headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}), ...(init ? { 'x-telegram-init-data': init } : {}), ...headers },
        body: method === 'POST' ? (raw ?? JSON.stringify(body)) : undefined,
    }), now);
}
const ok = async (body, options) => { const res = await call(body, options); assert.equal(res.status, 200, JSON.stringify(await res.clone().json().catch(() => ({})))); return res.json(); };

// ------------------------------------------------------------------ the service: the door
test('service: refuses everything without a genuine, recent, linked Telegram launch - and touches no data when it does', async () => {
    const { db } = world();
    expense(db, A);
    const before = db.requests.length;
    const refused = [
        [await call({ action: 'bootstrap' }, { initData: '' }), 401, 'unauthorized'],
        [await call({ action: 'bootstrap' }, { initData: 'garbage' }), 401, 'unauthorized'],
        [await call({ action: 'bootstrap' }, { initData: signedInitData(fresh(), { token: 'wrong-token-wrong-token' }) }), 401, 'unauthorized'],
        [await call({ action: 'bootstrap' }, { initData: signedInitData(fresh(CHAT_A, { auth_date: String(seconds(NOW) - 8 * 3600) })) }), 401, 'expired'],
        [await call({ action: 'bootstrap' }, { initData: signedInitData(fresh(CHAT_A), { tamper: true }) }), 401, 'unauthorized'],
    ];
    for (const [res, status, code] of refused) {
        assert.equal(res.status, status);
        assert.deepEqual(await res.json(), { ok: false, error: code });
    }
    assert.equal(db.requests.length, before, 'no database request was made for any refused call');
    const stranger = await call({ action: 'bootstrap' }, { chat: 777 });
    assert.deepEqual([stranger.status, (await stranger.json()).error], [403, 'not_linked']);
    assert.equal((await call({ action: 'bootstrap' }, { method: 'GET' })).status, 405);
    const strangerWithGoodSignature = await call({ action: 'month', offset: 0 }, { chat: 888 });
    assert.equal(strangerWithGoodSignature.status, 403, 'a genuine Telegram user who has not linked an account sees nothing');
});

test('service: only your own website may call it; the signature header is allowed in the preflight; setup problems are plain 503s', async () => {
    world();
    const foreign = await call({ action: 'bootstrap' }, { origin: 'https://evil.example' });
    assert.equal(foreign.status, 403);
    assert.equal(foreign.headers.get('access-control-allow-origin'), null);
    const preflight = await call({}, { method: 'OPTIONS', initData: '' });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), SITE);
    assert.match(preflight.headers.get('access-control-allow-headers'), /x-telegram-init-data/);
    const allowed = await call({ action: 'bootstrap' });
    assert.equal(allowed.headers.get('access-control-allow-origin'), SITE);
    assert.equal(allowed.headers.get('cache-control'), 'no-store');
    assert.equal(allowed.headers.get('x-content-type-options'), 'nosniff');
    delete globalThis.Deno;
    world({ TELEGRAM_BOT_TOKEN: undefined });
    const down = await call({ action: 'bootstrap' });
    assert.deepEqual([down.status, (await down.json()).error], [503, 'not_configured']);
    delete globalThis.Deno;
    const { db } = world();
    db.failures.add('telegram_links');
    assert.equal((await call({ action: 'bootstrap' })).status, 503);
});

test('service: the allowed age of a launch can be tightened with MINIAPP_MAX_AGE_SECONDS', async () => {
    world({ MINIAPP_MAX_AGE_SECONDS: '30' });
    const res = await call({ action: 'bootstrap' }); // signed 60 seconds ago
    assert.deepEqual([res.status, (await res.json()).error], [401, 'expired']);
});

test('service: bad bodies and unknown actions are plain 400/413 errors', async () => {
    world();
    assert.equal((await call(null, { raw: '{not json' })).status, 400);
    assert.equal((await call(null, { raw: '[]' })).status, 400);
    assert.equal((await call(null, { raw: 'null' })).status, 400);
    assert.equal((await call(null, { raw: '"text"' })).status, 400);
    assert.equal((await call({ action: 'drop_everything' })).status, 400);
    assert.equal((await call({})).status, 400);
    assert.equal((await call({ action: ['bootstrap'] })).status, 400);
    assert.equal((await call(null, { raw: JSON.stringify({ action: 'bootstrap', junk: 'x'.repeat(21_000) }) })).status, 413);
});

test('service: daily limits fail closed, and writes have a tighter limit than reads', async () => {
    const { db } = world();
    db.counters.set(`mini-write:${A}`, 300);
    assert.equal((await call({ action: 'bootstrap' })).status, 200, 'reads still work');
    const blocked = await call({ action: 'expense_add', amount: 5, category: 'food', payment: 'bank' });
    assert.deepEqual([blocked.status, (await blocked.json()).error], [429, 'limit']);
    assert.equal(db.expenses.length, 0);
    db.counters.set(`mini:${A}`, 3000);
    assert.equal((await call({ action: 'bootstrap' })).status, 429);
    db.counters.clear();
    db.failures.add('rpc/consume_quota');
    assert.equal((await call({ action: 'bootstrap' })).status, 429, 'a broken counter blocks instead of allowing unlimited use');
});

// ------------------------------------------------------------------ the service: reading
test('bootstrap: the person\'s name, language, today (Kuala Lumpur), categories and payment methods', async () => {
    world();
    const out = await ok({ action: 'bootstrap' });
    assert.equal(out.name, 'Vin');
    assert.equal(out.lang, 'en');
    assert.equal(out.today, '2026-11-05');
    assert.deepEqual(out.categories.map((c) => [c.key, c.active]), [['food', true], ['shopping', true], ['old', false]]);
    assert.deepEqual(out.payments.map((p) => p.key), ['bank', 'old_card']);
    assert.ok(out.categories.every((c) => /^#[0-9a-f]{3,8}$/i.test(c.color)));
    assert.deepEqual([out.maxOffset, out.maxAmount, out.maxDaysBack], [60, 1_000_000, 400]);
    const bob = await ok({ action: 'bootstrap' }, { chat: CHAT_B });
    assert.equal(bob.lang, 'ms', 'the language chosen in the bot');
});

test('bootstrap: built-in lists when the person has none, and a safe colour whatever is stored', async () => {
    const { db } = world();
    db.user_categories.length = 0;
    db.user_payment_methods.length = 0;
    const out = await ok({ action: 'bootstrap' });
    assert.equal(out.categories.length, 10);
    assert.deepEqual(out.payments.map((p) => p.key), ['bank', 'card', 'ewallet']);
    db.user_categories.push({ user_id: A, category_key: 'x', label: 'X', color: 'url(javascript:alert(1))', active: true, sort_order: 1 });
    assert.equal((await ok({ action: 'bootstrap' })).categories[0].color, '#6b7280', 'an unsafe stored colour is replaced');
});

test('month: the numbers for a month - totals, categories, days, budgets, trend - only for this person', async () => {
    const { db } = world();
    expense(db, A, { amount: '300', category: 'shopping', created_at: '2026-11-03T04:00:00Z' });
    expense(db, A, { amount: '12.5', created_at: '2026-11-04T04:00:00Z' });
    expense(db, A, { amount: '100', created_at: '2026-10-10T04:00:00Z' });
    expense(db, B, { amount: '9999', created_at: '2026-11-03T04:00:00Z' });
    db.incomes.push({ id: 'i1', user_id: A, amount: '6000', source: 'Salary', created_at: '2026-11-01T01:00:00Z' }, { id: 'i2', user_id: B, amount: '77777', source: 'Salary', created_at: '2026-11-01T01:00:00Z' });
    db.budgets.push({ user_id: A, category: 'shopping', amount: '250' }, { user_id: B, category: 'food', amount: '1' });
    const { data } = await ok({ action: 'month', offset: 0 });
    assert.equal(data.total, 312.5);
    assert.equal(data.count, 2);
    assert.equal(data.previousTotal, 100);
    assert.equal(data.income, 6000);
    assert.deepEqual(data.byCategory, [['shopping', 300], ['food', 12.5]]);
    assert.equal(data.days, 30);
    assert.equal(data.firstWeekday, 6, '1 Nov 2026 is a Sunday');
    assert.equal(data.todayIndex, 4);
    assert.deepEqual(data.daily.slice(0, 5), [0, 0, 300, 12.5, 0]);
    assert.equal(data.daily.length, 30);
    assert.deepEqual(data.budgets, [{ key: 'shopping', limit: 250, used: 300 }]);
    assert.equal(data.monthTotals.length, 6);
    assert.equal(data.monthTotals.at(-1), 312.5);
    assert.equal(data.monthTotals.at(-2), 100);
    assert.equal(data.monthStarts.length, 6);
    assert.equal(data.monthStarts.at(-1), '2026-10-31T16:00:00.000Z');
    assert.equal(data.offset, 0);
    assert.ok(!JSON.stringify(data).includes('9999') && !JSON.stringify(data).includes('77777'));
    const october = (await ok({ action: 'month', offset: 1 })).data;
    assert.equal(october.total, 100);
    assert.equal(october.todayIndex, null);
});

test('month: invalid offsets are rejected with the field name', async () => {
    world();
    for (const offset of [-1, 61, 1.5, 'x', '3', null, [], [2], {}, true, NaN]) {
        const res = await call({ action: 'month', offset });
        assert.deepEqual([res.status, (await res.json()).field], [400, 'offset'], JSON.stringify(offset));
    }
    assert.equal((await ok({ action: 'month' })).data.offset, 0, 'no offset means this month');
});

test('transactions: newest first, filter by category, search (treated as plain text), paging, totals, own data only', async () => {
    const { db } = world();
    const a1 = expense(db, A, { amount: '5.5', merchant: 'Kopi Tiam', note: 'breakfast', created_at: '2026-11-02T01:00:00Z' });
    const a2 = expense(db, A, { amount: '40', category: 'shopping', merchant: '99 Speedmart', created_at: '2026-11-03T01:00:00Z' });
    const a3 = expense(db, A, { amount: '12', merchant: '100% Juice & Co (KL), <b>', note: 'x*y_z', created_at: '2026-11-04T01:00:00Z' });
    expense(db, A, { amount: '80', created_at: '2026-10-05T01:00:00Z' });
    expense(db, B, { amount: '999', merchant: 'Kopi Tiam', created_at: '2026-11-03T01:00:00Z' });
    const all = await ok({ action: 'transactions', offset: 0 });
    assert.deepEqual(all.items.map((i) => i.id), [a3.id, a2.id, a1.id], 'newest first');
    assert.equal(all.total, 3);
    assert.equal(all.sum, 57.5);
    assert.equal(typeof all.items[0].amount, 'number');
    assert.deepEqual((await ok({ action: 'transactions', offset: 0, category: 'shopping' })).items.map((i) => i.id), [a2.id]);
    assert.deepEqual((await ok({ action: 'transactions', offset: 0, q: 'KOPI' })).items.map((i) => i.id), [a1.id], 'case-insensitive, and not Bob\'s');
    assert.deepEqual((await ok({ action: 'transactions', offset: 0, q: 'breakfast' })).items.map((i) => i.id), [a1.id], 'notes are searched too');
    for (const [term, expectedId] of [['%', a3.id], ['100%', a3.id], ['(kl)', a3.id], ['<b>', a3.id], ['x*y', a3.id], ['y_z', a3.id], [',', a3.id], ["'", undefined], ['\\', undefined], ['*', a3.id], ['_', a3.id]]) {
        const out = await ok({ action: 'transactions', offset: 0, q: term });
        assert.deepEqual(out.items.map((i) => i.id), expectedId ? [expectedId] : [], `search ${JSON.stringify(term)} is plain text, never a pattern`);
    }
    assert.equal((await ok({ action: 'transactions', offset: 0, q: 'zzz-no-match' })).total, 0);
    const page = await ok({ action: 'transactions', offset: 0, limit: 2 });
    assert.deepEqual([page.items.length, page.total], [2, 3]);
    assert.deepEqual((await ok({ action: 'transactions', offset: 0, limit: 2, skip: 2 })).items.map((i) => i.id), [a1.id]);
    assert.equal((await ok({ action: 'transactions', offset: 0, limit: 100000 })).items.length, 3, 'a huge limit is clamped, not an error');
    assert.equal((await ok({ action: 'transactions', offset: 0, limit: -5, skip: -9 })).items.length, 3, 'nonsense paging falls back to defaults');
    assert.equal((await ok({ action: 'transactions', offset: 1 })).total, 1, 'the previous month');
    assert.equal((await call({ action: 'transactions', offset: 99 })).status, 400);
    assert.deepEqual((await ok({ action: 'transactions', offset: 0 }, { chat: CHAT_B })).items.map((i) => i.amount), [999]);
});

test('transactions: a month with more than 1,000 rows is read completely', async () => {
    const { db } = world();
    for (let i = 0; i < 1500; i++) expense(db, A, { amount: '1', created_at: '2026-11-03T04:00:00Z', id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}` });
    const out = await ok({ action: 'transactions', offset: 0, limit: 10 });
    assert.deepEqual([out.total, out.sum, out.items.length], [1500, 1500, 10]);
});

// ------------------------------------------------------------------ the service: writing
test('expense_add: saves for this person, with validated values, and ignores anything else in the request', async () => {
    const { db } = world();
    const out = await ok({ action: 'expense_add', amount: '12,50', category: 'food', payment: 'bank', merchant: '  Nasi\u0000 Lemak\r\nINJECT  ', note: null, user_id: B, id: 'hijack', created_at: '2000-01-01T00:00:00Z' });
    const row = db.expenses[0];
    assert.deepEqual([row.user_id, row.amount, row.category, row.payment, row.merchant, row.note], [A, 12.5, 'food', 'bank', 'Nasi Lemak INJECT', 'via Mini App']);
    assert.notEqual(row.id, 'hijack');
    assert.ok(row.created_at > '2020', 'the time the client sent is ignored');
    assert.deepEqual([out.item.id, out.item.amount], [row.id, 12.5]);
    const dated = await ok({ action: 'expense_add', amount: 8, category: 'shopping', payment: 'bank', date: '2026-11-02', note: 'a'.repeat(500) });
    assert.equal(dated.item.created_at, '2026-11-02T04:00:00.000Z', 'noon in Kuala Lumpur on that day');
    assert.equal(dated.item.note.length, 200);
    const today = await ok({ action: 'expense_add', amount: 3, category: 'food', payment: 'bank', date: '2026-11-05' });
    assert.ok(today.item.created_at.startsWith('2026-11-05'), 'today means now, not noon');
    assert.deepEqual(db.expenses.map((e) => e.user_id), [A, A, A]);
});

test('expense_add: every invalid value is refused with the name of the field, and nothing is saved', async () => {
    const { db } = world();
    const base = { action: 'expense_add', amount: 10, category: 'food', payment: 'bank' };
    const cases = [
        [{ amount: 0 }, 'amount'], [{ amount: 0.001 }, 'amount'], [{ amount: -5 }, 'amount'], [{ amount: '1e3' }, 'amount'], [{ amount: 'abc' }, 'amount'],
        [{ amount: '12.345' }, 'amount'], [{ amount: 'RM5' }, 'amount'], [{ amount: 1_000_001 }, 'amount'], [{ amount: null }, 'amount'], [{ amount: [5] }, 'amount'],
        [{ amount: NaN }, 'amount'], [{ amount: undefined }, 'amount'],
        [{ category: 'nope' }, 'category'], [{ category: 'old' }, 'category'], [{ category: { key: 'food' } }, 'category'], [{ category: undefined }, 'category'],
        [{ payment: 'cheque' }, 'payment'], [{ payment: 'old_card' }, 'payment'], [{ payment: undefined }, 'payment'],
        [{ date: '2026-11-06' }, 'date'], [{ date: '2025-09-30' }, 'date'], [{ date: '2026-02-30' }, 'date'], [{ date: '05/11/2026' }, 'date'], [{ date: 20261105 }, 'date'],
        [{ merchant: 42 }, 'merchant'], [{ merchant: {} }, 'merchant'], [{ note: 7 }, 'note'],
    ];
    for (const [patch, field] of cases) {
        const res = await call({ ...base, ...patch });
        assert.deepEqual([res.status, (await res.json()).field], [400, field], JSON.stringify(patch));
    }
    assert.equal(db.expenses.length, 0);
    assert.equal((await call({ ...base, date: '2025-10-01' })).status, 200, '400 days back is the limit');
    assert.equal((await call({ ...base, amount: 1_000_000 })).status, 200);
    assert.equal((await call({ ...base, amount: 0.01 })).status, 200);
});

test('expense_add: the database failing is reported, not hidden', async () => {
    const { db } = world();
    db.failures.add('expenses');
    const res = await call({ action: 'expense_add', amount: 5, category: 'food', payment: 'bank' });
    assert.ok([502, 503].includes(res.status));
    assert.equal(JSON.stringify(await res.json()).includes('boom'), false, 'no internal detail leaks');
});

test('expense_update: changes only the person\'s own expense, only the fields sent, with the same validation', async () => {
    const { db } = world();
    const mine = expense(db, A, { amount: '10', merchant: 'Cafe', note: 'keep', created_at: '2026-11-03T04:00:00Z' });
    const bobs = expense(db, B, { amount: '99', merchant: 'Secret' });
    const out = await ok({ action: 'expense_update', id: mine.id, amount: 25, category: 'shopping' });
    assert.deepEqual([out.item.amount, out.item.category, out.item.merchant, out.item.note], [25, 'shopping', 'Cafe', 'keep']);
    assert.equal((await ok({ action: 'expense_update', id: mine.id, merchant: null, note: null })).item.merchant, null, 'null clears');
    assert.equal((await ok({ action: 'expense_update', id: mine.id, category: 'old' })).item.category, 'old', 'an old category can be kept or chosen when editing');
    const theirs = await call({ action: 'expense_update', id: bobs.id, amount: 1, user_id: A });
    assert.deepEqual([theirs.status, (await theirs.json()).error], [404, 'not_found']);
    assert.deepEqual([bobs.amount, bobs.merchant, bobs.user_id], ['99', 'Secret', B], "Bob's expense is untouched");
    const moved = await ok({ action: 'expense_update', id: mine.id, date: '2026-11-01' });
    assert.equal(moved.item.created_at, '2026-11-01T04:00:00.000Z');
    const sameDay = await ok({ action: 'expense_update', id: mine.id, date: '2026-11-01', amount: 26 });
    assert.equal(sameDay.item.created_at, '2026-11-01T04:00:00.000Z', 'the same day keeps its time');
    for (const [body, field] of [[{ id: 'not-a-uuid', amount: 1 }, 'id'], [{ id: mine.id, amount: 0 }, 'amount'], [{ id: mine.id, category: 'nope' }, 'category'], [{ id: mine.id, payment: 'x' }, 'payment'], [{ id: mine.id, date: '2030-01-01' }, 'date'], [{ id: mine.id }, 'nothing'], [{ id: mine.id, unknown: 1 }, 'nothing']]) {
        const res = await call({ action: 'expense_update', ...body });
        assert.deepEqual([res.status, (await res.json()).field], [400, field], JSON.stringify(body));
    }
    assert.equal((await call({ action: 'expense_update', id: crypto.randomUUID(), amount: 5 })).status, 404);
    assert.equal((await call({ action: 'expense_update', id: crypto.randomUUID(), date: '2026-11-01' })).status, 404);
});

test('expense_delete: removes only the person\'s own expense, once', async () => {
    const { db } = world();
    const mine = expense(db, A);
    const bobs = expense(db, B);
    const theirs = await call({ action: 'expense_delete', id: bobs.id });
    assert.equal(theirs.status, 404);
    assert.equal(db.expenses.length, 2, "Bob's expense remains");
    assert.deepEqual(await ok({ action: 'expense_delete', id: mine.id }), { ok: true, id: mine.id });
    assert.deepEqual(db.expenses.map((e) => e.id), [bobs.id]);
    assert.equal((await call({ action: 'expense_delete', id: mine.id })).status, 404, 'the second time');
    for (const id of ['', 'x', undefined, null, 5, "'; drop table expenses;--", '../..', mine.id + 'x']) {
        assert.equal((await call({ action: 'expense_delete', id })).status, 400, String(id));
    }
    assert.equal(db.expenses.length, 1);
});

test('the signature of one person can never act on another person\'s data, through any action', async () => {
    const { db } = world();
    const bobs = expense(db, B, { amount: '321', merchant: 'Bobs private' });
    const snapshot = JSON.stringify(db.expenses);
    const attempts = [
        { action: 'transactions', offset: 0, user_id: B, q: 'Bobs' },
        { action: 'month', offset: 0, user_id: B },
        { action: 'expense_update', id: bobs.id, amount: 1 },
        { action: 'expense_delete', id: bobs.id },
        { action: 'expense_add', amount: 5, category: 'food', payment: 'bank', user_id: B },
    ];
    for (const attempt of attempts) {
        const res = await call(attempt, { chat: CHAT_A });
        const text = JSON.stringify(await res.json());
        // look for Bob's actual values, never a bare number: a response also holds random ids and timestamps that can contain any digits
        assert.ok(!text.includes('Bobs') && !text.includes(bobs.id) && !/"amount":321(\.0+)?[,}]/.test(text), `${attempt.action} leaked Bob's data`);
    }
    assert.equal(JSON.stringify(db.expenses.filter((e) => e.user_id === B)), JSON.stringify(JSON.parse(snapshot).filter((e) => e.user_id === B)), "Bob's rows are unchanged");
    assert.equal(db.expenses.filter((e) => e.user_id === B).length, 1);
    assert.equal(db.expenses.filter((e) => e.user_id === A).length, 1, 'the added expense belongs to Alice');
});
