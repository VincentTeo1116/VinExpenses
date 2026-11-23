// Checks that every email looks right and is safe to open.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const templates = () => import('../supabase/functions/_shared/email-templates.ts');
const report = (extra = {}) => ({
    label: 'October 2026', incomeTotal: 5200, expenseTotal: 2000, expenseCount: 3, incomeCount: 1,
    categories: [{ name: 'Food', amount: 1500 }, { name: 'Car', amount: 500 }],
    unsubscribeUrl: 'https://site.example/VinExpenses/email-action.html#a=unsub&t=abc', ...extra,
});

// What an email program will accept and what keeps a reader safe: no code, nothing fetched, tables + inline styles
function assertEmailSafe(html, name) {
    assert.ok(!/<script|<style|<link|<img|<iframe|<form|<object|javascript:|<[^>]*\son[a-z]+\s*=/i.test(html), `${name}: code, stylesheets, images or forms`);
    assert.ok(!/url\(|@import|@font-face/i.test(html), `${name}: nothing may be fetched when the email is opened`);
    for (const m of html.matchAll(/href="([^"]*)"/g)) {
        assert.ok(/^https:\/\//.test(m[1]) || m[1] === '{{ .ConfirmationURL }}', `${name}: link ${m[1]} is not https`);
    }
    assert.match(html, /^<!doctype html><html lang="en">/);
    assert.match(html, /role="presentation"/, `${name}: table layout`);
    assert.match(html, /VinExpenses/);
}

test('monthly report: totals, a line of plain English, category shares with bars, and an app button', async () => {
    const { reportEmail } = await templates();
    const mail = reportEmail(report({ appUrl: 'https://site.example/VinExpenses' }));
    assertEmailSafe(mail.html, 'report');
    assert.equal(mail.subject, 'Your VinExpenses report for October 2026');
    assert.match(mail.html, /RM\s?5,200\.00/);
    assert.match(mail.html, /You kept <strong>RM\s?3,200\.00<\/strong>/);
    assert.match(mail.html, /Food<\/td>.*RM\s?1,500\.00.*· 75%/s);
    assert.match(mail.html, /width="75%"/, 'the bar is as wide as the share');
    assert.match(mail.html, /width="25%"/);
    assert.match(mail.html, /href="https:\/\/site\.example\/VinExpenses"[^>]*>Open VinExpenses</);
    assert.match(mail.html, /Unsubscribe<\/a>/);
    assert.match(mail.text, /Open VinExpenses: https:\/\/site\.example\/VinExpenses/);
    assert.match(mail.text, /Unsubscribe: https:\/\/site\.example/);
});

test('monthly report: overspending, an empty month, many categories and hostile names', async () => {
    const { reportEmail } = await templates();
    const over = reportEmail(report({ incomeTotal: 1000 }));
    assert.match(over.html, /You spent <strong>RM\s?1,000\.00<\/strong> more than came in/);
    assert.ok(!/Open VinExpenses/.test(over.html), 'no button without an app address');

    const empty = reportEmail(report({ expenseTotal: 0, expenseCount: 0, categories: [] }));
    assert.match(empty.html, /No expenses recorded this month/);
    assert.match(empty.html, /0 expenses · 1 income record\./);

    const many = reportEmail(report({ expenseTotal: 1200, categories: Array.from({ length: 12 }, (_, i) => ({ name: `Cat ${i + 1}`, amount: 100 })) }));
    assert.match(many.html, /Cat 8</);
    assert.ok(!/Cat 9</.test(many.html));
    assert.match(many.html, /4 more categories<\/td>.*RM\s?400\.00/s);
    assert.match(many.text, /Cat 12: RM\s?100\.00/, 'the plain-text version still lists everything');
    const nine = reportEmail(report({ expenseTotal: 900, categories: Array.from({ length: 9 }, (_, i) => ({ name: `Cat ${i + 1}`, amount: 100 })) }));
    assert.match(nine.html, /Cat 9</, 'a single leftover category is shown by name, not as "1 more"');

    const hostile = reportEmail(report({ label: '<b>Oct</b>', categories: [{ name: '<img src=x onerror=alert(1)>', amount: 2000 }] }));
    assertEmailSafe(hostile.html, 'hostile report');
    assert.ok(hostile.html.includes('&lt;img src=x onerror=alert(1)&gt;'));
    assert.ok(hostile.html.includes('&lt;b&gt;Oct&lt;/b&gt;'));
    assert.throws(() => reportEmail(report({ appUrl: 'http://insecure.example' })));
    assert.throws(() => reportEmail(report({ appUrl: 'https://x.example/" onclick="x' })));
});

test('confirmation and administrator emails share the same safe layout', async () => {
    const { confirmEmail, adminTestEmail } = await templates();
    const confirm = confirmEmail('https://site.example/email-action.html#a=confirm&t=abc', 'a<b>@example.com');
    assertEmailSafe(confirm.html, 'confirm');
    assert.match(confirm.html, /Confirm email address<\/a>/);
    assert.ok(confirm.html.includes('a&lt;b&gt;@example.com'));
    const admin = adminTestEmail('2026-11-01T00:00:00Z', { Gmail: true, '<i>Site</i>': false });
    assertEmailSafe(admin.html, 'admin');
    assert.match(admin.html, /Needs attention/);
    assert.ok(admin.html.includes('&lt;i&gt;Site&lt;/i&gt;'));
});

test('sign-in emails: six templates, each with what Supabase needs, safe, and saved files match the code', async () => {
    const { authTemplates } = await templates();
    const list = authTemplates();
    assert.deepEqual(list.map((t) => t.key).sort(), ['confirmation', 'email_change', 'invite', 'magic_link', 'reauthentication', 'recovery']);
    for (const t of list) {
        assertEmailSafe(t.html, t.key);
        assert.ok(t.subject.includes('VinExpenses') && t.subject.length < 70, t.key);
        if (t.key === 'reauthentication') {
            assert.match(t.html, /\{\{ \.Token \}\}/);
            assert.ok(!t.html.includes('{{ .ConfirmationURL }}'));
        } else {
            assert.match(t.html, /href="\{\{ \.ConfirmationURL \}\}"/, `${t.key}: the button uses Supabase's link`);
            assert.match(t.html, /Copy this link into your browser/, `${t.key}: the link is also written out`);
        }
        // only placeholders Supabase really provides
        for (const m of t.html.matchAll(/\{\{\s*\.(\w+)\s*\}\}/g)) assert.ok(['ConfirmationURL', 'Email', 'NewEmail', 'Token'].includes(m[1]), `${t.key}: unknown placeholder ${m[1]}`);
        const saved = fs.readFileSync(path.join(root, 'supabase/templates', t.file), 'utf8').trim();
        assert.equal(saved, t.html, `supabase/templates/${t.file} is out of date. Run: node tools/auth-emails.js`);
    }
    assert.match(list.find((t) => t.key === 'recovery').html, /Your current password still works/);
    assert.match(list.find((t) => t.key === 'email_change').html, /\{\{ \.NewEmail \}\}/);
});

test('the upload tool reads secrets from the environment only, never prints them, and talks to Supabase alone', () => {
    const tool = fs.readFileSync(path.join(root, 'tools/auth-emails.js'), 'utf8');
    assert.ok(!/process\.argv\[[3-9]\]/.test(tool), 'no secret is read from the command line');
    assert.match(tool, /process\.env\.SUPABASE_ACCESS_TOKEN/);
    assert.match(tool, /process\.env\.SMTP_PASS/);
    assert.ok(!/(console\.[a-z]+|fail)\([^)]*(\$\{\s*(token|pass)\s*\}|[+,(]\s*(token|pass)\b)/.test(tool), 'secrets are never printed');
    assert.deepEqual([...tool.matchAll(/https:\/\/[a-z0-9.-]+/g)].map((m) => m[0]), ['https://api.supabase.com']);
    assert.match(tool, /smtp_host: 'smtp\.gmail\.com', smtp_port: '465'/, 'encrypted Gmail port only');
});
