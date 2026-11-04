'use strict';
// End-to-end tests of the email edge functions. Each runs the real handler code against an in-memory stand-in for
// Supabase (auth, tables, counters) and a scripted fake Gmail. No network is used.
//
// Limit worth knowing: the stand-in understands the filters these functions use, but it is not PostgREST itself,
// so the very first real run on your project is still the final proof (the admin "Send test email" button covers it).
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeSmtp, parseMessage, fakeSupabase } = require('./helpers/fakes.js');

const SITE = 'https://me.github.io';
const BASE_ENV = {
    SUPABASE_URL: 'https://abcdefghij.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-key',
    ALLOWED_ORIGINS: SITE,
    SMTP_USER: 'sender@gmail.com',
    SMTP_PASS: 'abcd efgh ijkl mnop',
    EMAIL_TOKEN_SECRET: 'T'.repeat(40),
    SITE_URL: `${SITE}/VinExpenses`,
    MONTHLY_REPORT_CRON_SECRET: 'cron-secret-with-24-or-more-chars',
    ADMIN_EMAIL: 'boss@gmail.com',
};
const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';
const C = 'cccccccc-0000-4000-8000-000000000003';
const D = 'dddddddd-0000-4000-8000-000000000004';
const BOSS = 'eeeeeeee-0000-4000-8000-000000000005';
const handler = (fn) => import(`../supabase/functions/${fn}/handler.ts`);
const shared = (name) => import(`../supabase/functions/_shared/${name}.ts`);

function setup(extraEnv = {}) {
    const env = { ...BASE_ENV, ...extraEnv };
    for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
    globalThis.Deno = { env: { get: (name) => env[name] } };
    const db = fakeSupabase();
    db.addUser('tok-a', A, 'a@gmail.com');
    db.addUser('tok-b', B, 'b@gmail.com');
    db.addUser('tok-boss', BOSS, 'Boss@Gmail.com');
    db.addUser('tok-unconfirmed-boss', C, 'boss@gmail.com', false);
    globalThis.fetch = db.fetch;
    return { env, db };
}
test.afterEach(() => { delete globalThis.Deno; });

const call = (fn, { method = 'POST', token, origin = SITE, body = '{}', headers = {}, url = 'https://abcdefghij.supabase.co/functions/v1/x' } = {}) =>
    fn(new Request(url, {
        method,
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(origin ? { origin } : {}), ...headers },
        body: method === 'GET' || method === 'HEAD' ? undefined : body,
    }));

const prefRow = (userId, over = {}) => ({ user_id: userId, recipient_email: 'a@example.com', enabled: true, verified_email: null, verified_at: null, sent_for_month: null, failed_for_month: null, ...over });
const tokenFromText = (text) => /[#?&]t=([A-Za-z0-9_.-]+)/.exec(text)[1];

// ================================================================== email-verify
test('email-verify: refuses wrong method, anonymous callers and foreign websites', async () => {
    const { db } = setup();
    const { handle } = await handler('email-verify');
    const smtp = fakeSmtp();
    const run = (opts) => call((r) => handle(r, smtp.connector), opts);
    assert.equal((await run({ method: 'GET', token: 'tok-a' })).status, 405);
    assert.equal((await run({})).status, 401);
    assert.equal((await run({ token: 'bad-token' })).status, 401);
    const foreign = await run({ token: 'tok-a', origin: 'https://evil.example' });
    assert.equal(foreign.status, 403);
    assert.equal(foreign.headers.get('access-control-allow-origin'), null);
    const preflight = await run({ method: 'OPTIONS', token: 'tok-a' });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), SITE);
    assert.equal(smtp.state.opened, 0);
    assert.equal(db.counters.size, 0);
});

test('email-verify: sends one confirmation email to the saved address, with a working signed link', async () => {
    const { db } = setup();
    db.monthly_report_preferences.push(prefRow(A, { recipient_email: 'a@example.com' }));
    const { handle } = await handler('email-verify');
    const { verifyToken } = await shared('email-tokens');
    const smtp = fakeSmtp();
    const res = await call((r) => handle(r, smtp.connector), { token: 'tok-a' });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: 'sent' });
    assert.equal(res.headers.get('access-control-allow-origin'), SITE);
    assert.equal(smtp.state.opened, 1);
    assert.ok(smtp.transcript.includes('RCPT TO:<a@example.com>'));
    const { parts, headers } = parseMessage(smtp.state.message);
    assert.equal(headers.to, '<a@example.com>');
    const link = /(https:\/\/[^\s]+)/.exec(parts['text/plain'])[1];
    assert.ok(link.startsWith(`${SITE}/VinExpenses/email-action.html#a=confirm&t=`), link);
    const claim = await verifyToken(BASE_ENV.EMAIL_TOKEN_SECRET, tokenFromText(link), 'verify');
    assert.equal(claim.userId, A);
    assert.equal(claim.email, 'a@example.com');
    assert.ok(claim.expires * 1000 - Date.now() <= 48 * 3600 * 1000 + 1000);
    assert.equal(db.monthly_report_preferences[0].verified_email, null, 'nothing is verified until the link is used');
});

