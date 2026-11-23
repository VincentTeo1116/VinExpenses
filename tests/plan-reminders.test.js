// Run with:  node --test "tests/*.test.js"
// The Telegram reminders for deposits and loans (supabase/functions/plan-reminders), against the in-memory database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./helpers/tg-harness.js');
const { A, B, CHAT_A, CHAT_B, setup } = H;

const moduleUnderTest = () => import('../supabase/functions/plan-reminders/handler.ts');
const at = (iso) => new Date(iso);
const NINE = at('2026-03-25T01:30:00Z');   // 09:30 on 25 March 2026 in Kuala Lumpur
const cron = (over = {}) => new Request('https://abcdefghij.supabase.co/functions/v1/plan-reminders', {
    method: 'POST', headers: { 'x-cron-secret': H.ENV.MONTHLY_REPORT_CRON_SECRET, ...over }, body: '{}',
});

const FD = '11111111-0000-4000-8000-000000000001';
const LOAN = '22222222-0000-4000-8000-000000000002';
const fdRow = (extra = {}) => ({
    id: FD, user_id: A, name: 'Maybank <3M>', principal: 10000, rate: 3.5, tenure_value: 90, tenure_unit: 'days', start_date: '2026-01-01',
    maturity_date: '2026-04-01', payout: 'maturity', tax_rate: 0, day_basis: 365, reminders_on: true, reminder_days: [7, 1, 0], status: 'open', ...extra,
});
const loanRow = (extra = {}) => ({
    id: LOAN, user_id: A, name: 'Car loan', principal: 50000, rate: 3, method: 'flat', term_months: 60, first_payment_date: '2026-01-28', fees: 0,
    instalment: 958.33, reminders_on: true, reminder_days: [3, 0], status: 'open', paid_through: '2026-02-28', ...extra,
});

function world({ deposits = [fdRow()], loans = [], links = true } = {}) {
    const ctx = setup({ SITE_URL: 'https://me.github.io/VinExpenses/' });
    if (links) ctx.db.telegram_links.push({ chat_id: CHAT_A, user_id: A, lang: 'en', reminders_blocked_at: null });
    ctx.db.fixed_deposits.push(...deposits);
    ctx.db.loans.push(...loans);
    return ctx;
}
const run = async (ctx, when = NINE) => {
    const { handle } = await moduleUnderTest();
    const res = await handle(cron(), when, ctx.tg.client);
    return { status: res.status, body: await res.json() };
};

test('reminders: only the scheduler can start it, and an unset secret never means "anyone"', async () => {
    const { handle } = await moduleUnderTest();
    const ctx = world();
    assert.equal((await handle(new Request('https://x', { method: 'GET' }), NINE, ctx.tg.client)).status, 405);
    assert.equal((await handle(cron({ 'x-cron-secret': 'wrong' }), NINE, ctx.tg.client)).status, 401);
    assert.equal((await handle(new Request('https://x', { method: 'POST' }), NINE, ctx.tg.client)).status, 401);
    assert.equal(ctx.tg.sent.length, 0);
    delete globalThis.Deno;
    const noSecret = setup({ MONTHLY_REPORT_CRON_SECRET: undefined });
    assert.equal((await handle(cron({ 'x-cron-secret': '' }), NINE, noSecret.tg.client)).status, 503);
    delete globalThis.Deno;
    const noToken = setup({ TELEGRAM_BOT_TOKEN: undefined });
    assert.equal((await handle(cron(), NINE, noToken.tg.client)).status, 503);
});

test('reminders: a deposit 7 days from maturity is announced once, with the amount and an app button', async () => {
    const ctx = world();
    const first = await run(ctx);
    assert.equal(first.status, 200);
    assert.deepEqual([first.body.sent, first.body.failed, first.body.date], [1, 0, '2026-03-25']);
    const message = ctx.tg.sent[0];
    assert.equal(message.chatId, CHAT_A);
    assert.match(message.html, /Fixed deposit matures in 7 days/);
    assert.match(message.html, /Maybank &lt;3M&gt;/, 'names are escaped');
    assert.match(message.html, /10,086\.30/);
    assert.match(message.html, /1 Apr 2026/);
    assert.deepEqual(message.buttons, [[{ text: 'Open the app', url: 'https://me.github.io/VinExpenses' }]]);
    assert.equal(ctx.db.reminder_log.length, 1);
    assert.ok(ctx.db.reminder_log[0].sent_at);

    // the next hourly runs, and the following days until the next milestone, send nothing more
    assert.equal((await run(ctx, at('2026-03-25T02:20:00Z'))).body.sent, 0);
    assert.equal((await run(ctx, at('2026-03-28T01:30:00Z'))).body.sent, 0);
    assert.equal(ctx.tg.sent.length, 1);
});

