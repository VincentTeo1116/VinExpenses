// Tests the announcement actions of the admin function: only an administrator, English required, one live announcement, drafts stay private, every change logged.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeSupabase } = require('./helpers/fakes.js');

const SITE = 'https://me.github.io';
const ENV = {
    SUPABASE_URL: 'https://abcdefghij.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-key', SUPABASE_ANON_KEY: 'anon-key', ALLOWED_ORIGINS: SITE,
    SMTP_USER: 'sender@gmail.com', SMTP_PASS: 'abcd efgh ijkl mnop', EMAIL_TOKEN_SECRET: 'T'.repeat(40), SITE_URL: `${SITE}/VinExpenses`,
    MONTHLY_REPORT_CRON_SECRET: 'cron-secret-with-24-or-more-chars', ADMIN_EMAIL: 'boss@gmail.com',
};
const NOW = new Date('2026-11-27T02:00:00Z');
const BOSS = 'eeeeeeee-0000-4000-8000-000000000005';
const AMY = 'eeeeeeee-0000-4000-8000-000000000006';

function world() {
    globalThis.Deno = { env: { get: (name) => ENV[name] } };
    const db = fakeSupabase();
    db.now = () => NOW.toISOString();
    globalThis.fetch = db.fetch;
    db.app_admins.push({ user_id: BOSS });
    db.addUser('tok-boss', BOSS, 'boss@gmail.com');
    db.addUser('tok-amy', AMY, 'amy@example.com');
    return db;
}
test.afterEach(() => { delete globalThis.Deno; });

async function admin(body, token = 'tok-boss') {
    const { handle } = await import('../supabase/functions/admin/handler.ts');
    const res = await handle(new Request('https://abcdefghij.supabase.co/functions/v1/admin', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), origin: SITE, 'x-forwarded-for': '1.2.3.4' },
        body: JSON.stringify(body),
    }), NOW);
    return { status: res.status, body: await res.json() };
}
const FULL = { titleEn: 'New: split a receipt', bodyEn: 'Scan a bill and **tick** what you had.\n\n- Splits SST\n- Splits service charge', titleMs: 'Baharu: bahagi resit', bodyMs: 'Imbas bil.', titleZh: '', bodyZh: '' };

test('announcements: only an administrator can read, save, publish or retire, checked on the server', async () => {
    const db = world();
    for (const action of ['announcement_state', 'announcement_save', 'announcement_publish', 'announcement_retire']) {
        assert.equal((await admin({ action, ...FULL }, 'tok-amy')).status, 403, action);
        assert.equal((await admin({ action, ...FULL }, null)).status, 401, action);
    }
    assert.equal(db.announcements.length, 0);
    assert.equal(db.admin_audit_log.length, 0);
});

test('announcements: publishing needs an English title and message, and refuses text that is too long', async () => {
    const db = world();
    assert.match((await admin({ action: 'announcement_publish', titleEn: '', bodyEn: 'x' })).body.message, /English title and message are required/);
    assert.match((await admin({ action: 'announcement_publish', titleEn: 'x', bodyEn: '   ' })).body.message, /English title and message are required/);
    assert.match((await admin({ action: 'announcement_publish', titleEn: 'x'.repeat(81), bodyEn: 'ok' })).body.message, /English title is too long/);
    assert.match((await admin({ action: 'announcement_publish', titleEn: 'ok', bodyEn: 'y'.repeat(1501) })).body.message, /English message is too long/);
    assert.match((await admin({ action: 'announcement_publish', titleEn: 'ok', bodyEn: 'ok', titleMs: 'x', bodyMs: 'y'.repeat(1501) })).body.message, /Malay message is too long/);
    assert.equal(db.announcements.length, 0, 'nothing was stored');
});

test('announcements: a draft is saved as one row and updated in place, and a language is kept only when its title and message are both written', async () => {
    const db = world();
    assert.equal((await admin({ action: 'announcement_save', ...FULL })).body.ok, true);
    assert.equal((await admin({ action: 'announcement_save', ...FULL, bodyEn: 'Changed.' })).body.ok, true);
    assert.equal(db.announcements.length, 1, 'still one draft');
    const draft = db.announcements[0];
    assert.equal(draft.status, 'draft');
    assert.equal(draft.body_en, 'Changed.');
    assert.deepEqual([draft.title_ms, draft.body_ms], ['Baharu: bahagi resit', 'Imbas bil.']);
    assert.deepEqual([draft.title_zh, draft.body_zh], [null, null]);
    await admin({ action: 'announcement_save', ...FULL, titleMs: 'Only a title', bodyMs: '' });
    assert.deepEqual([db.announcements[0].title_ms, db.announcements[0].body_ms], [null, null], 'a half-written language is dropped, not shown mixed');
});

test('announcements: control characters are removed and line breaks are kept', async () => {
    const db = world();
    await admin({ action: 'announcement_publish', titleEn: 'Hello\u0007 there', bodyEn: 'Line one\r\nLine two\u0000' });
    assert.equal(db.announcements[0].title_en, 'Hello there');
    assert.equal(db.announcements[0].body_en, 'Line one\nLine two');
});

test('announcements: publishing makes one live announcement, retires the old one, clears the draft and is logged', async () => {
    const db = world();
    await admin({ action: 'announcement_save', ...FULL });
    const first = await admin({ action: 'announcement_publish', ...FULL });
    assert.equal(first.body.ok, true);
    assert.deepEqual(db.announcements.map((a) => a.status), ['published'], 'the draft became the live one');
    await admin({ action: 'announcement_publish', titleEn: 'Second', bodyEn: 'Newer news' });
    assert.deepEqual(db.announcements.map((a) => [a.title_en, a.status]).sort(), [['New: split a receipt', 'retired'], ['Second', 'published']].sort());
    const state = (await admin({ action: 'announcement_state' })).body;
    assert.equal(state.ok, true);
    assert.equal(state.published.title_en, 'Second');
    assert.equal(state.draft, null);
    assert.deepEqual(db.admin_audit_log.map((l) => l.action).filter((a) => a.includes('announcement')), ['save_announcement_draft', 'publish_announcement', 'publish_announcement']);
});

test('announcements: the state shows how many people have read the live one, and retiring switches it off', async () => {
    const db = world();
    await admin({ action: 'announcement_publish', titleEn: 'Live', bodyEn: 'Now' });
    const id = db.announcements[0].id;
    db.announcement_reads.push({ user_id: AMY, announcement_id: id }, { user_id: BOSS, announcement_id: id }, { user_id: AMY, announcement_id: 'some-other-one' });
    assert.equal((await admin({ action: 'announcement_state' })).body.reads, 2);
    assert.equal((await admin({ action: 'announcement_retire' })).body.ok, true);
    const after = (await admin({ action: 'announcement_state' })).body;
    assert.equal(after.published, null);
    assert.equal(db.announcements[0].status, 'retired');
    assert.ok(db.admin_audit_log.some((l) => l.action === 'retire_announcement'));
});