test('email-verify: needs a saved valid address, and does nothing when already confirmed', async () => {
    const { db } = setup();
    const { handle } = await handler('email-verify');
    const smtp = fakeSmtp();
    const run = () => call((r) => handle(r, smtp.connector), { token: 'tok-a' });
    assert.equal((await run()).status, 400, 'no saved row');
    db.monthly_report_preferences.push(prefRow(A, { recipient_email: 'not an address' }));
    assert.equal((await run()).status, 400, 'invalid saved address');
    db.monthly_report_preferences[0].recipient_email = 'a@example.com';
    db.monthly_report_preferences[0].verified_email = 'a@example.com';
    assert.deepEqual(await (await run()).json(), { status: 'verified' });
    assert.equal(smtp.state.opened, 0);
});

test('email-verify: per-user and per-address limits stop confirmation floods', async () => {
    const { db } = setup();
    db.monthly_report_preferences.push(prefRow(A, { recipient_email: 'victim@example.com' }));
    db.monthly_report_preferences.push(prefRow(B, { recipient_email: 'victim@example.com' }));
    const { handle } = await handler('email-verify');
    const smtp = fakeSmtp();
    const as = (token) => call((r) => handle(r, smtp.connector), { token });
    assert.equal((await as('tok-a')).status, 200);
    assert.equal((await as('tok-b')).status, 200);
    // The same victim address has now received 2 today: no account can send a third.
    const third = await as('tok-a');
    assert.equal(third.status, 429);
    assert.equal(smtp.state.opened, 2);
    assert.ok(![...db.counters.keys()].some((k) => k.includes('victim')), 'addresses are hashed in counter names');
});

test('email-verify: the app-wide daily cap is enforced', async () => {
    const { db } = setup({ EMAIL_DAILY_CAP: '1' });
    db.monthly_report_preferences.push(prefRow(A), prefRow(B, { recipient_email: 'b@example.com' }));
    const { handle } = await handler('email-verify');
    const smtp = fakeSmtp();
    assert.equal((await call((r) => handle(r, smtp.connector), { token: 'tok-a' })).status, 200);
    assert.equal((await call((r) => handle(r, smtp.connector), { token: 'tok-b' })).status, 429);
    assert.equal(smtp.state.opened, 1);
});

test('email-verify: fails CLOSED when the counter is down, and hides mail-server details on failure', async () => {
    const { db } = setup();
    db.monthly_report_preferences.push(prefRow(A));
    const { handle } = await handler('email-verify');
    const smtp = fakeSmtp();
    db.failures.add('rpc/consume_quota');
    assert.equal((await call((r) => handle(r, smtp.connector), { token: 'tok-a' })).status, 429);
    assert.equal(smtp.state.opened, 0);
    db.failures.clear();
    const broken = fakeSmtp({ reply: { auth: '535 5.7.8 Username and Password not accepted' } });
    const res = await call((r) => handle(r, broken.connector), { token: 'tok-a' });
    assert.equal(res.status, 502);
    const text = await res.text();
    assert.ok(!/535|Username|Gmail|password|abcd/i.test(text), text);
});

test('email-verify: reports "not set up" when mail settings are missing', async () => {
    const { db } = setup({ SMTP_PASS: undefined });
    db.monthly_report_preferences.push(prefRow(A));
    const { handle } = await handler('email-verify');
    const smtp = fakeSmtp();
    const res = await call((r) => handle(r, smtp.connector), { token: 'tok-a' });
    assert.equal(res.status, 503);
    assert.equal(smtp.state.opened, 0);
});

// ================================================================== email-action
async function freshToken(purpose, userId, email, ttl = 3600) {
    const { signToken } = await shared('email-tokens');
    return signToken(BASE_ENV.EMAIL_TOKEN_SECRET, purpose, userId, email, ttl);
}
const post = (handle, action, token, extra = {}) => call(handle, { body: JSON.stringify({ action, token }), ...extra });

