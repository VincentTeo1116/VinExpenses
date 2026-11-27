// Tests the admin dashboard's server side, the feedback form and report delivery (Telegram or email, resend limits).
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeSmtp, parseMessage, fakeSupabase } = require('./helpers/fakes.js');

const SITE = 'https://me.github.io';
const ENV = {
    SUPABASE_URL: 'https://abcdefghij.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-key', SUPABASE_ANON_KEY: 'anon-key', ALLOWED_ORIGINS: SITE,
    SMTP_USER: 'sender@gmail.com', SMTP_PASS: 'abcd efgh ijkl mnop', EMAIL_TOKEN_SECRET: 'T'.repeat(40), SITE_URL: `${SITE}/VinExpenses`,
    MONTHLY_REPORT_CRON_SECRET: 'cron-secret-with-24-or-more-chars', ADMIN_EMAIL: 'boss@gmail.com', TELEGRAM_BOT_TOKEN: '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij',
};
const NOW = new Date('2026-11-10T02:00:00Z'); // 10:00 on 10 November in Kuala Lumpur
const BOSS = 'eeeeeeee-0000-4000-8000-000000000005';
const handler = (fn) => import(`../supabase/functions/${fn}/handler.ts`);

function world(extraEnv = {}) {
    const env = { ...ENV, ...extraEnv };
    for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
    globalThis.Deno = { env: { get: (name) => env[name] } };
    const db = fakeSupabase();
    db.now = () => NOW.toISOString();
    db.nextCode = '123456';
    globalThis.fetch = db.fetch;
    const person = (email, extra = {}) => {
        const a = { id: crypto.randomUUID(), email, password: 'Str0ng!Passw0rd', confirmed: true, banned: false, metadata: { username: email.split('@')[0] }, factors: [], codes: {}, created_at: '2026-10-01T00:00:00Z', ...extra };
        db.accounts.push(a);
        return a;
    };
    const boss = person('boss@gmail.com', { id: BOSS, created_at: '2026-01-01T00:00:00Z' });
    const amy = person('amy@example.com', { created_at: '2026-10-05T00:00:00Z' });
    const ben = person('ben@example.com', { created_at: '2026-10-09T00:00:00Z', factors: [{ id: 'f1', status: 'verified' }] });
    db.app_admins.push({ user_id: BOSS });
    db.addUser('tok-boss', BOSS, 'boss@gmail.com');
    db.addUser('tok-amy', amy.id, 'amy@example.com');
    // a recording Telegram
    const tg = { sent: [], result: 'ok', client: null };
    tg.client = {
        sendChecked: async (chatId, html, options) => { tg.sent.push({ chatId, html, buttons: options && options.buttons }); return tg.result; },
        sendPhotoChecked: async (chatId, png, caption) => { tg.sent.push({ chatId, html: caption, photo: true }); return tg.result; },
    };
    return { db, boss, amy, ben, tg, env };
}
test.afterEach(() => { delete globalThis.Deno; });

const post = (fn, body, { token = 'tok-boss', origin = SITE, ip = '1.2.3.4' } = {}) => fn(new Request('https://abcdefghij.supabase.co/functions/v1/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(origin ? { origin } : {}), 'x-forwarded-for': ip },
    body: JSON.stringify(body),
}));
async function admin(ctx, body, options = {}) {
    const { handle } = await handler('admin');
    const smtp = options.smtp || fakeSmtp();
    const res = await post((r) => handle(r, NOW, smtp.connector, ctx.tg.client), body, options);
    return { status: res.status, body: await res.json(), smtp };
}

// Admin Access Section
test('admin: only an administrator gets in, and it is checked on the server for every action', async () => {
    const ctx = world();
    for (const action of ['list', 'disable', 'block', 'resend_report', 'feedback_list', 'log', 'health']) {
        const res = await admin(ctx, { action, userId: ctx.ben.id }, { token: 'tok-amy' });
        assert.equal(res.status, 403, action);
    }
    assert.equal((await admin(ctx, { action: 'list' }, { token: null })).status, 401);
    assert.equal((await admin(ctx, { action: 'list' }, { origin: 'https://evil.example' })).status, 403);
    assert.equal((await admin(ctx, { action: 'make_me_admin' })).status, 400);
    assert.equal(ctx.ben.banned, false);
    assert.equal(ctx.db.admin_audit_log.length, 0);
});

