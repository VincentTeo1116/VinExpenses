'use strict';
// Tests for the email building blocks: signed tokens, address checks, the mail settings, the message builder and the
// SMTP conversation (against a scripted fake Gmail, so nothing touches the network).
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { fakeSmtp, parseMessage } = require('./helpers/fakes.js');

const SECRET = 'a'.repeat(32) + 'SECRET-for-tests-0123456789';
const USER = '11111111-2222-4333-8444-555555555555';
const mod = (name) => import(`../supabase/functions/_shared/${name}.ts`);

// ------------------------------------------------------------------ signed tokens
test('token: round trip carries purpose, user, address and expiry', async () => {
    const { signToken, verifyToken } = await mod('email-tokens');
    const now = Date.UTC(2026, 0, 1);
    const token = await signToken(SECRET, 'verify', USER, ' Person@Example.COM ', 3600, now);
    const claim = await verifyToken(SECRET, token, 'verify', now + 1000);
    assert.deepEqual(claim, { purpose: 'verify', userId: USER, email: 'person@example.com', expires: now / 1000 + 3600 });
});

test('token: wrong purpose, wrong secret, expiry and tampering are all refused', async () => {
    const { signToken, verifyToken } = await mod('email-tokens');
    const now = Date.UTC(2026, 0, 1);
    const token = await signToken(SECRET, 'verify', USER, 'a@example.com', 60, now);
    assert.equal(await verifyToken(SECRET, token, 'unsub', now), null, 'a confirm link must not work as unsubscribe');
    assert.equal(await verifyToken('b'.repeat(40), token, 'verify', now), null, 'wrong secret');
    assert.equal(await verifyToken(SECRET, token, 'verify', now + 61_000), null, 'expired');
    const [payload, signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ p: 'verify', u: USER, e: 'victim@example.com', x: now / 1000 + 60 })).toString('base64url');
    assert.equal(await verifyToken(SECRET, `${forged}.${signature}`, 'verify', now), null, 'payload swapped, old signature');
    assert.equal(await verifyToken(SECRET, `${payload}.${signature.slice(0, -2)}AA`, 'verify', now), null, 'signature altered');
    assert.equal(await verifyToken(SECRET, `${payload}.`, 'verify', now), null);
    assert.equal(await verifyToken(SECRET, `${payload}`, 'verify', now), null);
});

test('token: garbage input never throws and is always null', async () => {
    const { verifyToken } = await mod('email-tokens');
    for (const junk of [undefined, null, 5, {}, [], '', 'x', '....', 'a.b.c', '%%%.%%%', 'A'.repeat(5000), '\u0000.\u0000']) {
        assert.equal(await verifyToken(SECRET, junk, 'verify'), null, String(junk).slice(0, 20));
    }
});

test('token: short secrets and bad user ids are refused at signing time', async () => {
    const { signToken } = await mod('email-tokens');
    await assert.rejects(signToken('short', 'verify', USER, 'a@example.com', 60));
    await assert.rejects(signToken(SECRET, 'verify', 'not-a-uuid', 'a@example.com', 60));
});

// ------------------------------------------------------------------ addresses and settings
test('normalizeEmail accepts normal addresses and rejects anything suspicious', async () => {
    const { normalizeEmail } = await mod('mailer');
    assert.equal(normalizeEmail('  Vin.Teo+tag@Gmail.com '), 'vin.teo+tag@gmail.com');
    assert.equal(normalizeEmail("o'brien@example.co.uk"), "o'brien@example.co.uk");
    assert.equal(normalizeEmail('a@example.com\n'), 'a@example.com', 'surrounding whitespace is trimmed, never kept');
    for (const bad of [
        'a@b','a@b.c', '@example.com', 'a@@example.com', 'a b@example.com', 'a@exa mple.com',
        'a@example.com\r\nBcc: victim@example.com', 'a\n@example.com', 'a@exa\nmple.com', 'a@example.com,b@example.com',
        '"a b"@example.com', 'a@[127.0.0.1]', 'a@127.0.0.1', '<a@example.com>', 'a@-example.com', 'a..b@example.com',
        '.a@example.com', 'a@example..com', 'x'.repeat(65) + '@example.com', 'a@' + 'x'.repeat(250) + '.com',
        null, undefined, 42, {}, ['a@example.com'],
    ]) assert.equal(normalizeEmail(bad), null, JSON.stringify(bad));
});