test('reminders: 1 day before, on the day, and one late notice only if the day itself was missed', async () => {
    const ctx = world();
    await run(ctx, at('2026-03-31T01:30:00Z'));
    assert.match(ctx.tg.sent.at(-1).html, /matures tomorrow/);
    await run(ctx, at('2026-04-01T01:30:00Z'));
    assert.match(ctx.tg.sent.at(-1).html, /matures today/);
    await run(ctx, at('2026-04-02T01:30:00Z'));
    assert.equal(ctx.tg.sent.length, 2, 'the day was announced, so no "matured yesterday" follows');

    const missed = world();
    await run(missed, at('2026-04-03T01:30:00Z'));   // the scheduler was down for a week
    assert.equal(missed.tg.sent.length, 1, 'one message, not a backlog of three');
    assert.match(missed.tg.sent[0].html, /matured 2 days ago/);
    await run(missed, at('2026-04-04T01:30:00Z'));
    assert.equal(missed.tg.sent.length, 1);

    const tooLate = world();
    await run(tooLate, at('2026-04-09T01:30:00Z'));
    assert.equal(tooLate.tg.sent.length, 0, 'more than a week late: dropped');
});

test('reminders: nothing before the chosen hour; the hour and "hide amounts" come from the person\'s settings', async () => {
    const ctx = world();
    const early = await run(ctx, at('2026-03-25T00:30:00Z'));   // 08:30 in Kuala Lumpur
    assert.deepEqual([early.body.sent, early.body.waiting], [0, 1]);

    ctx.db.user_preferences.push({ user_id: A, reminder_hour: 20, reminder_hide_amounts: true });
    assert.equal((await run(ctx, NINE)).body.sent, 0, '09:30 is before their 20:00');
    assert.equal((await run(ctx, at('2026-03-25T12:10:00Z'))).body.sent, 1);
    assert.ok(!/RM|10,086/.test(ctx.tg.sent[0].html), ctx.tg.sent[0].html);
    assert.match(ctx.tg.sent[0].html, /Maybank/);
});

test('reminders: closed, switched-off and other people\'s items are left out; people without Telegram get nothing', async () => {
    const ctx = world({
        deposits: [fdRow({ status: 'closed' }), fdRow({ id: FD.replace('1', '3'), reminders_on: false }), fdRow({ id: FD.replace('1', '4'), user_id: B, name: 'Not linked' })],
    });
    const out = await run(ctx);
    assert.equal(out.body.sent, 0);
    assert.equal(ctx.tg.sent.length, 0);

    const nobody = world({ links: false });
    const none = await run(nobody);
    assert.equal(none.status, 200);
    assert.match(none.body.message, /Nobody has connected/);
});

test('reminders: each person only ever gets their own', async () => {
    const ctx = world({ deposits: [fdRow(), fdRow({ id: FD.replace('1', '5'), user_id: B, name: 'B deposit' })] });
    ctx.db.telegram_links.push({ chat_id: CHAT_B, user_id: B, lang: 'en', reminders_blocked_at: null });
    await run(ctx);
    assert.equal(ctx.tg.sent.length, 2);
    assert.match(ctx.tg.sent.find((m) => m.chatId === CHAT_A).html, /Maybank/);
    assert.match(ctx.tg.sent.find((m) => m.chatId === CHAT_B).html, /B deposit/);
    assert.ok(ctx.db.reminder_log.every((row) => (row.item_id === FD) === (row.user_id === A)));
});

test('loan reminders: 3 days before and on the day; overdue only when it is not paid automatically', async () => {
    const ctx = world({ deposits: [], loans: [loanRow()] });
    await run(ctx, at('2026-03-24T01:30:00Z'));
    assert.equal(ctx.tg.sent.length, 0, '4 days before: nothing');
    await run(ctx, at('2026-03-25T01:30:00Z'));
    assert.match(ctx.tg.sent.at(-1).html, /Loan payment due in 3 days/);
    assert.match(ctx.tg.sent.at(-1).html, /958\.33/);
    assert.match(ctx.tg.sent.at(-1).html, /28 Mar 2026/);
    await run(ctx, at('2026-03-28T01:30:00Z'));
    assert.match(ctx.tg.sent.at(-1).html, /due today/);
    assert.equal(ctx.tg.sent.length, 2);

    const late = world({ deposits: [], loans: [loanRow()] });
    await run(late, at('2026-03-30T01:30:00Z'));
    assert.match(late.tg.sent[0].html, /was due 2 days ago/);

    const auto = world({ deposits: [], loans: [loanRow()] });
    auto.db.recurring_expenses.push({ id: 'r1', user_id: A, loan_id: LOAN, next_due: '2026-04-28', active: true });
    await run(auto, at('2026-03-30T01:30:00Z'));
    assert.equal(auto.tg.sent.length, 0, 'a loan in recurring expenses is never reported as overdue');
});

test('loan reminders: a paused recurring entry stops the automatic payments, but what it already posted is not overdue', async () => {
    const ctx = world({ deposits: [], loans: [loanRow({ paid_through: null })] });
    // posted January to March, then paused: the next unposted date is 28 April
    ctx.db.recurring_expenses.push({ id: 'r1', user_id: A, loan_id: LOAN, next_due: '2026-04-28', active: false });
    await run(ctx, at('2026-03-30T01:30:00Z'));
    assert.equal(ctx.tg.sent.length, 0, 'January to March were posted by the entry, so nothing is overdue');
    await run(ctx, at('2026-04-30T01:30:00Z'));
    assert.match(ctx.tg.sent.at(-1).html, /was due 2 days ago/, 'April was never posted, so it is reported');
});