test('email-action: confirming with a valid link verifies exactly that address', async () => {
    const { db } = setup();
    db.monthly_report_preferences.push(prefRow(A, { recipient_email: 'a@example.com' }), prefRow(B, { recipient_email: 'b@example.com' }));
    const { handle } = await handler('email-action');
    const res = await post(handle, 'confirm', await freshToken('verify', A, 'a@example.com'));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).ok, true);
    assert.equal(db.monthly_report_preferences[0].verified_email, 'a@example.com');
    assert.ok(db.monthly_report_preferences[0].verified_at);
    assert.equal(db.monthly_report_preferences[1].verified_email, null, 'other users untouched');
});

test('email-action: confirm is refused for expired, forged, wrong-purpose and out-of-date links', async () => {
    const { db } = setup();
    db.monthly_report_preferences.push(prefRow(A, { recipient_email: 'new@example.com' }));
    const { handle } = await handler('email-action');
    const expired = await freshToken('verify', A, 'new@example.com', -10);
    const stale = await freshToken('verify', A, 'old@example.com'); // address was changed after the email was sent
    const wrongPurpose = await freshToken('unsub', A, 'new@example.com');
    for (const token of [expired, stale, wrongPurpose, 'garbage', '', 'a.b', 'x'.repeat(900)]) {
        const res = await post(handle, 'confirm', token);
        assert.equal(res.status, 400, token.slice(0, 20));
        assert.equal((await res.json()).ok, false);
    }
    assert.equal(db.monthly_report_preferences[0].verified_email, null);
    assert.equal((await post(handle, 'confirm', 'x', { body: '{broken' })).status, 400);
    assert.equal((await post(handle, 'delete-everything', await freshToken('verify', A, 'new@example.com'))).status, 400);
});

test('email-action: unsubscribe works with a link click and with the mail app one-click button; repeating is harmless', async () => {
    const { db } = setup();
    db.monthly_report_preferences.push(prefRow(A, { verified_email: 'a@example.com', enabled: true }), prefRow(B, { verified_email: 'b@example.com', recipient_email: 'b@example.com' }));
    const { handle } = await handler('email-action');
    const token = await freshToken('unsub', A, 'a@example.com');
    assert.equal((await post(handle, 'unsub', token)).status, 200);
    assert.equal(db.monthly_report_preferences[0].enabled, false);
    assert.equal(db.monthly_report_preferences[1].enabled, true, 'other users untouched');
    db.monthly_report_preferences[0].enabled = true;
    const oneClick = await call(handle, {
        origin: null, headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click',
        url: `https://abcdefghij.supabase.co/functions/v1/email-action?a=unsub&t=${token}`,
    });
    assert.equal(oneClick.status, 200);
    assert.equal(db.monthly_report_preferences[0].enabled, false);
    assert.equal((await post(handle, 'unsub', token)).status, 200, 'second click still succeeds');
});

test('email-action: one-click cannot be used to confirm, needs its marker, and an old-address link cannot switch off the new address', async () => {
    const { db } = setup();
    db.monthly_report_preferences.push(prefRow(A, { recipient_email: 'new@example.com', verified_email: 'new@example.com', enabled: true }));
    const { handle } = await handler('email-action');
    const verifyToken_ = await freshToken('verify', A, 'new@example.com');
    const url = (a, t) => `https://abcdefghij.supabase.co/functions/v1/email-action?a=${a}&t=${t}`;
    const form = (u, body = 'List-Unsubscribe=One-Click') => call(handle, { origin: null, headers: { 'content-type': 'application/x-www-form-urlencoded' }, body, url: u });
    assert.equal((await form(url('confirm', verifyToken_))).status, 400);
    assert.equal((await form(url('unsub', await freshToken('unsub', A, 'new@example.com')), 'something=else')).status, 400);
    assert.equal(db.monthly_report_preferences[0].enabled, true);
    const oldToken = await freshToken('unsub', A, 'old@example.com');
    assert.equal((await post(handle, 'unsub', oldToken)).status, 200);
    assert.equal(db.monthly_report_preferences[0].enabled, true, 'the new address stays subscribed');
});