test('singleLine removes every kind of line break', async () => {
    const { singleLine } = await mod('mailer');
    assert.equal(singleLine('Hello\r\nBcc: x@y.com'), 'Hello Bcc: x@y.com');
    assert.equal(singleLine('a\u2028b\u2029c\u0000d\u007fe'), 'a b c d e');
    assert.equal(singleLine('x'.repeat(500), 10).length, 10);
});

test('loadMailConfig: Gmail defaults, password spaces removed, unsafe settings refused', async () => {
    const { loadMailConfig } = await mod('mailer');
    const cfg = loadMailConfig((n) => ({ SMTP_USER: 'Sender@Gmail.com', SMTP_PASS: 'abcd efgh ijkl mnop' })[n]);
    assert.deepEqual(cfg, { host: 'smtp.gmail.com', port: 465, user: 'sender@gmail.com', pass: 'abcdefghijklmnop', fromName: 'VinExpenses' });
    const bad = (env) => loadMailConfig((n) => env[n]);
    assert.match(bad({}), /SMTP_USER/);
    assert.match(bad({ SMTP_USER: 'a@gmail.com' }), /SMTP_PASS/);
    assert.match(bad({ SMTP_USER: 'a@gmail.com', SMTP_PASS: 'short' }), /app password/);
    assert.match(bad({ SMTP_USER: 'a@gmail.com', SMTP_PASS: 'abcdefghijklmnop', SMTP_PORT: '587' }), /465/);
    assert.match(bad({ SMTP_USER: 'a@gmail.com', SMTP_PASS: 'abcdefghijklmnop', SMTP_PORT: '25' }), /465/);
    assert.match(bad({ SMTP_USER: 'a@gmail.com', SMTP_PASS: 'abcdefghijklmnop', SMTP_HOST: 'evil host' }), /SMTP_HOST/);
    assert.match(bad({ SMTP_USER: 'a@gmail.com', SMTP_PASS: 'abc\r\nQUIT' }), /app password/);
    const named = loadMailConfig((n) => ({ SMTP_USER: 'a@gmail.com', SMTP_PASS: 'abcdefghijklmnop', EMAIL_FROM_NAME: 'Bad"<x>\r\nBcc: z' })[n]);
    assert.ok(!/["<>\r\n]/.test(named.fromName), named.fromName);
});

test('prepareMail rejects header injection and unsupported headers', async () => {
    const { prepareMail } = await mod('mailer');
    const ok = { to: 'a@example.com', subject: 'Hi', html: '<p>x</p>', text: 'x' };
    assert.equal(prepareMail(ok).to, 'a@example.com');
    assert.equal(prepareMail({ ...ok, subject: 'Hi\r\nBcc: x@y.com' }).subject, 'Hi Bcc: x@y.com');
    assert.throws(() => prepareMail({ ...ok, to: 'a@example.com\r\nBcc: x@y.com' }));
    assert.throws(() => prepareMail({ ...ok, subject: '\r\n' }));
    assert.throws(() => prepareMail({ ...ok, html: '' }));
    assert.throws(() => prepareMail({ ...ok, text: 'x'.repeat(300_000) }));
    assert.throws(() => prepareMail({ ...ok, headers: { Bcc: 'x@y.com' } }));
    assert.throws(() => prepareMail({ ...ok, headers: { 'List-Unsubscribe': '<http://insecure.example/u>' } }));
    assert.throws(() => prepareMail({ ...ok, headers: { 'List-Unsubscribe': '<https://a.example/u>\r\nBcc: x@y.com' } }));
    assert.deepEqual(prepareMail({ ...ok, headers: { 'List-Unsubscribe': '<https://a.example/u?t=1>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } }).headers,
        { 'List-Unsubscribe': '<https://a.example/u?t=1>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' });
});

// ------------------------------------------------------------------ message builder
test('buildMime: correct headers, base64 parts that decode back, non-ASCII safe', async () => {
    const { buildMime, encodeHeaderText } = await mod('smtp');
    const raw = buildMime({
        fromAddress: 'sender@gmail.com', fromName: 'VinExpenses', to: 'person@example.com',
        subject: 'Laporan Oktober – RM 1,234.50 ✅', text: 'Hello é你好', html: '<p>Hello</p>',
        headers: { 'List-Unsubscribe': '<https://x.supabase.co/functions/v1/email-action?a=unsub&t=abc>' },
        now: new Date(Date.UTC(2026, 10, 1, 1, 2, 3)),
    });
    assert.ok(!/(^|[^\r])\n/.test(raw), 'every line break is CRLF');
    const { headers, parts } = parseMessage(raw);
    assert.equal(headers.from, '"VinExpenses" <sender@gmail.com>');
    assert.equal(headers.to, '<person@example.com>');
    assert.equal(headers['mime-version'], '1.0');
    assert.match(headers.date, /^Sun, 01 Nov 2026 01:02:03 \+0000$/);
    assert.match(headers['message-id'], /^<[0-9a-f]{32}@gmail\.com>$/);
    assert.match(headers['content-type'], /^multipart\/alternative; boundary="=_vx_[0-9a-f]{32}"$/);
    assert.match(headers['list-unsubscribe'], /^<https:\/\//);
    assert.match(headers.subject, /^=\?UTF-8\?B\?/);
    const subject = headers.subject.split(' ').map((w) => Buffer.from(w.replace(/^=\?UTF-8\?B\?|\?=$/g, ''), 'base64').toString('utf8')).join('');
    assert.equal(subject, 'Laporan Oktober – RM 1,234.50 ✅');
    assert.equal(parts['text/plain'], 'Hello é你好');
    assert.equal(parts['text/html'], '<p>Hello</p>');
    for (const line of raw.split('\r\n')) assert.ok(line.length <= 998, 'line too long');
    assert.equal(encodeHeaderText('Plain ASCII subject'), 'Plain ASCII subject');
});

test('buildMime refuses line breaks, odd addresses and unknown headers', async () => {
    const { buildMime } = await mod('smtp');
    const base = { fromAddress: 'sender@gmail.com', fromName: 'N', to: 'a@example.com', subject: 'S', text: 't', html: 'h' };
    assert.doesNotThrow(() => buildMime(base));
    for (const patch of [
        { to: 'a@example.com\r\nRCPT TO:<x@y.com>' }, { subject: 'S\nBcc: x' }, { fromName: 'N\r\nX: y' },
        { fromAddress: 'a@b.com>\r\nX: y' }, { to: 'a@example.com, b@example.com' }, { to: '<a@example.com>' },
        { headers: { Bcc: 'x@y.com' } }, { headers: { 'Auto-Submitted': 'a\r\nBcc: x' } },
    ]) assert.throws(() => buildMime({ ...base, ...patch }), (e) => e.name === 'SmtpError' && e.stage === 'build', JSON.stringify(patch));
});

test('dotStuff doubles a dot at the start of any line, and nothing else', async () => {
    const { dotStuff } = await mod('smtp');
    assert.equal(dotStuff('.a\r\nb\r\n.\r\n..c\r\nd.e\r\n'), '..a\r\nb\r\n..\r\n...c\r\nd.e\r\n');
});

// ------------------------------------------------------------------ the SMTP conversation
const account = { host: 'smtp.gmail.com', port: 465, user: 'sender@gmail.com', pass: 'abcdefghijklmnop' };
const message = { fromAddress: 'sender@gmail.com', fromName: 'VinExpenses', to: 'person@example.com', subject: 'Hello', text: 'Body', html: '<b>Body</b>' };

test('smtp: a full successful delivery, step by step', async () => {
    const { sendSmtp } = await mod('smtp');
    const server = fakeSmtp();
    await sendSmtp(account, message, server.connector);
    assert.deepEqual(server.state.connected, { host: 'smtp.gmail.com', port: 465 });
    const t = server.transcript;
    assert.equal(t[0], 'EHLO vinexpenses');
    assert.equal(t[1], 'AUTH PLAIN ' + Buffer.from('\u0000sender@gmail.com\u0000abcdefghijklmnop').toString('base64'));
    assert.deepEqual(t.slice(2), ['MAIL FROM:<sender@gmail.com>', 'RCPT TO:<person@example.com>', 'DATA', '<message>', 'QUIT']);
    assert.equal(server.state.closed, true, 'connection closed afterwards');
    assert.ok(server.state.message.endsWith('\r\n'));
});

test('smtp: replies split into tiny pieces and multi-line replies are handled', async () => {
    const { sendSmtp } = await mod('smtp');
    const server = fakeSmtp({ chunk: 3 });
    await sendSmtp(account, message, server.connector);
    assert.equal(server.transcript.at(-1), 'QUIT');
});

test('smtp: a body line starting with "." can not end the message early', async () => {
    const { sendSmtp } = await mod('smtp');
    const server = fakeSmtp();
    await sendSmtp(account, { ...message, text: 'a\r\n.\r\nQUIT\r\nMAIL FROM:<evil@x.com>\r\n.\r\n' }, server.connector);
    assert.equal(server.transcript.filter((l) => l.startsWith('MAIL')).length, 1);
    const { parts } = parseMessage(server.state.message);
    assert.equal(parts['text/plain'], 'a\r\n.\r\nQUIT\r\nMAIL FROM:<evil@x.com>\r\n.\r\n');
});

test('smtp: each failure is reported at the right step and the password never appears in the error', async () => {
    const { sendSmtp } = await mod('smtp');
    const cases = [
        [{ greeting: '554 no service' }, 'greeting', 554],
        [{ ehlo: '502 not implemented' }, 'hello', 502],
        [{ auth: '535-5.7.8 Username and Password not accepted\r\n535 5.7.8 learn more' }, 'auth', 535],
        [{ mail: '553 bad sender' }, 'sender', 553],
        [{ rcpt: '550 5.1.1 no such user' }, 'recipient', 550],
        [{ data: '451 try later' }, 'data', 451],
        [{ end: '552 message too large' }, 'send', 552],
    ];
    for (const [reply, stage, code] of cases) {
        const server = fakeSmtp({ reply });
        await assert.rejects(sendSmtp(account, message, server.connector), (e) => {
            assert.equal(e.name, 'SmtpError');
            assert.equal(e.stage, stage);
            assert.equal(e.code, code);
            assert.ok(!e.message.includes(account.pass) && !e.message.includes('Username'), 'no secret or server text in the message');
            assert.equal(e.retryable, code >= 400 && code < 500, `retryable for ${code}`);
            return true;
        });
        assert.equal(server.state.closed, true, 'connection closed after a failure');
    }
});

test('smtp: connection refused, dropped mid-way, junk replies and oversized replies', async () => {
    const { sendSmtp } = await mod('smtp');
    const refused = fakeSmtp({ refuse: true });
    await assert.rejects(sendSmtp(account, message, refused.connector), (e) => e.stage === 'connect' && e.retryable === true);
    const dropped = fakeSmtp({ dropAt: 'AUTH' });
    await assert.rejects(sendSmtp(account, message, dropped.connector), (e) => e.stage === 'auth' && /closed/.test(e.message));
    const junk = fakeSmtp({ reply: { greeting: 'HTTP/1.1 200 OK' } });
    await assert.rejects(sendSmtp(account, message, junk.connector), (e) => e.stage === 'greeting' && /not SMTP/.test(e.message));
    const huge = fakeSmtp({ reply: { greeting: '220-' + 'x'.repeat(40_000) + '\r\n220 done' } });
    await assert.rejects(sendSmtp(account, message, huge.connector), (e) => /oversized/.test(e.message));
});

test('smtp: a silent server times out instead of hanging', async () => {
    const { sendSmtp, SMTP_TIMEOUTS } = await mod('smtp');
    const saved = { ...SMTP_TIMEOUTS };
    SMTP_TIMEOUTS.stepMs = 60;
    try {
        const server = fakeSmtp({ hangAt: 'EHLO' });
        await assert.rejects(sendSmtp(account, message, server.connector), (e) => e.stage === 'hello' && /too long/.test(e.message) && e.retryable);
        assert.equal(server.state.closed, true);
    } finally { Object.assign(SMTP_TIMEOUTS, saved); }
});

test('smtp: refuses other ports, bad hosts, bad credentials and unsafe messages BEFORE connecting', async () => {
    const { sendSmtp } = await mod('smtp');
    const never = fakeSmtp();
    for (const [acc, msg] of [
        [{ ...account, port: 587 }, message], [{ ...account, port: 25 }, message], [{ ...account, host: 'evil host' }, message],
        [{ ...account, pass: 'abc\r\nQUIT' }, message], [{ ...account, user: '' }, message],
        [account, { ...message, to: 'a@example.com\r\nRCPT TO:<x@y.com>' }],
    ]) await assert.rejects(sendSmtp(acc, msg, never.connector));
    assert.equal(never.state.opened, 0, 'no connection was ever opened');
});

test('sendEmail: wraps the conversation and gives a hint instead of server text', async () => {
    const { sendEmail } = await mod('mailer');
    const cfg = { host: 'smtp.gmail.com', port: 465, user: 'sender@gmail.com', pass: 'abcdefghijklmnop', fromName: 'VinExpenses' };
    const mail = { to: 'Person@Example.com', subject: 'Hi', html: '<p>x</p>', text: 'x' };
    assert.deepEqual(await sendEmail(cfg, mail, fakeSmtp().connector), { ok: true });
    const bad = await sendEmail(cfg, mail, fakeSmtp({ reply: { auth: '535 5.7.8 nope' } }).connector);
    assert.equal(bad.ok, false);
    assert.equal(bad.stage, 'auth');
    assert.match(bad.reason, /App Password/);
    assert.ok(!JSON.stringify(bad).includes(cfg.pass));
    const unsafe = await sendEmail(cfg, { ...mail, to: 'nope' }, fakeSmtp().connector);
    assert.equal(unsafe.ok, false);
    assert.equal(unsafe.stage, 'build');
    assert.equal(unsafe.retryable, false);
    const limit = await sendEmail(cfg, mail, fakeSmtp({ reply: { end: '550 5.4.5 Daily user sending limit exceeded' } }).connector);
    assert.match(limit.reason, /sending limit/);
});

test('denoConnector: real TLS-socket adapter reads and writes through Deno.connectTls', async () => {
    // Stand in for Deno.connectTls with a local plain TCP socket speaking SMTP, to exercise the adapter code itself.
    const { sendSmtp, denoConnector } = await mod('smtp');
    const received = [];
    const server = net.createServer((socket) => {
        let buffer = '';
        let inData = false;
        socket.write('220 test ready\r\n');
        socket.on('data', (chunk) => {
            buffer += chunk.toString();
            if (inData) { if (buffer.endsWith('\r\n.\r\n')) { inData = false; buffer = ''; socket.write('250 queued\r\n'); } return; }
            let i;
            while ((i = buffer.indexOf('\r\n')) !== -1) {
                const line = buffer.slice(0, i); buffer = buffer.slice(i + 2); received.push(line.split(' ')[0]);
                if (line.startsWith('EHLO')) socket.write('250 hi\r\n');
                else if (line.startsWith('AUTH')) socket.write('235 ok\r\n');
                else if (line.startsWith('MAIL') || line.startsWith('RCPT')) socket.write('250 ok\r\n');
                else if (line === 'DATA') { inData = true; socket.write('354 go\r\n'); }
            }
        });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const opened = [];
    globalThis.Deno = {
        env: { get: () => undefined },
        connectTls: async ({ hostname, port: requested }) => {
            opened.push({ hostname, requested });
            const socket = net.connect(port, '127.0.0.1');
            await new Promise((resolve) => socket.once('connect', resolve));
            const queue = [];
            let waiter = null;
            let ended = false;
            socket.on('data', (d) => { queue.push(new Uint8Array(d)); if (waiter) { const w = waiter; waiter = null; w(); } });
            socket.on('end', () => { ended = true; if (waiter) { const w = waiter; waiter = null; w(); } });
            return {
                async read(buf) {
                    if (!queue.length && !ended) await new Promise((resolve) => { waiter = resolve; });
                    if (!queue.length) return null;
                    const chunk = queue.shift();
                    buf.set(chunk.subarray(0, buf.length));
                    return Math.min(chunk.length, buf.length);
                },
                async write(data) { socket.write(Buffer.from(data)); return data.length; },
                close() { socket.destroy(); },
            };
        },
    };
    try {
        await sendSmtp(account, message, denoConnector);
        assert.deepEqual(opened, [{ hostname: 'smtp.gmail.com', requested: 465 }]);
        assert.deepEqual(received.slice(0, 5), ['EHLO', 'AUTH', 'MAIL', 'RCPT', 'DATA']);
    } finally {
        delete globalThis.Deno;
        await new Promise((resolve) => server.close(resolve));
    }
});

// ------------------------------------------------------------------ templates
test('templates: escape every dynamic value and only link to https', async () => {
    const { reportEmail, confirmEmail, adminTestEmail, escapeHtml } = await mod('email-templates');
    assert.equal(escapeHtml(`<img src=x onerror="a">&'`), '&lt;img src=x onerror=&quot;a&quot;&gt;&amp;&#39;');
    const report = reportEmail({
        label: 'October 2026', incomeTotal: 5000, expenseTotal: 1234.5, expenseCount: 3, incomeCount: 1,
        categories: [{ name: '<script>alert(1)</script>', amount: 10 }], unsubscribeUrl: 'https://site.example/email-action.html#a=unsub&t=abc',
    });
    assert.ok(!report.html.includes('<script>'), 'category name must be escaped');
    assert.ok(report.html.includes('&lt;script&gt;'));
    assert.match(report.html, /RM\s?1,234\.50/);
    assert.match(report.text, /Unsubscribe: https:\/\/site\.example/);
    assert.throws(() => reportEmail({ label: 'x', incomeTotal: 0, expenseTotal: 0, expenseCount: 0, incomeCount: 0, categories: [], unsubscribeUrl: 'javascript:alert(1)' }));
    assert.throws(() => reportEmail({ label: 'x', incomeTotal: 0, expenseTotal: 0, expenseCount: 0, incomeCount: 0, categories: [], unsubscribeUrl: 'https://a.example/" onclick="x' }));
    const confirm = confirmEmail('https://site.example/email-action.html#a=confirm&t=abc', 'a@example.com');
    assert.match(confirm.html, /href="https:\/\/site\.example/);
    assert.throws(() => confirmEmail('http://insecure.example', 'a@example.com'));
    assert.match(adminTestEmail('2026-11-01T00:00:00Z', { 'Gmail': true, 'Site': false }).text, /Site: needs attention/);
});