test('reminders: a temporary Telegram failure is retried on later runs, three times at most', async () => {
    const ctx = world();
    ctx.tg.checkedResult = 'failed';
    assert.deepEqual((await run(ctx)).body.failed, 1);
    assert.equal(ctx.db.reminder_log[0].sent_at, null);
    await run(ctx, at('2026-03-25T02:20:00Z'));
    await run(ctx, at('2026-03-25T03:20:00Z'));
    assert.equal(ctx.db.reminder_log[0].attempts, 3);
    const givenUp = await run(ctx, at('2026-03-25T04:20:00Z'));
    assert.equal(givenUp.body.failed, 0);
    assert.equal(ctx.tg.sent.length, 3, 'no fourth try');

    const recovers = world();
    recovers.tg.checkedResult = 'failed';
    await run(recovers);
    recovers.tg.checkedResult = 'ok';
    assert.equal((await run(recovers, at('2026-03-25T02:20:00Z'))).body.sent, 1);
    assert.ok(recovers.db.reminder_log[0].sent_at);
});

test('reminders: someone who blocked the bot is marked, left alone for a day, then tried again', async () => {
    const ctx = world({ loans: [loanRow()] });
    ctx.tg.checkedResult = 'blocked';
    const out = await run(ctx);
    assert.equal(out.body.blocked, 1);
    assert.equal(ctx.tg.sent.length, 1, 'stops after the first refusal instead of trying every item');
    assert.ok(ctx.db.telegram_links[0].reminders_blocked_at);
    assert.equal(ctx.db.reminder_log.length, 0, 'the unsent reminder is not counted as sent');

    await run(ctx, at('2026-03-25T05:20:00Z'));
    assert.equal(ctx.tg.sent.length, 1, 'not retried every hour');

    ctx.tg.checkedResult = 'ok';   // they pressed Start again
    await run(ctx, at('2026-03-26T01:40:00Z'));
    assert.ok(ctx.tg.sent.length >= 2);
    assert.equal(ctx.db.telegram_links[0].reminders_blocked_at, null);
});

test('reminders: an older database (no settings or recurring columns) still works with the defaults', async () => {
    const ctx = world();
    ctx.hooks.breakWhen.push((method, url) => /\/(user_preferences|recurring_expenses)$/.test(url.pathname));
    ctx.hooks.breakWhen.push((method, url) => url.pathname.endsWith('/telegram_links') && (url.searchParams.get('select') || '').includes('reminders_blocked_at'));
    assert.equal((await run(ctx)).body.sent, 1);

    const noTables = world();
    noTables.hooks.breakWhen.push((method, url) => url.pathname.endsWith('/fixed_deposits'));
    const out = await run(noTables);
    assert.equal(out.status, 502);
    assert.match(out.body.error, /supabase-schema\.sql/);
    assert.equal(noTables.tg.sent.length, 0);
});

test('reminders: a batch limit holds the rest for the next run', async () => {
    const many = Array.from({ length: 5 }, (_, i) => fdRow({ id: `33333333-0000-4000-8000-00000000000${i}`, name: `FD ${i}` }));
    const ctx = world({ deposits: many });
    delete globalThis.Deno;
    const limited = setup({ REMINDER_BATCH: '2' });
    limited.db.telegram_links.push({ chat_id: CHAT_A, user_id: A, lang: 'en', reminders_blocked_at: null });
    limited.db.fixed_deposits.push(...many);
    assert.equal((await run(limited)).body.sent, 2);
    assert.equal((await run(limited, at('2026-03-25T02:20:00Z'))).body.sent, 2);
    assert.equal((await run(limited, at('2026-03-25T03:20:00Z'))).body.sent, 1);
    assert.equal(limited.tg.sent.length, 5);
    assert.ok(ctx);
});

test('reminders: scheduler-only, server-only log, and the settings can never unlock someone else\'s data', () => {
    const root = path.join(__dirname, '..');
    const code = fs.readFileSync(path.join(root, 'supabase/functions/plan-reminders/handler.ts'), 'utf8');
    assert.match(code, /safeEqual\(request\.headers\.get\("x-cron-secret"\)/);
    assert.match(code, /cronSecret\.length < 24/);
    assert.ok(!/console\.(log|error|warn)\([^)]*(token|cronSecret)/.test(code));
    const sql = fs.readFileSync(path.join(root, 'supabase-schema.sql'), 'utf8');
    assert.match(sql, /alter table public\.reminder_log enable row level security/);
    assert.match(sql, /revoke all on public\.reminder_log from anon, authenticated/);
    assert.match(sql, /constraint reminder_log_once unique \(item_kind, item_id, due_date, lead_days\)/);
    for (const table of ['fixed_deposits', 'loans']) {
        assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
        assert.match(sql, new RegExp(`on public\\.${table}\\s+for all using \\(auth\\.uid\\(\\) = user_id\\) with check \\(auth\\.uid\\(\\) = user_id\\)`));
    }
});
