// Tests sign-up, sign-in, password reset, lockouts and recovery codes against an in-memory sign-in service.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers/tg-harness.js');

const gate = () => import('../supabase/functions/auth-gate/handler.ts');
const rules = () => import('../supabase/functions/_shared/auth-rules.ts');
const ORIGIN = 'https://me.github.io';
const NOW = new Date('2026-11-10T02:00:00Z'); // 10:00 on 10 November in Kuala Lumpur
const DEVICE = 'device-aaaaaaaaaaaaaaaa';
const OTHER = 'device-bbbbbbbbbbbbbbbb';
const GOOD = 'Str0ng!Passw0rd';

function world(extra = {}) {
    const ctx = H.setup({ SUPABASE_ANON_KEY: 'anon-key', ...extra });
    ctx.db.now = () => ctx.clock.toISOString();
    ctx.clock = new Date(NOW);
    ctx.db.nextCode = '123456';
    return ctx;
}
async function call(ctx, body, { origin = ORIGIN, ip = '1.2.3.4', token } = {}) {
    const { handle } = await gate();
    const res = await handle(new Request('https://abcdefghij.supabase.co/functions/v1/auth-gate', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}), 'x-forwarded-for': ip, ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
    }), ctx.clock);
    return { status: res.status, body: await res.json() };
}
const account = (ctx, extra = {}) => {
    const a = { id: crypto.randomUUID(), email: 'user@example.com', password: GOOD, confirmed: true, banned: false, metadata: { username: 'User' }, factors: [], codes: {}, created_at: NOW.toISOString(), ...extra };
    ctx.db.accounts.push(a);
    return a;
};
const signIn = (ctx, extra = {}, options) => call(ctx, { action: 'signin', email: 'user@example.com', password: GOOD, device: DEVICE, ...extra }, options);
const later = (ctx, minutes) => { ctx.clock = new Date(ctx.clock.getTime() + minutes * 60_000); };