test('admin list: status, last activity, Telegram and authenticator, but never an amount or a record', async () => {
    const ctx = world();
    ctx.db.expenses.push(
        { id: 'e1', user_id: ctx.amy.id, amount: '4321.99', category: 'food', merchant: 'Secret Cafe', created_at: '2026-11-08T05:00:00Z' },
        { id: 'e2', user_id: ctx.amy.id, amount: '10', category: 'food', merchant: 'Older', created_at: '2026-11-01T05:00:00Z' },
    );
    ctx.db.telegram_links.push({ chat_id: 1, user_id: ctx.amy.id });
    ctx.ben.banned = true;
    const { body } = await admin(ctx, { action: 'list' });
    assert.equal(body.total, 3);
    assert.deepEqual(body.counts, { all: 3, disabled: 1, blocked: 0 });
    const row = (email) => body.users.find((u) => u.email === email);
    assert.deepEqual([row('amy@example.com').status, row('amy@example.com').telegram, row('amy@example.com').authenticator, row('amy@example.com').lastExpenseAt],
        ['active', true, false, '2026-11-08T05:00:00Z']);
    assert.deepEqual([row('ben@example.com').status, row('ben@example.com').authenticator, row('ben@example.com').lastExpenseAt], ['disabled', true, null]);
    assert.deepEqual([row('boss@gmail.com').isAdmin, row('boss@gmail.com').isYou], [true, true]);
    const text = JSON.stringify(body);
    assert.ok(!/4321|Secret Cafe|merchant|amount|password/i.test(text), 'no expense data and no passwords leave the server');

    assert.deepEqual((await admin(ctx, { action: 'list', search: 'AMY' })).body.users.map((u) => u.email), ['amy@example.com']);
    assert.deepEqual((await admin(ctx, { action: 'list', status: 'disabled' })).body.users.map((u) => u.email), ['ben@example.com']);
});

test('admin: disable and enable, with self and other administrators protected, and every action logged', async () => {
    const ctx = world();
    const off = await admin(ctx, { action: 'disable', userId: ctx.amy.id });
    assert.equal(off.body.ok, true);
    assert.equal(ctx.amy.banned, true);
    assert.equal((await admin(ctx, { action: 'enable', userId: ctx.amy.id })).body.ok, true);
    assert.equal(ctx.amy.banned, false);
    const self = await admin(ctx, { action: 'disable', userId: BOSS });
    assert.deepEqual([self.body.ok, ctx.boss.banned], [false, false]);
    assert.match(self.body.message, /your own account/);
    assert.equal((await admin(ctx, { action: 'disable', userId: 'not-a-uuid' })).body.ok, false);
    assert.equal((await admin(ctx, { action: 'disable', userId: crypto.randomUUID() })).body.ok, false);
    assert.deepEqual(ctx.db.admin_audit_log.map((r) => [r.admin_id, r.action, r.target_user, r.detail]),
        [[BOSS, 'disable_account', ctx.amy.id, 'amy@example.com'], [BOSS, 'enable_account', ctx.amy.id, 'amy@example.com']]);
});

test('admin: if the action can not be logged, it is not done', async () => {
    const ctx = world();
    ctx.db.failures.add('admin_audit_log');
    const res = await admin(ctx, { action: 'disable', userId: ctx.amy.id });
    assert.equal(res.status, 503);
    assert.equal(ctx.amy.banned, false);
});