test('email-action: a GET only redirects to the website and never changes anything', async () => {
    const { db } = setup();
    db.monthly_report_preferences.push(prefRow(A, { verified_email: 'a@example.com' }));
    const before = JSON.stringify(db.monthly_report_preferences);
    const { handle } = await handler('email-action');
    const token = await freshToken('unsub', A, 'a@example.com');
    const res = await call(handle, { method: 'GET', origin: null, url: `https://abcdefghij.supabase.co/functions/v1/email-action?a=unsub&t=${token}` });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), `${SITE}/VinExpenses/email-action.html#a=unsub&t=${token}`);
    assert.equal(JSON.stringify(db.monthly_report_preferences), before);
    assert.equal(db.requests.filter((r) => r.method !== 'GET').length, 0);
    for (const bad of ['?a=delete&t=' + token, '?a=unsub&t=short', '?a=unsub&t=' + 'x%0d%0aSet-Cookie:y'.repeat(2), '']) {
        const r = await call(handle, { method: 'GET', origin: null, url: 'https://abcdefghij.supabase.co/functions/v1/email-action' + bad });
        assert.equal(r.status, 400, bad);
    }
});

test('email-action: oversized bodies, other methods and foreign websites are refused; unconfigured is a safe 503', async () => {
    setup();
    const { handle } = await handler('email-action');
    assert.equal((await call(handle, { body: 'x'.repeat(5000) })).status, 413);
    assert.equal((await call(handle, { method: 'PUT' })).status, 405);
    assert.equal((await post(handle, 'confirm', 'abcdefghijkl', { origin: 'https://evil.example' })).status, 403);
    setup({ EMAIL_TOKEN_SECRET: 'short' });
    assert.equal((await post(handle, 'confirm', 'abcdefghijkl')).status, 503);
});

// ================================================================== monthly-report-email
const NOW = new Date('2026-11-01T01:00:00Z'); // 09:00 on 1 November in Kuala Lumpur
const cron = (over = {}) => ({ origin: null, headers: { 'x-cron-secret': BASE_ENV.MONTHLY_REPORT_CRON_SECRET, ...over }, body: '{}' });

function seedReport(db) {
    db.monthly_report_preferences.push(
        prefRow(A, { recipient_email: 'a@example.com', verified_email: 'a@example.com' }),
        prefRow(B, { recipient_email: 'b@example.com', verified_email: null }),                       // never confirmed
        prefRow(C, { recipient_email: 'new@example.com', verified_email: 'old@example.com' }),         // changed after confirming
        prefRow(D, { recipient_email: 'd@example.com', verified_email: 'd@example.com', enabled: false }), // switched off
    );
    db.user_categories.push({ user_id: A, category_key: 'food', label: '<b>Food & Drink</b>' });
    const add = (table, amount, at, category = 'food') => db[table].push({ id: `${table}-${db[table].length}`, user_id: A, amount: String(amount), category, created_at: at });
    add('expenses', 10.5, '2026-09-30T16:00:00Z');            // exactly 00:00 on 1 Oct in KL: included
    add('expenses', 20, '2026-10-15T00:00:00Z');
    add('expenses', 30, '2026-10-31T15:59:59Z', 'fuel');      // last second of October in KL: included
    add('expenses', 999, '2026-10-31T16:00:00Z');             // 1 Nov in KL: excluded
    add('expenses', 888, '2026-09-30T15:59:59Z');             // 30 Sep in KL: excluded
    add('incomes', 5000, '2026-10-02T00:00:00Z');
    db.expenses.push({ id: 'other', user_id: B, amount: '777', category: 'food', created_at: '2026-10-05T00:00:00Z' });
}

test('monthly: only the scheduler can start it', async () => {
    const { db } = setup();
    const { handle } = await handler('monthly-report-email');
    const smtp = fakeSmtp();
    const run = (opts) => call((r) => handle(r, NOW, smtp.connector), opts);
    assert.equal((await run({ method: 'GET', origin: null })).status, 405);
    assert.equal((await run({ origin: null })).status, 401);
    assert.equal((await run({ origin: null, headers: { 'x-cron-secret': 'wrong' } })).status, 401);
    assert.equal((await run({ origin: null, headers: { 'x-cron-secret': BASE_ENV.MONTHLY_REPORT_CRON_SECRET + 'x' } })).status, 401);
    assert.equal((await run({ origin: null, headers: { 'x-cron-secret': 'Bearer tok-a' } })).status, 401);
    setup({ MONTHLY_REPORT_CRON_SECRET: undefined });
    assert.equal((await run({ origin: null, headers: { 'x-cron-secret': '' } })).status, 503, 'an unset secret never means "anyone"');
    assert.equal(smtp.state.opened, 0);
    assert.equal(db.requests.filter((r) => r.path.includes('monthly_report')).length, 0);
});

