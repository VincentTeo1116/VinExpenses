// The web app checks passwords, emails, names and codes while someone types; the server checks them again.
// This keeps the two copies in step, so the form never says "fine" to something the server will refuse (or the reverse).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = (rel) => import(pathToFileURL(path.join(__dirname, '..', rel)).href);

test('the browser rules match the server rules exactly (AU-04)', async () => {
    const server = await load('supabase/functions/_shared/auth-rules.ts');
    const web = await load('src/features/auth/rules.ts');

    const passwords = ['', 'a', 'abcdefghij', 'ABCDEFGHIJ', 'Abcdefghij', 'Abcdefghi1', 'Abcdefgh1!', 'Abcdefghij1!', 'abcdefghij1!', 'ABCDEFGHIJ1!', 'Str0ng!Passw0rd', 'short1!A',
        ' '.repeat(12), 'Ab1! Ab1! Ab1!', 'Ab1!'.repeat(18), `${'Ab1!'.repeat(18)}x`, 'Pässwörd123!', 'パスワードAb1!xyz'];
    for (const password of passwords) {
        const expected = server.checkPassword(password);
        const mine = web.passwordRules(password);
        assert.deepEqual(mine.map((r) => [r.key, r.met]), expected.rules.map((r) => [r.key, r.met]), JSON.stringify(password));
        assert.equal(web.passwordOk(password), expected.ok, JSON.stringify(password));
    }

    assert.equal(web.LIMITS.passwordMin, server.LIMITS.passwordMin);
    assert.equal(web.LIMITS.passwordMax, server.LIMITS.passwordMax);
    assert.equal(web.LIMITS.codeMinutes, server.LIMITS.codeMinutes);

    for (const value of ['a@b.co', 'A@B.CO', ' x@y.com ', 'no-at', 'a@b', "o'neil@example.com", 'a+b@c.io', `${'a'.repeat(250)}@b.co`, '', null, undefined, 'a b@c.co']) {
        assert.equal(web.cleanEmail(value), server.cleanEmail(value), String(value));
    }
    for (const value of ['Al', 'A', ' Amy  Tan ', '<b>x</b>', 'x'.repeat(40), 'x'.repeat(41), '']) {
        assert.equal(web.cleanName(value), server.cleanName(value), String(value));
    }
    for (const value of ['123456', '12345', '1234567', 'abcdef', ' 123456 ']) {
        assert.equal(web.isCode(value.trim()), server.isCode(value), value);
    }
    for (const value of ['abcde-fghjk', 'ABCDEFGHJK', 'abcde fghjk', 'short', 'ABCDE-FGHJK-X']) {
        assert.equal(web.cleanRecoveryCode(value), server.cleanRecoveryCode(value), value);
    }
});

test('the web app and the fake test server answer the sign-in service with the shapes the real function sends', async () => {
    // every reply code the web app knows how to word must be one the real function can send
    const handler = require('node:fs').readFileSync(path.join(__dirname, '..', 'supabase/functions/auth-gate/handler.ts'), 'utf8');
    const sent = new Set([...handler.matchAll(/code: "([a-z_]+)"/g)].map((m) => m[1]));
    const replyText = require('node:fs').readFileSync(path.join(__dirname, '..', 'src/features/auth/replyText.ts'), 'utf8');
    const known = new Set([...replyText.matchAll(/^\s+([a-z_]+): '/gm)].map((m) => m[1]));
    for (const code of ['invalid', 'exists', 'code_limit_day', 'code_limit_month', 'slow_down', 'bad_code', 'weak_password', 'same_password', 'captcha', 'disabled', 'unconfirmed']) {
        assert.ok(sent.has(code), `the function never sends "${code}"`);
        assert.ok(known.has(code), `the web app has no wording for "${code}"`);
    }
});