test('admin: block and unblock sign-in, and clear the monthly code limit', async () => {
    const ctx = world();
    const gate = await handler('auth-gate');
    const signIn = async () => (await (await gate.handle(new Request('https://x/f', {
        method: 'POST', headers: { 'content-type': 'application/json', origin: SITE, 'x-forwarded-for': '7.7.7.7' },
        body: JSON.stringify({ action: 'signin', email: 'amy@example.com', password: 'Str0ng!Passw0rd', device: 'device-aaaaaaaaaaaaaaaa' }),
    }), NOW)).json());

    assert.equal((await admin(ctx, { action: 'block', userId: ctx.amy.id })).body.ok, true);
    assert.deepEqual(await signIn().then((r) => [r.code, r.manual]), ['blocked', true]);
    const listed = (await admin(ctx, { action: 'list', status: 'blocked' })).body.users;
    assert.deepEqual(listed.map((u) => [u.email, u.block.manual]), [['amy@example.com', true]]);
    assert.equal((await admin(ctx, { action: 'unblock', userId: ctx.amy.id })).body.ok, true);
    assert.equal((await signIn()).ok, true);
    assert.equal((await admin(ctx, { action: 'block', userId: BOSS })).body.ok, false, 'an admin can not block themselves');

    for (let i = 0; i < 11; i++) ctx.db.auth_code_requests.push({ id: 100 + i, email: 'amy@example.com', purpose: 'recovery', sent_at: '2026-11-05T00:00:00Z' });
    ctx.db.auth_code_requests.push({ id: 200, email: 'ben@example.com', purpose: 'recovery', sent_at: '2026-11-05T00:00:00Z' });
    const before = (await admin(ctx, { action: 'list', search: 'amy' })).body.users[0];
    assert.deepEqual([before.codesThisMonth, before.codeLimited], [11, true]);
    assert.equal((await admin(ctx, { action: 'clear_codes', userId: ctx.amy.id })).body.ok, true);
    assert.deepEqual(ctx.db.auth_code_requests.map((r) => r.email), ['ben@example.com'], 'only that person, only this month');
});

test('admin: a password reset goes to the person, and the code never comes back to the admin', async () => {
    const ctx = world();
    const res = await admin(ctx, { action: 'send_reset', userId: ctx.amy.id });
    assert.equal(res.body.ok, true);
    assert.ok(!JSON.stringify(res.body).includes('123456'), 'the admin never sees the code');
    assert.deepEqual(res.smtp.transcript.filter((l) => l.startsWith('RCPT')), ['RCPT TO:<amy@example.com>']);
    const { parts } = parseMessage(res.smtp.state.message);
    assert.match(parts['text/plain'], /123456/);
    assert.match(parts['text/html'], /123456/);
    assert.ok(!parts['text/html'].includes('{{'), 'no unfilled placeholder is emailed');
    assert.equal(ctx.amy.password, 'Str0ng!Passw0rd', 'the password itself is untouched');

    const gate = await handler('auth-gate');
    const reset = await (await gate.handle(new Request('https://x/f', {
        method: 'POST', headers: { 'content-type': 'application/json', origin: SITE },
        body: JSON.stringify({ action: 'reset', email: 'amy@example.com', code: '123456', password: 'N3w!Passw0rd#' }),
    }), NOW)).json();
    assert.equal(reset.ok, true, 'the emailed code works in the normal reset screen');
    for (let i = 0; i < 2; i++) await admin(ctx, { action: 'send_reset', userId: ctx.amy.id });
    assert.equal((await admin(ctx, { action: 'send_reset', userId: ctx.amy.id })).body.ok, false, 'at most 3 a day per person');
});

test('admin: resetting an authenticator removes it and its recovery codes', async () => {
    const ctx = world();
    ctx.db.mfa_recovery_codes.push({ id: 1, user_id: ctx.ben.id, code_hash: 'x', used_at: null }, { id: 2, user_id: ctx.amy.id, code_hash: 'y', used_at: null });
    assert.equal((await admin(ctx, { action: 'reset_authenticator', userId: ctx.ben.id })).body.ok, true);
    assert.equal(ctx.ben.factors.length, 0);
    assert.deepEqual(ctx.db.mfa_recovery_codes.map((r) => r.user_id), [ctx.amy.id]);
});

// Report Delivery Section
const pref = (userId, extra = {}) => ({ user_id: userId, recipient_email: 'amy@example.com', verified_email: 'amy@example.com', enabled: true, channel: 'auto', sent_for_month: null, failed_for_month: null, resend_count: 0, ...extra });
const spend = (db, userId, amount, at) => db.expenses.push({ id: crypto.randomUUID(), user_id: userId, amount: String(amount), category: 'food', payment: 'bank', merchant: 'Cafe', created_at: at });