test('monthly: runs only on the 1st in Kuala Lumpur time, and reports the previous month (also across New Year)', async () => {
    const { db } = setup();
    seedReport(db);
    const { handle } = await handler('monthly-report-email');
    const smtp = fakeSmtp();
    const at = (iso) => call((r) => handle(r, new Date(iso), smtp.connector), cron());
    assert.match((await (await at('2026-11-02T01:00:00Z')).json()).message, /first day/);
    assert.match((await (await at('2026-11-01T16:30:00Z')).json()).message, /first day/, '00:30 on 2 Nov in KL');
    assert.equal(smtp.state.opened, 0);
    const midnight = await (await at('2026-10-31T16:30:00Z')).json(); // 00:30 on 1 Nov in KL
    assert.equal(midnight.reportMonth, '2026-10');
    assert.equal(midnight.sent, 1);
    db.monthly_report_preferences.forEach((r) => { r.sent_for_month = null; });
    assert.equal((await (await at('2027-01-01T02:00:00Z')).json()).reportMonth, '2026-12');
});

test('monthly: sends only to confirmed, still-current, enabled addresses, with correct totals', async () => {
    const { db } = setup();
    seedReport(db);
    const { handle } = await handler('monthly-report-email');
    const smtp = fakeSmtp();
    const res = await call((r) => handle(r, NOW, smtp.connector), cron());
    assert.deepEqual(await res.json(), { reportMonth: '2026-10', sent: 1, skipped: 1, failed: 0 }); // skipped = the user whose address changed after confirming
    assert.equal(smtp.state.opened, 1);
    assert.deepEqual(smtp.transcript.filter((l) => l.startsWith('RCPT')), ['RCPT TO:<a@example.com>']);
    const { headers, parts } = parseMessage(smtp.state.message);
    assert.match(parts['text/plain'], /Income:\s+RM\s?5,000\.00 \(1 records\)/);
    assert.match(parts['text/plain'], /Expenses:\s+RM\s?60\.50 \(3 records\)/);
    assert.match(parts['text/plain'], /Net:\s+RM\s?4,939\.50/);
    assert.ok(!parts['text/html'].includes('<b>Food'), 'category label is escaped');
    assert.ok(parts['text/html'].includes('&lt;b&gt;Food &amp; Drink&lt;/b&gt;'));
    assert.match(headers.subject.replace(/\s/g, ''), /^Your|=\?UTF-8/);
    const pref = (id) => db.monthly_report_preferences.find((r) => r.user_id === id);
    assert.equal(pref(A).sent_for_month, '2026-10-01');
    assert.equal(pref(B).sent_for_month, null);
    assert.equal(pref(C).sent_for_month, null);
    // The one-click unsubscribe header carries a valid token for exactly this user and address.
    const { verifyToken } = await shared('email-tokens');
    const link = /^<(https:\/\/abcdefghij\.supabase\.co\/functions\/v1\/email-action\?a=unsub&t=([A-Za-z0-9_.-]+))>$/.exec(headers['list-unsubscribe']);
    assert.ok(link, headers['list-unsubscribe']);
    const claim = await verifyToken(BASE_ENV.EMAIL_TOKEN_SECRET, link[2], 'unsub');
    assert.equal(claim.userId, A);
    assert.equal(claim.email, 'a@example.com');
    assert.equal(headers['list-unsubscribe-post'], 'List-Unsubscribe=One-Click');
    assert.match(parts['text/plain'], new RegExp(`Unsubscribe: ${SITE}/VinExpenses/email-action\\.html#a=unsub&t=`));
});

test('monthly: running again the same month sends nothing (no duplicates)', async () => {
    const { db } = setup();
    seedReport(db);
    const { handle } = await handler('monthly-report-email');
    const smtp = fakeSmtp();
    await call((r) => handle(r, NOW, smtp.connector), cron());
    const again = await (await call((r) => handle(r, NOW, smtp.connector), cron())).json();
    assert.equal(again.sent, 0);
    assert.equal(smtp.state.opened, 1);
});

test('monthly: two overlapping runs can not both claim the same user', async () => {
    const { db } = setup();
    seedReport(db);
    const { handle } = await handler('monthly-report-email');
    const smtp = fakeSmtp();
    const runs = await Promise.all([1, 2, 3].map(() => call((r) => handle(r, NOW, smtp.connector), cron()).then((r) => r.json())));
    assert.equal(runs.reduce((n, r) => n + r.sent, 0), 1);
    assert.equal(smtp.state.opened, 1);
});