// Rules Section
test('password rules: 10 characters with upper, lower, a number and a symbol, each reported separately', async () => {
    const { checkPassword, cleanEmail, cleanName, isCode, isDeviceId, cleanRecoveryCode, newRecoveryCode, tokenAal, periods } = await rules();
    assert.equal(checkPassword(GOOD).ok, true);
    const failing = (pw) => checkPassword(pw).rules.filter((r) => !r.met).map((r) => r.key);
    assert.deepEqual(failing('Sh0rt!'), ['length']);
    assert.deepEqual(failing('alllowercase1!'), ['upper']);
    assert.deepEqual(failing('ALLUPPERCASE1!'), ['lower']);
    assert.deepEqual(failing('NoDigitsHere!!'), ['digit']);
    assert.deepEqual(failing('NoSymbolsHere12'), ['symbol']);
    assert.deepEqual(failing(''), ['length', 'upper', 'lower', 'digit', 'symbol']);
    assert.equal(checkPassword(`Aa1!${'x'.repeat(80)}`).ok, false, 'longer than the sign-in service reads');
    assert.equal(cleanEmail('  User@Example.COM '), 'user@example.com');
    assert.equal(cleanEmail('not-an-email'), '');
    assert.equal(cleanEmail('a@b'), '');
    assert.equal(cleanName('  Aiman   Hakim '), 'Aiman Hakim');
    assert.equal(cleanName('<b>x</b>'), '');
    assert.equal(cleanName('A'), '');
    assert.equal(isCode('123456'), true);
    assert.equal(isCode('12345'), false);
    assert.equal(isCode('12345a'), false);
    assert.equal(isDeviceId(DEVICE), true);
    assert.equal(isDeviceId('*'), false);
    const code = newRecoveryCode();
    assert.match(code, /^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
    assert.equal(cleanRecoveryCode(code.toLowerCase().replace('-', ' ')), code);
    assert.equal(cleanRecoveryCode('short'), '');
    assert.equal(tokenAal(`x.${Buffer.from('{"aal":"aal2"}').toString('base64url')}.y`), 'aal2');
    assert.equal(tokenAal('not-a-token'), '');
    assert.equal(periods(new Date('2026-11-30T17:00:00Z')).monthStart, '2026-11-30T16:00:00.000Z', '1 December starts at 16:00 UTC the day before');
});

// The Door Section
test('the door: website only, POST only, unknown actions refused, and nothing is waved through when the service is down', async () => {
    const ctx = world();
    account(ctx);
    assert.equal((await signIn(ctx, {}, { origin: 'https://evil.example' })).status, 403);
    assert.equal((await signIn(ctx, {}, { origin: null })).status, 403, 'a call that is not from a browser is refused');
    assert.equal((await call(ctx, { action: 'drop_tables' })).status, 400);
    const { handle } = await gate();
    assert.equal((await handle(new Request('https://x/functions/v1/auth-gate', { method: 'GET', headers: { origin: ORIGIN } }))).status, 405);
    ctx.db.authDown = true;
    const down = await signIn(ctx);
    assert.equal(down.status, 503);
    assert.ok(!JSON.stringify(down.body).includes('access_token'));
    ctx.db.authDown = false;
    ctx.db.failures.add('auth_lockouts');
    assert.equal((await signIn(ctx)).status, 503, 'if the lockout check can not be read, sign-in is refused');
});

// Sign-up Section
test('sign-up: a code is emailed, the account works only after the code, and the name is saved', async () => {
    const ctx = world();
    const started = await call(ctx, { action: 'signup', email: 'New@Example.com', name: 'Aiman', password: GOOD });
    assert.deepEqual([started.status, started.body.ok, started.body.step, started.body.minutes], [200, true, 'verify', 5]);
    assert.deepEqual(ctx.db.mail, [{ email: 'new@example.com', type: 'signup', code: '123456' }]);
    assert.equal(ctx.db.accounts[0].confirmed, false);
    assert.equal(ctx.db.accounts[0].metadata.username, 'Aiman');

    const early = await call(ctx, { action: 'signin', email: 'new@example.com', password: GOOD, device: DEVICE });
    assert.equal(early.body.code, 'unconfirmed');
    assert.equal(ctx.db.auth_lockouts.length, 0, 'an unverified sign-in is not counted as a wrong password');

    assert.equal((await call(ctx, { action: 'signup_verify', email: 'new@example.com', code: '000000' })).body.code, 'bad_code');
    const verified = await call(ctx, { action: 'signup_verify', email: 'new@example.com', code: '123456' });
    assert.equal(verified.body.ok, true);
    assert.ok(verified.body.session.access_token && verified.body.session.refresh_token);
    assert.equal(verified.body.session.user.email, 'new@example.com');
    assert.equal(ctx.db.accounts[0].confirmed, true);
    assert.equal((await call(ctx, { action: 'signup_verify', email: 'new@example.com', code: '123456' })).body.code, 'bad_code', 'a code works once');
});

test('sign-up: weak passwords, bad names and bad emails are refused before anything is sent', async () => {
    const ctx = world();
    assert.equal((await call(ctx, { action: 'signup', email: 'a@example.com', name: 'Aiman', password: 'weakpass' })).body.code, 'weak_password');
    assert.equal((await call(ctx, { action: 'signup', email: 'nope', name: 'Aiman', password: GOOD })).body.code, 'bad_email');
    assert.equal((await call(ctx, { action: 'signup', email: 'a@example.com', name: '<script>', password: GOOD })).body.code, 'bad_name');
    assert.equal(ctx.db.mail.length, 0);
    assert.equal(ctx.db.auth_code_requests.length, 0);
});

test('sign-up: an email that already has an account is sent to sign-in, and it costs no code', async () => {
    const ctx = world();
    account(ctx);
    const again = await call(ctx, { action: 'signup', email: 'user@example.com', name: 'Someone', password: GOOD });
    assert.deepEqual([again.body.ok, again.body.code], [false, 'exists']);
    assert.match(again.body.message, /sign in/i);
    assert.equal(ctx.db.mail.length, 0);
    assert.equal(ctx.db.auth_code_requests.length, 0);
});

test('codes: expire after 5 minutes, and a new one replaces the old one', async () => {
    const ctx = world();
    await call(ctx, { action: 'signup', email: 'new@example.com', name: 'Aiman', password: GOOD });
    later(ctx, 6);
    assert.equal((await call(ctx, { action: 'signup_verify', email: 'new@example.com', code: '123456' })).body.code, 'bad_code');
    ctx.db.nextCode = '654321';
    assert.equal((await call(ctx, { action: 'signup_resend', email: 'new@example.com' })).body.ok, true);
    assert.equal((await call(ctx, { action: 'signup_verify', email: 'new@example.com', code: '123456' })).body.code, 'bad_code', 'the old code is dead');
    assert.equal((await call(ctx, { action: 'signup_verify', email: 'new@example.com', code: '654321' })).body.ok, true);
});

test('codes: 3 a day per email, counted in Malaysia time, and a failed send is not counted', async () => {
    const ctx = world();
    await call(ctx, { action: 'signup', email: 'new@example.com', name: 'Aiman', password: GOOD });
    assert.equal((await call(ctx, { action: 'signup_resend', email: 'new@example.com' })).body.ok, true);
    assert.equal((await call(ctx, { action: 'signup_resend', email: 'new@example.com' })).body.ok, true);
    const fourth = await call(ctx, { action: 'signup_resend', email: 'new@example.com' });
    assert.deepEqual([fourth.body.ok, fourth.body.code], [false, 'code_limit_day']);
    assert.equal(fourth.body.retryAt, '2026-11-10T16:00:00.000Z', 'midnight in Kuala Lumpur');
    assert.equal(ctx.db.mail.length, 3);
    assert.equal(ctx.db.auth_code_requests.length, 3, 'the refused request is not kept');
    assert.equal((await call(ctx, { action: 'recover', email: 'new@example.com' })).body.code, 'code_limit_day', 'the limit covers reset codes too');
    assert.equal((await call(ctx, { action: 'recover', email: 'other@example.com' })).body.ok, true, 'other people are not affected');

    later(ctx, 15 * 60); // the next day in Kuala Lumpur
    assert.equal((await call(ctx, { action: 'signup_resend', email: 'new@example.com' })).body.ok, true);

    ctx.db.authDown = true;
    const before = ctx.db.auth_code_requests.length;
    assert.equal((await call(ctx, { action: 'signup_resend', email: 'new@example.com' })).status, 503);
    assert.equal(ctx.db.auth_code_requests.length, before, 'a send that failed costs nothing');
});

test('codes: more than 10 in a month stops them until the admin clears it', async () => {
    const ctx = world();
    account(ctx);
    for (let day = 0; day < 5; day++) {
        for (let i = 0; i < 2; i++) assert.equal((await call(ctx, { action: 'recover', email: 'user@example.com' })).body.ok, true, `day ${day} request ${i}`);
        later(ctx, 24 * 60);
    }
    const eleventh = await call(ctx, { action: 'recover', email: 'user@example.com' });
    assert.deepEqual([eleventh.body.ok, eleventh.body.code], [false, 'code_limit_month']);
    assert.match(eleventh.body.message, /contact the admin/);
    ctx.db.auth_code_requests.length = 0; // what the admin's "clear" does
    assert.equal((await call(ctx, { action: 'recover', email: 'user@example.com' })).body.ok, true);
});

test('codes: guessing is limited to 10 tries an hour per email', async () => {
    const ctx = world();
    await call(ctx, { action: 'signup', email: 'new@example.com', name: 'Aiman', password: GOOD });
    for (let i = 0; i < 10; i++) assert.equal((await call(ctx, { action: 'signup_verify', email: 'new@example.com', code: '000000' })).body.code, 'bad_code');
    const eleventh = await call(ctx, { action: 'signup_verify', email: 'new@example.com', code: '123456' });
    assert.equal(eleventh.body.code, 'slow_down', 'even the right code is refused once the tries are used up');
});

// Sign-in Section
test('sign-in: the right password gives a session, and a wrong one says the same thing for any email', async () => {
    const ctx = world();
    account(ctx);
    const ok = await signIn(ctx);
    assert.equal(ok.body.ok, true);
    assert.equal(ok.body.session.user.email, 'user@example.com');
    const wrong = await signIn(ctx, { password: 'Wrong!Passw0rd' });
    const unknown = await signIn(ctx, { email: 'nobody@example.com' });
    assert.deepEqual([wrong.body.code, unknown.body.code], ['invalid', 'invalid']);
    assert.equal(wrong.body.message, unknown.body.message, 'nobody can tell which emails have accounts');
    assert.equal((await signIn(ctx, { device: 'x' })).body.code, 'invalid', 'a missing device id is refused');
});

test('lockout: 5 wrong passwords pause that device for 3 hours, other devices still work, and it clears by itself', async () => {
    const ctx = world();
    account(ctx);
    for (let i = 0; i < 4; i++) assert.equal((await signIn(ctx, { password: 'Wrong!Passw0rd' })).body.code, 'invalid');
    const fifth = await signIn(ctx, { password: 'Wrong!Passw0rd' });
    assert.equal(fifth.body.code, 'blocked');
    assert.equal(fifth.body.until, '2026-11-10T05:00:00.000Z');
    assert.ok(ctx.db.auth_lockouts[0].blocked_at, 'the time the block started is stored');

    const right = await signIn(ctx);
    assert.equal(right.body.code, 'blocked', 'even the right password is refused while blocked');
    assert.equal((await signIn(ctx, { device: OTHER })).body.ok, true, 'the owner on another device is not locked out');

    later(ctx, 181);
    assert.equal((await signIn(ctx)).body.ok, true, 'after 3 hours it works again');
    assert.equal(ctx.db.auth_lockouts.filter((r) => r.device_id === DEVICE).length, 0, 'a good sign-in clears the count');
});

test('lockout: a good sign-in resets the count, and old failures do not add up', async () => {
    const ctx = world();
    account(ctx);
    for (let i = 0; i < 4; i++) await signIn(ctx, { password: 'Wrong!Passw0rd' });
    assert.equal((await signIn(ctx)).body.ok, true);
    for (let i = 0; i < 4; i++) assert.equal((await signIn(ctx, { password: 'Wrong!Passw0rd' })).body.code, 'invalid');
    later(ctx, 200);
    assert.equal((await signIn(ctx, { password: 'Wrong!Passw0rd' })).body.code, 'invalid', 'failures older than 3 hours are forgotten');
});

test('lockout: changing the device id does not allow endless guessing (20 across devices blocks the email)', async () => {
    const ctx = world();
    account(ctx);
    let last;
    for (let i = 0; i < 20; i++) last = await signIn(ctx, { password: 'Wrong!Passw0rd', device: `device-${String(i).padStart(16, '0')}` }, { ip: `9.9.9.${i}` });
    assert.equal(last.body.code, 'blocked');
    assert.equal((await signIn(ctx, { device: OTHER }, { ip: '8.8.8.8' })).body.code, 'blocked', 'the whole email is paused');
});

test('lockout: one network can not hammer many accounts (20 sign-ins an hour per address)', async () => {
    const ctx = world();
    for (let i = 0; i < 20; i++) await signIn(ctx, { email: `user${i}@example.com` });
    const next = await signIn(ctx, { email: 'user99@example.com' });
    assert.equal(next.body.code, 'slow_down');
    assert.equal((await signIn(ctx, { email: 'user99@example.com' }, { ip: '5.6.7.8' })).body.code, 'invalid', 'other networks are unaffected');
    assert.ok(!JSON.stringify(ctx.db.quotaCalls).includes('1.2.3.4'), 'the address is hashed, never stored');
});

test('lockout: an admin block has no end time, and an admin-disabled account says so', async () => {
    const ctx = world();
    const a = account(ctx);
    ctx.db.auth_lockouts.push({ email: 'user@example.com', device_id: '*', fails: 0, last_fail_at: null, blocked_at: NOW.toISOString(), manual: true });
    const blocked = await signIn(ctx);
    assert.deepEqual([blocked.body.code, blocked.body.manual, blocked.body.until], ['blocked', true, undefined]);
    later(ctx, 600);
    assert.equal((await signIn(ctx)).body.code, 'blocked', 'it does not expire');
    ctx.db.auth_lockouts.length = 0;
    a.banned = true;
    const disabled = await signIn(ctx);
    assert.equal(disabled.body.code, 'disabled');
    assert.equal(ctx.db.auth_lockouts.length, 0, 'a disabled account is not counted as a wrong password');
});

test('sign-in: if the database has not been updated yet, sign-in still works without lockouts', async () => {
    const ctx = world();
    account(ctx);
    delete ctx.db.auth_lockouts; // the table does not exist
    assert.equal((await signIn(ctx)).body.ok, true);
});

test('captcha: the token from the page is passed to the sign-in service, and a missing one is reported clearly', async () => {
    const ctx = world();
    account(ctx);
    ctx.db.captchaRequired = true;
    assert.equal((await signIn(ctx)).body.code, 'captcha');
    assert.equal(ctx.db.auth_lockouts.length, 0, 'a failed security check is not a wrong password');
    assert.equal((await signIn(ctx, { captcha: 'token-from-the-widget' })).body.ok, true);
    assert.equal((await call(ctx, { action: 'recover', email: 'user@example.com' })).body.code, 'captcha');
    assert.equal(ctx.db.auth_code_requests.length, 0);
});

// Forgot Password Section
test('forgot password: same answer for any email, then code + new password, every device signed out, lockout cleared', async () => {
    const ctx = world();
    account(ctx);
    const known = await call(ctx, { action: 'recover', email: 'user@example.com' });
    const unknown = await call(ctx, { action: 'recover', email: 'ghost@example.com' });
    assert.deepEqual(known.body, unknown.body);
    assert.equal(ctx.db.mail.length, 1);

    for (let i = 0; i < 5; i++) await signIn(ctx, { password: 'Wrong!Passw0rd' });
    assert.equal((await signIn(ctx)).body.code, 'blocked');

    assert.equal((await call(ctx, { action: 'reset', email: 'user@example.com', code: '123456', password: 'weak' })).body.code, 'weak_password');
    assert.equal((await call(ctx, { action: 'reset', email: 'user@example.com', code: '999999', password: 'N3w!Passw0rd#' })).body.code, 'bad_code');
    const done = await call(ctx, { action: 'reset', email: 'user@example.com', code: '123456', password: 'N3w!Passw0rd#' });
    assert.equal(done.body.ok, true);
    assert.ok(!done.body.session, 'the person signs in again with the new password');
    assert.equal(ctx.db.loggedOut, 1);
    assert.equal(ctx.db.auth_lockouts.length, 0);
    assert.equal((await signIn(ctx)).body.code, 'invalid', 'the old password no longer works');
    assert.equal((await signIn(ctx, { password: 'N3w!Passw0rd#' })).body.ok, true);
});

test('forgot password: an admin block survives a reset, and the old password can not be reused', async () => {
    const ctx = world();
    account(ctx);
    ctx.db.auth_lockouts.push({ email: 'user@example.com', device_id: '*', fails: 0, last_fail_at: null, blocked_at: NOW.toISOString(), manual: true });
    await call(ctx, { action: 'recover', email: 'user@example.com' });
    assert.equal((await call(ctx, { action: 'reset', email: 'user@example.com', code: '123456', password: GOOD })).body.code, 'same_password');
    ctx.db.nextCode = '222222';
    await call(ctx, { action: 'recover', email: 'user@example.com' });
    assert.equal((await call(ctx, { action: 'reset', email: 'user@example.com', code: '222222', password: 'N3w!Passw0rd#' })).body.ok, true);
    assert.equal(ctx.db.auth_lockouts.length, 1, 'only an admin can lift an admin block');
});

// Authenticator Section
test('recovery codes: 8 are made once the authenticator is on, only hashes are stored, and each works once', async () => {
    const ctx = world();
    const a = account(ctx, { factors: [{ id: 'f1', status: 'verified' }] });
    const aal1 = (await signIn(ctx)).body.session.access_token;
    const refused = await call(ctx, { action: 'recovery_codes' }, { token: aal1 });
    assert.equal(refused.status, 401, 'a password alone is not enough once an authenticator is on');

    const aal2 = `sess.${Buffer.from(JSON.stringify({ aal: 'aal2', sub: a.id })).toString('base64url')}.z`;
    ctx.db.users.set(aal2, () => ({ id: a.id, email: a.email, email_confirmed_at: 'x', factors: a.factors }));
    const made = await call(ctx, { action: 'recovery_codes' }, { token: aal2 });
    assert.equal(made.body.codes.length, 8);
    assert.equal(new Set(made.body.codes).size, 8);
    assert.equal(ctx.db.mfa_recovery_codes.length, 8);
    assert.ok(ctx.db.mfa_recovery_codes.every((row) => /^[0-9a-f]{64}$/.test(row.code_hash) && !made.body.codes.includes(row.code_hash)));

    const wrong = await call(ctx, { action: 'mfa_recover', email: 'user@example.com', password: GOOD, device: DEVICE, code: 'AAAAA-BBBBB' });
    assert.equal(wrong.body.code, 'invalid');
    assert.equal(ctx.db.auth_lockouts[0].fails, 1, 'a wrong recovery code counts like a wrong password');
    const noPassword = await call(ctx, { action: 'mfa_recover', email: 'user@example.com', password: 'Wrong!Passw0rd', device: DEVICE, code: made.body.codes[0] });
    assert.equal(noPassword.body.code, 'invalid', 'the code is useless without the password');

    const used = await call(ctx, { action: 'mfa_recover', email: 'user@example.com', password: GOOD, device: DEVICE, code: made.body.codes[0].toLowerCase() });
    assert.deepEqual([used.body.ok, used.body.authenticatorOff], [true, true]);
    assert.equal(a.factors.length, 0, 'the authenticator is turned off');
    assert.equal(ctx.db.mfa_recovery_codes.length, 0, 'the other codes are thrown away');
});

test('recovery codes: not available without an authenticator', async () => {
    const ctx = world();
    account(ctx);
    const token = (await signIn(ctx)).body.session.access_token;
    assert.equal((await call(ctx, { action: 'recovery_codes' }, { token })).body.code, 'no_authenticator');
    assert.equal((await call(ctx, { action: 'recovery_codes' })).status, 401);
});

test('every function: a password-only session is refused once an authenticator is on', async () => {
    const ctx = world();
    account(ctx, { factors: [{ id: 'f1', status: 'verified' }] });
    const token = (await signIn(ctx)).body.session.access_token;
    const { requireUser } = await import('../supabase/functions/_shared/guard.ts');
    const result = await requireUser(new Request('https://x', { headers: { authorization: `Bearer ${token}`, origin: ORIGIN } }));
    assert.ok(result instanceof Response);
    assert.equal(result.status, 401);
    assert.match((await result.json()).error, /authenticator/);
});