test('admin: resending a report sends it to the person and returns only whether it went', async () => {
    const ctx = world();
    ctx.db.monthly_report_preferences.push(pref(ctx.amy.id));
    spend(ctx.db, ctx.amy.id, 987.65, '2026-10-10T04:00:00Z');
    const res = await admin(ctx, { action: 'resend_report', userId: ctx.amy.id, month: '2026-10' });
    assert.equal(res.body.ok, true);
    assert.match(res.body.message, /October 2026 report was sent to this person by email/);
    assert.ok(!/987|Cafe/.test(JSON.stringify(res.body)), 'the report content is never returned');
    assert.deepEqual(res.smtp.transcript.filter((l) => l.startsWith('RCPT')), ['RCPT TO:<amy@example.com>']);
    assert.match(parseMessage(res.smtp.state.message).parts['text/plain'], /987\.65/);
    assert.equal(ctx.db.admin_audit_log.at(-1).action, 'resend_report');

    assert.equal((await admin(ctx, { action: 'resend_report', userId: ctx.amy.id, month: '2026-11' })).body.ok, false, 'the current month is not finished');
    assert.equal((await admin(ctx, { action: 'resend_report', userId: ctx.amy.id, month: '2024-01' })).body.ok, false, 'too old');
    assert.equal((await admin(ctx, { action: 'resend_report', userId: ctx.amy.id, month: 'October' })).body.ok, false);
    const nowhere = await admin(ctx, { action: 'resend_report', userId: ctx.ben.id, month: '2026-10' });
    assert.match(nowhere.body.message, /nowhere to send/);
});

test('monthly report: Telegram is the default when linked, email is used otherwise, and a choice of email is respected', async () => {
    const ctx = world();
    const { handle } = await handler('monthly-report-email');
    const FIRST = new Date('2026-11-01T02:00:00Z');
    ctx.db.monthly_report_preferences.push(
        pref(ctx.amy.id),                                                                   // linked + confirmed email, automatic -> Telegram
        pref(ctx.ben.id, { recipient_email: 'ben@example.com', verified_email: 'ben@example.com', channel: 'email' }), // linked, chose email
        pref(BOSS, { recipient_email: null, verified_email: null }),                         // Telegram only, no email at all
    );
    ctx.db.telegram_links.push({ chat_id: 11, user_id: ctx.amy.id, lang: 'en' }, { chat_id: 22, user_id: ctx.ben.id, lang: 'en' }, { chat_id: 33, user_id: BOSS, lang: 'en' });
    for (const id of [ctx.amy.id, ctx.ben.id, BOSS]) spend(ctx.db, id, 50, '2026-10-10T04:00:00Z');
    const smtp = fakeSmtp();
    const res = await handle(new Request('https://x', { method: 'POST', headers: { 'x-cron-secret': ENV.MONTHLY_REPORT_CRON_SECRET }, body: '{}' }), FIRST, smtp.connector, ctx.tg.client);
    const out = await res.json();
    assert.deepEqual([out.sent, out.failed, out.byChannel], [3, 0, { telegram: 2, email: 1 }]);
    assert.deepEqual(ctx.tg.sent.map((m) => m.chatId).sort(), [11, 33]);
    assert.match(ctx.tg.sent[0].html, /Your ManaDuit report for October 2026/);
    assert.deepEqual(smtp.transcript.filter((l) => l.startsWith('RCPT')), ['RCPT TO:<ben@example.com>']);
    const row = (id) => ctx.db.monthly_report_preferences.find((r) => r.user_id === id);
    assert.deepEqual([row(ctx.amy.id).last_status, row(ctx.amy.id).last_channel], ['sent', 'telegram']);
    assert.deepEqual([row(ctx.ben.id).last_status, row(ctx.ben.id).last_channel], ['sent', 'email']);

    // a second run the same day sends nothing more
    const again = await (await handle(new Request('https://x', { method: 'POST', headers: { 'x-cron-secret': ENV.MONTHLY_REPORT_CRON_SECRET }, body: '{}' }), new Date('2026-11-01T03:00:00Z'), smtp.connector, ctx.tg.client)).json();
    assert.equal(again.sent, 0);
});