test('monthly: totals stay correct for users with more than 1,000 rows', async () => {
    const { db } = setup();
    db.monthly_report_preferences.push(prefRow(A, { recipient_email: 'a@example.com', verified_email: 'a@example.com' }));
    for (let i = 0; i < 2500; i++) db.expenses.push({ id: `e${String(i).padStart(5, '0')}`, user_id: A, amount: '2.00', category: 'food', created_at: '2026-10-10T00:00:00Z' });
    const { handle } = await handler('monthly-report-email');
    const smtp = fakeSmtp();
    await call((r) => handle(r, NOW, smtp.connector), cron());
    const { parts } = parseMessage(smtp.state.message);
    assert.match(parts['text/plain'], /Expenses:\s+RM\s?5,000\.00 \(2500 records\)/);
});

test('monthly: a temporary failure is retried later; a permanent one is not', async () => {
    const { db } = setup();
    db.monthly_report_preferences.push(prefRow(A, { recipient_email: 'a@example.com', verified_email: 'a@example.com' }));
    const { handle } = await handler('monthly-report-email');
    const pref = db.monthly_report_preferences[0];
    const temp = fakeSmtp({ reply: { rcpt: '452 4.2.2 mailbox full' } });
    assert.equal((await (await call((r) => handle(r, NOW, temp.connector), cron())).json()).failed, 1);
    assert.equal(pref.sent_for_month, null, 'released so the next hourly run tries again');
    assert.equal(pref.failed_for_month, null);
    const perm = fakeSmtp({ reply: { rcpt: '550 5.1.1 no such user' } });
    assert.equal((await (await call((r) => handle(r, NOW, perm.connector), cron())).json()).failed, 1);
    assert.equal(pref.sent_for_month, null);
    assert.equal(pref.failed_for_month, '2026-10-01');
    const next = fakeSmtp();
    assert.equal((await (await call((r) => handle(r, NOW, next.connector), cron())).json()).sent, 0);
    assert.equal(next.state.opened, 0, 'a permanently failing address is not retried every hour');
});

test('monthly: a rejected Gmail login stops the whole run immediately', async () => {
    const { db } = setup();
    for (const [id, mail] of [[A, 'a@example.com'], [B, 'b@example.com'], [C, 'c@example.com']]) {
        db.monthly_report_preferences.push(prefRow(id, { recipient_email: mail, verified_email: mail }));
    }
    const { handle } = await handler('monthly-report-email');
    const smtp = fakeSmtp({ reply: { auth: '535 5.7.8 rejected' } });
    const out = await (await call((r) => handle(r, NOW, smtp.connector), cron())).json();
    assert.equal(smtp.state.opened, 1, 'no further login attempts after the first rejection');
    assert.equal(out.failed, 1);
    assert.match(out.stopped, /admin email test/);
    assert.ok(db.monthly_report_preferences.every((r) => r.sent_for_month === null), 'everyone released for a later run');
});

test('monthly: the daily cap and the batch size limit how many emails go out', async () => {
    const { db } = setup({ EMAIL_DAILY_CAP: '2', MONTHLY_REPORT_BATCH: '25' });
    for (const [id, mail] of [[A, 'a@example.com'], [B, 'b@example.com'], [C, 'c@example.com']]) {
        db.monthly_report_preferences.push(prefRow(id, { recipient_email: mail, verified_email: mail }));
    }
    const { handle } = await handler('monthly-report-email');
    const smtp = fakeSmtp();
    const out = await (await call((r) => handle(r, NOW, smtp.connector), cron())).json();
    assert.equal(out.sent, 2);
    assert.match(out.stopped, /daily email limit/);
    assert.equal(db.monthly_report_preferences.filter((r) => r.sent_for_month === null).length, 1, 'the third is left for tomorrow');
    const small = setup({ MONTHLY_REPORT_BATCH: '1' });
    for (const [id, mail] of [[A, 'a@example.com'], [B, 'b@example.com']]) {
        small.db.monthly_report_preferences.push(prefRow(id, { recipient_email: mail, verified_email: mail }));
    }
    const smtp2 = fakeSmtp();
    assert.equal((await (await call((r) => handle(r, NOW, smtp2.connector), cron())).json()).sent, 1);
});

test('monthly: unreachable database answers with a plain error and sends nothing', async () => {
    const { db } = setup();
    seedReport(db);
    db.failures.add('monthly_report_preferences');
    const { handle } = await handler('monthly-report-email');
    const smtp = fakeSmtp();
    const res = await call((r) => handle(r, NOW, smtp.connector), cron());
    assert.equal(res.status, 502);
    assert.equal(smtp.state.opened, 0);
});