test('monthly report: if Telegram fails or the bot is blocked, the report goes by email; if both fail it is recorded as failed', async () => {
    const ctx = world();
    const { handle } = await handler('monthly-report-email');
    const cron = () => new Request('https://x', { method: 'POST', headers: { 'x-cron-secret': ENV.MONTHLY_REPORT_CRON_SECRET }, body: '{}' });
    ctx.db.monthly_report_preferences.push(pref(ctx.amy.id), pref(BOSS, { recipient_email: null, verified_email: null }));
    ctx.db.telegram_links.push({ chat_id: 11, user_id: ctx.amy.id, lang: 'en' }, { chat_id: 33, user_id: BOSS, lang: 'en' });
    spend(ctx.db, ctx.amy.id, 50, '2026-10-10T04:00:00Z');
    spend(ctx.db, BOSS, 50, '2026-10-10T04:00:00Z');
    ctx.tg.result = 'blocked';
    const smtp = fakeSmtp();
    const out = await (await handle(cron(), new Date('2026-11-01T02:00:00Z'), smtp.connector, ctx.tg.client)).json();
    assert.deepEqual([out.sent, out.failed, out.byChannel], [1, 1, { telegram: 0, email: 1 }]);
    assert.deepEqual(smtp.transcript.filter((l) => l.startsWith('RCPT')), ['RCPT TO:<amy@example.com>']);
    const row = (id) => ctx.db.monthly_report_preferences.find((r) => r.user_id === id);
    assert.deepEqual([row(ctx.amy.id).last_status, row(ctx.amy.id).last_channel], ['sent', 'email']);
    assert.deepEqual([row(BOSS).last_status, row(BOSS).last_channel, row(BOSS).sent_for_month], ['failed', 'telegram', null], 'released, so the next hourly run tries again');
});