// ================================================================== admin-email-test
test('admin: refuses anonymous callers, other websites and bad requests', async () => {
    const { db } = setup();
    const { handle } = await handler('admin-email-test');
    const smtp = fakeSmtp();
    const run = (opts) => call((r) => handle(r, smtp.connector), opts);
    assert.equal((await run({ body: '{"action":"status"}' })).status, 401);
    assert.equal((await run({ token: 'tok-boss', origin: 'https://evil.example', body: '{"action":"status"}' })).status, 403);
    assert.equal((await run({ token: 'tok-boss', body: '{"action":"format-disk"}' })).status, 400);
    assert.equal((await run({ token: 'tok-boss', body: 'nope' })).status, 400);
    assert.equal((await run({ method: 'GET', token: 'tok-boss' })).status, 405);
    assert.equal(db.app_admins.length, 0);
});

test('admin: with no administrator yet, the ADMIN_EMAIL account becomes the first one automatically', async () => {
    const { db } = setup();
    const { handle } = await handler('admin-email-test');
    const smtp = fakeSmtp();
    const as = (token, action = 'status') => call((r) => handle(r, smtp.connector), { token, body: JSON.stringify({ action }) });
    assert.deepEqual(await (await as('tok-a')).json(), { admin: false }, 'ordinary users just see "not admin"');
    assert.equal((await as('tok-a', 'send_test')).status, 403);
    assert.deepEqual(await (await as('tok-unconfirmed-boss')).json(), { admin: false }, 'an unconfirmed email can not claim admin');
    assert.equal(db.app_admins.length, 0);
    const first = await (await as('tok-boss')).json();
    assert.equal(first.admin, true);
    assert.equal(first.justCreated, true);
    assert.deepEqual(db.app_admins, [{ user_id: BOSS }]);
    const again = await (await as('tok-boss')).json();
    assert.equal(again.admin, true);
    assert.equal(again.justCreated, false);
    assert.equal(db.app_admins.length, 1);
});

test('admin: once an administrator exists nobody else can become one, even with the same ADMIN_EMAIL', async () => {
    const { db } = setup();
    db.app_admins.push({ user_id: A });
    const { handle } = await handler('admin-email-test');
    const smtp = fakeSmtp();
    const as = (token, action) => call((r) => handle(r, smtp.connector), { token, body: JSON.stringify({ action }) });
    assert.deepEqual(await (await as('tok-boss', 'status')).json(), { admin: false });
    assert.equal(db.app_admins.length, 1);
    assert.equal((await as('tok-a', 'status').then((r) => r.json())).admin, true, 'pre-registered administrator, no ADMIN_EMAIL needed');
    assert.equal((await as('tok-boss', 'send_test')).status, 403);
    assert.equal(smtp.state.opened, 0);
});

test('admin: without ADMIN_EMAIL nobody can claim administrator', async () => {
    const { db } = setup({ ADMIN_EMAIL: undefined });
    const { handle } = await handler('admin-email-test');
    const smtp = fakeSmtp();
    assert.deepEqual(await (await call((r) => handle(r, smtp.connector), { token: 'tok-boss', body: '{"action":"status"}' })).json(), { admin: false });
    assert.equal(db.app_admins.length, 0);
});

test('admin: send_test delivers a real message to the administrator ONLY, and reports each check', async () => {
    const { db } = setup();
    const { handle } = await handler('admin-email-test');
    const smtp = fakeSmtp();
    const res = await call((r) => handle(r, smtp.connector), { token: 'tok-boss', body: '{"action":"send_test"}' });
    assert.equal(res.status, 200);
    const out = await res.json();
    assert.equal(out.ok, true);
    assert.equal(out.stage, 'delivered');
    assert.equal(out.sentTo, 'boss@gmail.com');
    assert.deepEqual(smtp.transcript.filter((l) => l.startsWith('RCPT')), ['RCPT TO:<boss@gmail.com>']);
    assert.ok(Object.values(out.checks).every(Boolean), JSON.stringify(out.checks));
    assert.equal(db.app_admins.length, 1);
    assert.ok(!JSON.stringify(out).includes('abcdefghijklmnop'));
    // A request body can not redirect the test mail anywhere else.
    const smtp2 = fakeSmtp();
    await call((r) => handle(r, smtp2.connector), { token: 'tok-boss', body: JSON.stringify({ action: 'send_test', to: 'victim@example.com', recipient: 'victim@example.com' }) });
    assert.deepEqual(smtp2.transcript.filter((l) => l.startsWith('RCPT')), ['RCPT TO:<boss@gmail.com>']);
});

test('admin: pinpoints where the email service is broken, without leaking secrets', async () => {
    setup();
    const { handle } = await handler('admin-email-test');
    const run = async (reply) => (await call((r) => handle(r, fakeSmtp({ reply }).connector), { token: 'tok-boss', body: '{"action":"send_test"}' })).json();
    const auth = await run({ auth: '535 5.7.8 Username and Password not accepted' });
    assert.equal(auth.ok, false);
    assert.equal(auth.stage, 'auth');
    assert.equal(auth.code, 535);
    assert.match(auth.reason, /App Password/);
    assert.ok(!/Username|abcd/.test(JSON.stringify(auth)));
    assert.equal((await run({ rcpt: '550 nope' })).stage, 'recipient');
    assert.equal((await run({ end: '550 5.4.5 limit' })).stage, 'send');
    const refused = await (await call((r) => handle(r, fakeSmtp({ refuse: true }).connector), { token: 'tok-boss', body: '{"action":"send_test"}' })).json();
    assert.equal(refused.stage, 'connect');
});

test('admin: missing settings are reported by name; tokens and site checks turn red when wrong', async () => {
    setup({ SMTP_PASS: undefined, SITE_URL: 'http://not-https.example', EMAIL_TOKEN_SECRET: 'short' });
    const { handle } = await handler('admin-email-test');
    const smtp = fakeSmtp();
    const out = await (await call((r) => handle(r, smtp.connector), { token: 'tok-boss', body: '{"action":"send_test"}' })).json();
    assert.equal(out.ok, false);
    assert.equal(out.stage, 'config');
    assert.match(out.reason, /SMTP_PASS/);
    assert.equal(out.checks['Gmail account and App Password (SMTP_USER, SMTP_PASS)'], false);
    assert.equal(out.checks['Link-signing secret (EMAIL_TOKEN_SECRET)'], false);
    assert.equal(out.checks['Website address (SITE_URL)'], false);
    assert.equal(smtp.state.opened, 0);
});

test('admin: at most 10 test emails per day, and a counter outage stops tests instead of allowing unlimited', async () => {
    const { db } = setup();
    const { handle } = await handler('admin-email-test');
    const smtp = fakeSmtp();
    const send = () => call((r) => handle(r, smtp.connector), { token: 'tok-boss', body: '{"action":"send_test"}' });
    for (let i = 0; i < 10; i++) assert.equal((await send()).status, 200);
    assert.equal((await send()).status, 429);
    assert.equal(smtp.state.opened, 10);
    db.counters.clear();
    db.failures.add('rpc/consume_quota');
    assert.equal((await send()).status, 429);
});

test('admin: a database without the new tables gives a clear error, not a crash', async () => {
    const { db } = setup();
    db.failures.add('app_admins');
    const { handle } = await handler('admin-email-test');
    const res = await call((r) => handle(r, fakeSmtp().connector), { token: 'tok-boss', body: '{"action":"status"}' });
    assert.equal(res.status, 503);
});

// ================================================================== nearby-place
async function loadNearby() {
    let served;
    globalThis.Deno.serve = (fn) => { served = fn; };
    await import(`../supabase/functions/nearby-place/index.ts?run=${Math.random()}`);
    return served;
}

test('nearby-place: needs a signed-in user, allowed website and has a daily limit', async () => {
    const { db } = setup({ NEARBY_DAILY_LIMIT: '2' });
    const upstream = [];
    const supabaseFetch = db.fetch;
    globalThis.fetch = async (input, init) => {
        const url = new URL(input instanceof URL || typeof input === 'string' ? String(input) : input.url);
        if (url.hostname === 'nominatim.openstreetmap.org') {
            upstream.push(url.href);
            return new Response(JSON.stringify({ name: 'Kedai Runcit Ali', address: {} }), { status: 200 });
        }
        return supabaseFetch(input, init);
    };
    const serve = await loadNearby();
    const body = JSON.stringify({ latitude: 3.14, longitude: 101.69 });
    assert.equal((await call(serve, { body })).status, 401, 'anonymous');
    assert.equal((await call(serve, { token: 'tok-a', body, origin: 'https://evil.example' })).status, 403);
    assert.equal(upstream.length, 0, 'nothing is relayed for anonymous or foreign callers');
    const ok = await call(serve, { token: 'tok-a', body });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { name: 'Kedai Runcit Ali' });
    assert.equal((await call(serve, { token: 'tok-a', body: JSON.stringify({ latitude: 99, longitude: 0 }) })).status, 400);
    assert.equal((await call(serve, { token: 'tok-a', body })).status, 429, 'daily limit');
    assert.equal(upstream.length, 1);
    assert.equal((await call(serve, { token: 'tok-b', body })).status, 200, 'limits are per user');
});