test('send again: the person can ask twice per report, it goes only to them, and the wording sets expectations', async () => {
    const ctx = world();
    const { handle } = await handler('report-resend');
    ctx.db.monthly_report_preferences.push(pref(ctx.amy.id, { last_month: '2026-10-01', last_status: 'failed', resend_count: 0 }));
    spend(ctx.db, ctx.amy.id, 50, '2026-10-10T04:00:00Z');
    const ask = async (token = 'tok-amy') => {
        const smtp = fakeSmtp();
        const res = await post((r) => handle(r, NOW, smtp.connector, ctx.tg.client), {}, { token });
        return { status: res.status, body: await res.json(), smtp };
    };
    const first = await ask();
    assert.deepEqual([first.body.ok, first.body.channel, first.body.left], [true, 'email', 1]);
    assert.match(first.body.message, /on its way by email\. Please allow 15 minutes\. If it still hasn't arrived, contact the admin\./);
    assert.deepEqual(first.smtp.transcript.filter((l) => l.startsWith('RCPT')), ['RCPT TO:<amy@example.com>']);
    const row = ctx.db.monthly_report_preferences[0];
    assert.deepEqual([row.last_status, row.resend_count], ['sent', 1]);
    assert.equal((await ask()).body.left, 0);
    const third = await ask();
    assert.deepEqual([third.body.ok, third.body.left], [false, 0]);
    assert.match(third.body.message, /contact the admin/);
    assert.equal((await ask(null)).status, 401);

    // a new month starts a fresh count
    row.last_month = '2026-09-01';
    assert.equal((await ask()).body.ok, true);
    assert.equal(row.resend_count, 1);
});

test('send again: needs the report switched on and somewhere to send it', async () => {
    const ctx = world();
    const { handle } = await handler('report-resend');
    const ask = async () => (await post((r) => handle(r, NOW, fakeSmtp().connector, ctx.tg.client), {}, { token: 'tok-amy' })).json();
    assert.match((await ask()).message, /Turn on the monthly report/);
    ctx.db.monthly_report_preferences.push(pref(ctx.amy.id, { recipient_email: null, verified_email: null }));
    assert.match((await ask()).message, /nowhere to send/);
    ctx.db.telegram_links.push({ chat_id: 11, user_id: ctx.amy.id, lang: 'en' });
    const sent = await ask();
    assert.deepEqual([sent.ok, sent.channel], [true, 'telegram']);
    assert.equal(ctx.tg.sent[0].chatId, 11);
});

// Feedback Section
async function feedback(ctx, body, options = {}) {
    const { handle } = await handler('feedback');
    const smtp = options.smtp || fakeSmtp();
    const res = await post((r) => handle(r, smtp.connector, options.fetchImpl || globalThis.fetch), body, { token: null, ...options });
    return { status: res.status, body: await res.json(), smtp };
}

test('feedback: works without signing in, is saved for the admin, and the admin is told by email', async () => {
    const ctx = world();
    const res = await feedback(ctx, { email: 'Locked@Example.com', topic: 'locked_out', message: 'I can not get in <b>please</b> help' });
    assert.equal(res.body.ok, true);
    assert.deepEqual(ctx.db.feedback.map((f) => [f.email, f.topic, f.user_id, f.status]), [['locked@example.com', 'locked_out', null, 'open']]);
    assert.deepEqual(res.smtp.transcript.filter((l) => l.startsWith('RCPT')), ['RCPT TO:<boss@gmail.com>']);
    const { parts } = parseMessage(res.smtp.state.message);
    assert.ok(parts['text/html'].includes('&lt;b&gt;please&lt;/b&gt;'), 'the message is escaped in the email');
    assert.match(parts['text/html'], /not signed in/);

    const signedIn = await feedback(ctx, { email: 'someone-else@example.com', topic: 'bug', message: 'A bug report' }, { token: 'tok-amy' });
    assert.equal(signedIn.body.ok, true);
    assert.deepEqual([ctx.db.feedback[1].email, ctx.db.feedback[1].user_id], ['amy@example.com', ctx.amy.id], 'a signed-in person can not pretend to be someone else');
});

test('feedback: bad input is explained per field, and floods are limited', async () => {
    const ctx = world();
    assert.equal((await feedback(ctx, { email: 'nope', topic: 'bug', message: 'hello there' })).body.field, 'email');
    assert.equal((await feedback(ctx, { email: 'a@example.com', topic: 'hack', message: 'hello there' })).body.field, 'topic');
    assert.equal((await feedback(ctx, { email: 'a@example.com', topic: 'bug', message: 'hi' })).body.field, 'message');
    assert.equal((await feedback(ctx, { email: 'a@example.com', topic: 'bug', message: 'x'.repeat(2001) })).body.field, 'message');
    assert.equal((await feedback(ctx, { email: 'a@example.com', topic: 'bug', message: 'hello there' }, { origin: 'https://evil.example' })).status, 403);
    assert.equal(ctx.db.feedback.length, 0);
    for (let i = 0; i < 5; i++) assert.equal((await feedback(ctx, { email: `p${i}@example.com`, topic: 'bug', message: 'hello there' })).body.ok, true);
    const sixth = await feedback(ctx, { email: 'p9@example.com', topic: 'bug', message: 'hello there' });
    assert.equal(sixth.body.ok, false, '5 a day per network');
    assert.equal(ctx.db.feedback.length, 5);
});

test('feedback: when the security check is switched on, a message without it is refused', async () => {
    const ctx = world({ TURNSTILE_SECRET_KEY: 'turnstile-secret' });
    const calls = [];
    const fetchImpl = async (url, init) => { calls.push({ url: String(url), body: String(init.body) }); return new Response(JSON.stringify({ success: String(init.body).includes('response=good') })); };
    assert.equal((await feedback(ctx, { email: 'a@example.com', topic: 'bug', message: 'hello there' }, { fetchImpl })).body.field, 'captcha');
    assert.equal((await feedback(ctx, { email: 'a@example.com', topic: 'bug', message: 'hello there', captcha: 'bad' }, { fetchImpl })).body.field, 'captcha');
    assert.equal((await feedback(ctx, { email: 'a@example.com', topic: 'bug', message: 'hello there', captcha: 'good' }, { fetchImpl })).body.ok, true);
    assert.ok(calls.every((c) => c.url === 'https://challenges.cloudflare.com/turnstile/v0/siteverify'));
    assert.equal(ctx.db.feedback.length, 1);
});

test('admin: the feedback inbox lists open messages and can resolve them; health and the log are available', async () => {
    const ctx = world();
    await feedback(ctx, { email: 'a@example.com', topic: 'bug', message: 'first message' });
    await feedback(ctx, { email: 'b@example.com', topic: 'report', message: 'second message' }, { ip: '4.4.4.4' });
    const open = (await admin(ctx, { action: 'feedback_list' })).body.items;
    assert.equal(open.length, 2);
    assert.equal((await admin(ctx, { action: 'feedback_resolve', id: open[0].id })).body.ok, true);
    assert.equal((await admin(ctx, { action: 'feedback_list' })).body.items.length, 1);
    assert.equal((await admin(ctx, { action: 'feedback_list', status: 'resolved' })).body.items.length, 1);
    assert.equal((await admin(ctx, { action: 'feedback_resolve', id: 99999 })).body.ok, false);
    const health = (await admin(ctx, { action: 'health' })).body;
    assert.equal(health.checks['Email (Gmail SMTP)'], true);
    assert.equal(health.checks['Database is up to date'], true);
    assert.equal(health.openFeedback, 1);
    const log = (await admin(ctx, { action: 'log' })).body.items;
    assert.equal(log[0].action, 'resolve_feedback');
    assert.ok(!JSON.stringify(log).includes('first message'));
});
