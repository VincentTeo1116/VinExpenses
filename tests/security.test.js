'use strict';
// Security tests: they fail if a protection is removed or weakened.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const walk = (dir, out = []) => {
    for (const name of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
        const rel = path.join(dir, name.name);
        if (name.isDirectory()) walk(rel, out); else out.push(rel);
    }
    return out;
};
const cspOf = (html) => /http-equiv="Content-Security-Policy"[^>]*content="([^"]*)"/i.exec(html)[1];
const directive = (csp, name) => (csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(name + ' ')) || '').split(/\s+/).slice(1);

// Pages and the Content-Security-Policy Section
for (const page of ['index.html', 'email-action.html', 'welcome.html', 'privacy.html', 'terms.html']) {
    test(`${page}: strict Content-Security-Policy, placed before anything that loads`, () => {
        const html = read(page);
        const csp = cspOf(html);
        assert.ok(html.indexOf('Content-Security-Policy') < html.search(/<script|<link/), 'policy must come first');
        assert.deepEqual(directive(csp, 'default-src'), ["'none'"]);
        assert.deepEqual(directive(csp, 'script-src'), ["'self'"], 'scripts: only this site, no inline, no eval, no CDN');
        assert.ok(!/unsafe-eval|unsafe-hashes|data:|https?:\/\/(?!\*\.supabase\.co|nominatim\.openstreetmap\.org)/.test(directive(csp, 'script-src').join(' ')));
        assert.deepEqual(directive(csp, 'style-src'), ["'self'"]);
        assert.deepEqual(directive(csp, 'base-uri'), ["'none'"]);
        assert.ok(!/(^|\s)\*(\s|$)/.test(csp), 'no bare wildcard');
        const connect = directive(csp, 'connect-src');
        for (const source of connect) assert.ok(["'self'", 'https://*.supabase.co', 'https://nominatim.openstreetmap.org'].includes(source), `unexpected connect-src ${source}`);
        if (page === 'index.html') assert.deepEqual(directive(csp, 'object-src'), ["'none'"]);
    });

    test(`${page}: loads nothing from other websites and has no inline code or event handlers`, () => {
        const html = read(page);
        assert.ok(!/<(script|link|img|iframe|source|embed|object)[^>]+(src|href)="(https?:)?\/\//i.test(html), 'external resource');
        assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/i.test(html), 'inline <script>');
        assert.ok(!/\son[a-z]+\s*=/i.test(html), 'inline event handler');
        assert.ok(!/javascript:/i.test(html), 'javascript: URL');
        assert.ok(!/<style[\s>]/i.test(html), 'inline <style> block');
        assert.match(html, /name="referrer"/);
        assert.match(html, /src="frame-guard\.js"/, 'clickjacking guard');
    });
}

test('email-action page: reads the token from the URL fragment and acts only after a button press', () => {
    const js = read('email-action.js');
    assert.match(js, /location\.hash/);
    assert.match(js, /history\.replaceState/, 'token removed from the address bar');
    assert.match(js, /addEventListener\('click'/);
    assert.ok(!/innerHTML|document\.write|eval\(|new Function/.test(js));
    assert.match(js, /\/\^https:\\\/\\\/\[a-z0-9\]\+\\\.supabase\\\.co\$\//, 'only a real *.supabase.co address is ever called');
});

test('app code never puts server or user text into the page as HTML (new email code uses textContent)', () => {
    const app = read('app.js');
    const block = app.slice(app.indexOf('async function loadAdminStatus'), app.indexOf('$(\'adminEmailTestBtn\')'));
    assert.ok(block.length > 200);
    assert.ok(!/innerHTML/.test(block), 'admin section must not use innerHTML');
    assert.match(app, /function escapeHtml/);
});

// Vendored libraries and supply chain Section
test('vendor/: every file matches the lockfile hashes (nothing swapped, added or removed)', () => {
    const out = execFileSync(process.execPath, ['tools/vendor.js', 'verify'], { cwd: root, encoding: 'utf8' });
    assert.match(out, /files match the lockfile/);
});

test('vendor/: a tampered library file is detected', () => {
    const file = path.join(root, 'vendor/chartjs/chart.umd.js');
    const original = fs.readFileSync(file);
    try {
        fs.writeFileSync(file, Buffer.concat([original, Buffer.from('\n/* injected */')]));
        assert.throws(() => execFileSync(process.execPath, ['tools/vendor.js', 'verify'], { cwd: root, stdio: 'pipe' }), /./);
    } finally { fs.writeFileSync(file, original); }
    execFileSync(process.execPath, ['tools/vendor.js', 'verify'], { cwd: root, stdio: 'pipe' });
});

test('deploy workflow: actions pinned to commits, tests + vendor check before deploy, CSP pinned for both pages', () => {
    const yml = read('.github/workflows/deploy.yml');
    const uses = [...yml.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
    assert.ok(uses.length >= 4);
    for (const u of uses) assert.match(u, /@[0-9a-f]{40}$/, `${u} must be pinned to a full commit hash`);
    assert.match(yml, /node tools\/vendor\.js verify/);
    assert.match(yml, /node --test/);
    assert.match(yml, /pin-csp\.js dist\/index\.html dist\/email-action\.html/);
    assert.match(yml, /email-action\.html email-action\.js email-action\.css/);
    assert.ok(yml.indexOf('node --test') < yml.indexOf('deploy-pages'));
    assert.match(yml, /^permissions:/m);
});

test('functions workflow: never runs for pull requests, pins everything, gives the token only to the deploy step', () => {
    const yml = read('.github/workflows/deploy-functions.yml');
    assert.ok(!/pull_request/.test(yml), 'a pull request (possibly from a stranger) must never reach the Supabase token');
    assert.match(yml, /branches: \[main\]/);
    for (const u of [...yml.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1])) assert.match(u, /@[0-9a-f]{40}$/, `${u} must be pinned to a commit`);
    assert.match(yml, /supabase@\d+\.\d+\.\d+ functions deploy/, 'exact CLI version, no "latest"');
    assert.match(yml, /permissions:\s*\n\s*contents: read/);
    assert.ok(yml.indexOf('node --test') < yml.indexOf('functions deploy'), 'tests run first');
    assert.equal((yml.match(/secrets\.SUPABASE_ACCESS_TOKEN/g) || []).length, 1, 'the token appears once, in the deploy step only');
    assert.ok(!/echo[^\n]*\$SUPABASE_ACCESS_TOKEN/.test(yml), 'the token is never printed');
});

test('pin-csp: narrows the wildcard to one exact project and refuses anything suspicious', () => {
    const { pinCsp, cspOf: cspFrom } = require('../tools/pin-csp.js');
    const html = read('index.html');
    const pinned = pinCsp(html, 'https://abcdefghij.supabase.co/');
    assert.deepEqual(directive(cspFrom(pinned), 'connect-src'), ["'self'", 'https://abcdefghij.supabase.co', 'https://nominatim.openstreetmap.org']);
    assert.ok(!cspFrom(pinned).includes('*'));
    assert.ok(html.includes('https://*.supabase.co'), 'the committed file keeps the dev wildcard');
    for (const bad of ['', undefined, 'http://abcdefghij.supabase.co', 'https://evil.com', 'https://abcdefghij.supabase.co.evil.com',
        'https://abc.supabase.co', 'https://*.supabase.co', 'https://abcdefghij.supabase.co/path', 'https://user@abcdefghij.supabase.co', 'javascript:alert(1)']) {
        assert.throws(() => pinCsp(html, bad), /SUPABASE_URL|wildcard/, String(bad));
    }
    assert.throws(() => pinCsp('<html></html>', 'https://abcdefghij.supabase.co'), /No Content-Security-Policy/);
    assert.throws(() => pinCsp(pinned, 'https://abcdefghij.supabase.co'), /nothing to pin/, 'pinning twice is refused, not silently ignored');
});

test('service worker: handles only this site, caches only good same-origin responses', () => {
    const sw = read('sw.js');
    assert.match(sw, /origin !== self\.location\.origin\) return/);
    assert.match(sw, /res\.type === 'basic'/);
    assert.ok(!/type === 'opaque'/.test(sw), 'cross-origin (opaque) responses must not be cached');
    for (const file of ['vendor/supabase-js/supabase.js', 'frame-guard.js', 'fonts.css']) assert.ok(sw.includes(`'${file}'`), file);
});

// Edge functions Section
const functions = fs.readdirSync(path.join(root, 'supabase/functions'), { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== '_shared').map((d) => d.name);

test('Telegram: the public webhook proves who is calling, and its tables are server-only', () => {
    const bot = read('supabase/functions/telegram-bot/handler.ts');
    assert.match(bot, /safeEqual\(request\.headers\.get\("x-telegram-bot-api-secret-token"\)/);
    assert.match(bot, /secret\.length < 24/, 'a missing or short secret closes the door, never opens it');
    assert.ok(bot.indexOf('safeEqual(') < bot.indexOf('request.text()'), 'the secret is checked before the body is read');
    assert.match(bot, /chat\?\.type !== "private"|chat\.type !== "private"/, 'private chats only');
    // Every query that reaches user data must be scoped to the linked user (the server key ignores row-level security).
    for (const [, query] of bot.matchAll(/rest\(`((?:expenses|incomes|user_categories|user_payment_methods)[^`]*)`/g)) {
        assert.match(query, /user_id=eq\.\$\{q\((link\.user_id|userId)\)\}/, `unscoped query: ${query}`);
    }
    const sql = read('supabase-schema.sql');
    for (const table of ['telegram_links', 'telegram_link_codes', 'telegram_seen']) {
        assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
        assert.match(sql, new RegExp(`revoke all on public\\.${table} from anon, authenticated`));
    }
    const link = read('supabase/functions/telegram-link/handler.ts');
    assert.match(link, /requireUser\(request\)/);
    assert.match(link, /sha256Hex\(/, 'link codes are stored hashed');
    assert.match(read('tools/set-telegram-webhook.js'), /secret_token/);
    assert.ok(!/process\.argv/.test(read('tools/set-telegram-webhook.js')), 'the token is never taken from the command line');
});

test('Telegram extras: new tables are server-only, the summary sender is scheduler-only, photos go through the shared limit', () => {
    const sql = read('supabase-schema.sql');
    assert.match(sql, /alter table public\.telegram_pending enable row level security/);
    assert.match(sql, /revoke all on public\.telegram_pending from anon, authenticated/);
    assert.match(sql, /check \(lang in \('en', 'ms', 'zh'\)\)/);
    const digest = read('supabase/functions/telegram-digest/handler.ts');
    assert.match(digest, /safeEqual\(request\.headers\.get\("x-cron-secret"\)/);
    assert.match(digest, /cronSecret\.length < 24/);
    const bot = read('supabase/functions/telegram-bot/handler.ts');
    assert.match(bot, /takeReceiptQuota\(/, 'a photo costs one scan from the same daily allowance as the app');
    assert.ok(bot.indexOf('takeReceiptQuota(') < bot.indexOf('runOcr('), 'the allowance is checked before the paid OCR call');
    assert.match(bot, /mime_type/, 'only images are accepted as files');
    for (const [, query] of bot.matchAll(/rest\(`((?:telegram_pending|telegram_links)[^`]*)`/g)) {
        assert.match(query, /chat_id=eq\.\$\{(chatId|chat|link\.chat_id)\}|user_id=eq\.\$\{q\(userId\)\}|expires_at=lt\.|\?on_conflict=chat_id/, `unscoped chat query: ${query}`);
    }
    const ocr = read('supabase/functions/_shared/ocr.ts');
    assert.match(ocr, /mimeFromBytes/, 'the real file type decides, not what the sender claims');
    assert.ok(!/console\./.test(ocr), 'receipt images and text are never logged');
});

test('Telegram charts: drawn locally with no outside service, every report query is scoped to one person, views are rate-limited', () => {
    const chart = read('supabase/functions/_shared/tg-chart.ts');
    assert.ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|^import\s/m.test(chart), 'the chart code has no network access and no dependencies: spending numbers never leave your server');
    const views = read('supabase/functions/_shared/tg-views.ts');
    for (const [, query] of views.matchAll(/`((?:expenses|incomes|budgets|user_categories)\?[^`]*)`/g)) {
        assert.match(query, /user_id=eq\.\$\{q\(userId\)\}/, `unscoped report query: ${query}`);
    }
    const reports = read('supabase/functions/_shared/tg-reports.ts');
    for (const [, query] of reports.matchAll(/`((?:expenses|incomes|budgets)\?[^`]*)`/g)) {
        assert.match(query, /user_id=eq\.\$\{q\(userId\)\}/, `unscoped report query: ${query}`);
    }
    const bot = read('supabase/functions/telegram-bot/handler.ts');
    assert.match(bot, /takeQuota\(`tg-view:/, 'report views are counted per chat');
    assert.match(bot, /MAX_OFFSET\[kind\]/, 'navigation offsets are bounded');
    assert.match(bot, /\^n:\(\[dwmpybt\]\):\(\\d\{1,3\}\)\$/, 'navigation data is strictly validated');
    assert.match(read('supabase/functions/telegram-digest/handler.ts'), /buildView\(/, 'the Monday summary uses the same view code');
    assert.ok(!/api\.quickchart|chart\.googleapis|image-charts/i.test([chart, views, bot].join('\n')), 'no third-party chart service');
});

test('every edge function has an explicit entry in config.toml, and only the intended ones are public', () => {
    const toml = read('supabase/config.toml');
    const settings = Object.fromEntries([...toml.matchAll(/\[functions\.([a-z-]+)\]\s*\n\s*verify_jwt\s*=\s*(true|false)/g)].map((m) => [m[1], m[2]]));
    for (const name of functions) assert.ok(name in settings, `${name} missing from config.toml`);
    assert.deepEqual(Object.keys(settings).filter((n) => settings[n] === 'false').sort(), ['auth-gate', 'email-action', 'feedback', 'miniapp-api', 'monthly-report-email', 'plan-reminders', 'telegram-bot', 'telegram-digest']);
});

test('no function allows every website (CORS *) and none builds its own CORS headers', () => {
    for (const file of walk('supabase/functions').filter((f) => f.endsWith('.ts'))) {
        const code = read(file);
        assert.ok(!/Access-Control-Allow-Origin["']?\s*[:,]\s*["']\*/i.test(code), `${file} allows *`);
        if (!file.endsWith('guard.ts')) assert.ok(!/Access-Control-Allow-Origin/i.test(code), `${file} builds its own CORS headers`);
    }
});

test('browser-facing functions all sit behind the same guard: allowed website + signed-in user', () => {
    for (const name of ['receipt-ocr', 'receipt-ai', 'nearby-place', 'delete-account', 'email-verify', 'admin-email-test', 'telegram-link', 'admin', 'report-resend']) {
        const code = read(`supabase/functions/${name}/${fs.existsSync(path.join(root, `supabase/functions/${name}/handler.ts`)) ? 'handler' : 'index'}.ts`);
        assert.match(code, /preflight\(request\)/, `${name}: preflight`);
        assert.match(code, /requireUser\(request\)/, `${name}: requireUser`);
    }
    const guard = read('supabase/functions/_shared/guard.ts');
    assert.match(guard, /allowedOrigins\(\)\.includes\(origin\)/);
    assert.ok(!/allowedOrigins\(\)\.length === 0\s*\?\s*["']\*/.test(guard), 'an unset ALLOWED_ORIGINS must not mean "everyone"');
});

test('the scheduler-only function compares its secret in constant time and refuses an unset secret', () => {
    const code = read('supabase/functions/monthly-report-email/handler.ts');
    assert.match(code, /safeEqual\(/);
    assert.ok(!/x-cron-secret"\)\s*!==/.test(code), 'plain !== comparison');
    assert.match(code, /cronSecret\.length < 24/);
});

test('mail code: no SMTP port other than 465, no plain-text fallback, no old provider left', () => {
    const files = walk('supabase/functions').filter((f) => f.endsWith('.ts'));
    const joined = files.map(read).join('\n');
    // the old mail provider called Resend; "send again" features may still use the ordinary word
    assert.ok(!/api\.resend\.com|RESEND_API_KEY|RESEND_FROM/i.test(joined), 'the old Resend mail provider should be gone');
    assert.ok(!/STARTTLS|connect\(\s*\{[^}]*port:\s*(25|587)/i.test(joined.replace(/\/\/.*$/gm, '')), 'no STARTTLS / plaintext SMTP');
    assert.match(read('supabase/functions/_shared/smtp.ts'), /account\.port !== 465/);
    assert.match(read('supabase/functions/_shared/smtp.ts'), /connectTls/);
    assert.ok(!/rejectUnauthorized|caCerts|unsafelyIgnore/i.test(joined), 'certificate checking must never be switched off');
});

test('secrets are never written into the repository or logged', () => {
    const tracked = walk('.').filter((f) => !/^(vendor|node_modules|\.git)[\\/]/.test(f) && /\.(js|ts|html|toml|sql|md|yml|json)$/.test(f) && !f.endsWith('config.js'));
    for (const file of tracked) {
        const text = read(file);
        assert.ok(!/sb_secret_[A-Za-z0-9_-]{10,}/.test(text), `${file}: Supabase secret key`);
        assert.ok(!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text), `${file}: private key`);
        assert.ok(!/"role"\s*:\s*"service_role"/.test(text), `${file}: service role token`);
        assert.ok(!/\b[a-z]{4} [a-z]{4} [a-z]{4} [a-z]{4}\b.*SMTP|SMTP_PASS\s*=\s*['"]?[a-z]{16}/.test(text), `${file}: app password`);
    }
    for (const file of walk('supabase/functions').filter((f) => f.endsWith('.ts'))) {
        const code = read(file);
        assert.ok(!/console\.(log|error|warn)\([^)]*(\.pass\b|\bpass\b|\bserviceKey\b|\btokenSecret\b|\bcronSecret\b|\bsecret\b)/.test(code), `${file} logs a secret`);
    }
    const gitignore = read('.gitignore');
    assert.match(gitignore, /^\.env/m);
});

// Database Section
test('schema: the new tables are locked down and the email columns can only be written by the server', () => {
    const sql = read('supabase-schema.sql');
    for (const table of ['app_admins', 'usage_counters', 'receipt_scan_usage']) {
        assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`), `${table}: RLS`);
        assert.match(sql, new RegExp(`revoke all on public\\.${table} from anon, authenticated`), `${table}: revoke`);
    }
    for (const fn of ['claim_first_admin\\(uuid, text\\)', 'consume_quota\\(text, integer\\)', 'consume_receipt_quota\\(uuid, text, integer\\)']) {
        assert.match(sql, new RegExp(`revoke all on function public\\.${fn} from public, anon, authenticated`));
        assert.match(sql, new RegExp(`grant execute on function public\\.${fn} to service_role`));
    }
    const definers = (sql.match(/security definer/g) || []).length;
    assert.ok(definers >= 6, 'the SECURITY DEFINER functions are still there');
    assert.equal((sql.match(/security definer\s*\n\s*set search_path = public/g) || []).length, definers, 'every SECURITY DEFINER function pins its search_path');
    assert.match(sql, /revoke all on public\.monthly_report_preferences from anon, authenticated/);
    assert.match(sql, /grant insert \(user_id, recipient_email, enabled\) on public\.monthly_report_preferences to authenticated/);
    const updateGrant = /grant update \(([^)]*)\) on public\.monthly_report_preferences/.exec(sql)[1];
    for (const serverOnly of ['verified_email', 'verified_at', 'sent_for_month', 'failed_for_month']) {
        assert.ok(!updateGrant.includes(serverOnly), `users must not be able to update ${serverOnly}`);
    }
    assert.match(sql, /verified_email text/);
    assert.match(sql, /u\.email_confirmed_at is not null/, 'only confirmed accounts can become administrator');
    assert.match(sql, /if exists \(select 1 from public\.app_admins\)/, 'only the FIRST administrator can be claimed');
});

test('schema: user-chosen icons and colours (which reach the page) are format-checked in the database too', () => {
    const sql = read('supabase-schema.sql');
    assert.match(sql, /icon ~ '\^fa-\[a-z0-9-\]\{1,40\}\$'/);
    assert.match(sql, /color ~ '\^#\[0-9a-fA-F\]\{3,8\}\$'/);
});

test('app: the browser never tries to write server-controlled report columns', () => {
    const app = read('app.js');
    const upsert = /const preference = \{([^}]*)\}/.exec(app)[1];
    assert.ok(!/verified|sent_for_month|failed_for_month/.test(upsert), upsert);
});

// Vendored PDF reader Section
test('pdf.js (vendored) reads a plain text PDF with eval disabled, and rejects a non-PDF', async () => {
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
        null,
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ];
    const stream = 'BT /F1 18 Tf 20 100 Td (Total RM 12.50) Tj ET';
    objects[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    let pdf = '%PDF-1.4\n';
    const offsets = [];
    objects.forEach((body, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${body}\nendobj\n`; });
    const xref = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')}`;
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;

    const pdfjs = await import(pathToUrl(path.join(root, 'vendor/pdfjs/pdf.min.mjs')));
    pdfjs.GlobalWorkerOptions.workerSrc = pathToUrl(path.join(root, 'vendor/pdfjs/pdf.worker.min.mjs'));
    const task = pdfjs.getDocument({ data: new Uint8Array(Buffer.from(pdf, 'latin1')), isEvalSupported: false, enableXfa: false, useWorkerFetch: false, disableFontFace: true, verbosity: 0 });
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const text = (await page.getTextContent()).items.map((i) => i.str).join(' ');
    assert.match(text, /Total RM 12\.50/);
    await doc.destroy();
    await assert.rejects(pdfjs.getDocument({ data: new Uint8Array(Buffer.from('<html>not a pdf</html>')), isEvalSupported: false, verbosity: 0 }).promise);
});

function pathToUrl(p) { return require('node:url').pathToFileURL(p).href; }

// Plan tab Section: deposits, loans, reminders
test('Plan: every script the page loads is shipped, cached for offline use, and loaded from this site only', () => {
    const html = read('index.html');
    const scripts = [...html.matchAll(/<script src="([^"?]+)/g)].map((m) => m[1]);
    assert.ok(scripts.includes('plan.js') && scripts.includes('finance-calc.js'));
    assert.ok(scripts.indexOf('plan.js') < scripts.indexOf('app.js'), 'plan.js only defines things and must load before app.js starts it');
    const deploy = read('.github/workflows/deploy.yml');
    const sw = read('sw.js');
    for (const file of scripts.filter((s) => !s.startsWith('vendor/') && s !== 'config.js')) {
        assert.ok(new RegExp(`\\b${file.replace('.', '\\.')}\\b`).test(deploy), `${file} is not copied by the deploy workflow`);
        assert.ok(sw.includes(`'${file}'`), `${file} is not in the service worker's offline list`);
    }
});

test('Plan: no dangerous browser APIs, and saved names only reach the page through escapeHtml or textContent', () => {
    const plan = read('plan.js');
    assert.ok(!/\beval\(|new Function\(|document\.write\(|outerHTML\s*=|insertAdjacentHTML/.test(plan));
    // Saved text may be raw only where the browser treats it as plain text; in HTML it must be escaped.
    const withoutEscaped = (line) => {
        let out = line;
        for (let at = out.indexOf('escapeHtml('); at >= 0; at = out.indexOf('escapeHtml(')) {
            let depth = 0, end = at + 'escapeHtml'.length;
            do { if (out[end] === '(') depth++; if (out[end] === ')') depth--; end++; } while (depth > 0 && end < out.length);
            out = out.slice(0, at) + out.slice(end);
        }
        return out;
    };
    const raw = /\$\{\s*(row|r|item|i|entry)\.(name|bank|lender|error|label|source|merchant)\s*\}/;
    plan.split(/\r?\n/).forEach((line, index) => {
        if (!/<[a-z][^>]*>|innerHTML/.test(line)) return;
        assert.ok(!raw.test(withoutEscaped(line)), `plan.js line ${index + 1} puts saved text into HTML without escapeHtml`);
    });
    assert.ok(!/_state\s*:/.test(plan), 'no debugging hook that hands the data to other scripts');
    const calc = read('finance-calc.js');
    assert.ok(!/\bfetch\s*\(|XMLHttpRequest|localStorage|document\.|window\./.test(calc), 'the maths has no network, storage or page access');
});

test('Plan: logging out or deleting the account removes the saved deposits and loans from the device', () => {
    const app = read('app.js');
    assert.match(app, /Plan\.forgetDevice\(userId, \{ everything: true \}\)/, 'account deletion clears everything');
    assert.match(app, /Plan\.forgetDevice\(currentUser && currentUser\.id\);\s*\n\s*await supabaseClient\.auth\.signOut\(\)/, 'logout clears the cache before signing out');
    const plan = read('plan.js');
    assert.match(plan, /removeItem\(`et_plan_\$\{userId\}`\)/);
});

test('Plan schema: per-account data only, a server-only reminder log, a row limit, and no SECURITY DEFINER shortcut', () => {
    const sql = read('supabase-schema.sql');
    for (const table of ['fixed_deposits', 'loans']) {
        assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
        assert.match(sql, new RegExp(`create trigger ${table}_row_limit before insert on public\\.${table}`));
        assert.match(sql, new RegExp(`user_id uuid not null references auth\\.users \\(id\\) on delete cascade`), 'deleting the account deletes the rows');
    }
    const fn = sql.slice(sql.indexOf('function public.enforce_plan_row_limit'));
    assert.ok(!/security definer/.test(fn.slice(0, fn.indexOf('$$;'))), 'the limit runs with the caller\'s own rights');
    assert.match(sql, /revoke all on public\.reminder_log from anon, authenticated/);
    assert.match(sql, /alter table public\.telegram_links add column if not exists reminders_blocked_at/);
    assert.match(sql, /revoke all on public\.telegram_links from anon, authenticated/, 'the blocked flag can only be set by the server');
});

test('Plan reminders: the function is scheduler-only and never trusts the browser', () => {
    const code = read('supabase/functions/plan-reminders/handler.ts');
    assert.ok(!/requireUser|preflight|Access-Control/.test(code), 'not a browser-facing function');
    assert.match(code, /safeEqual\(request\.headers\.get\("x-cron-secret"\)/);
    assert.match(code, /escapeHtml\(r\.name\)/, 'names are escaped before they go into a Telegram message');
    assert.match(code, /d\.user_id === userId/, 'each person is only ever sent their own deposits');
    assert.match(code, /l\.user_id === userId/, 'each person is only ever sent their own loans');
    assert.ok(!/console\.(log|error|warn)\([^)]*(name|amount|chatId)/.test(code), 'no personal data in the logs');
});

// Public pages Section: landing, privacy, terms
test('public pages: no code of their own, no forms, no outside requests, and they are shipped with the site', () => {
    const deploy = read('.github/workflows/deploy.yml');
    for (const page of ['welcome.html', 'privacy.html', 'terms.html']) {
        const html = read(page);
        const csp = cspOf(html);
        assert.equal(directive(csp, 'connect-src').length, 0, `${page} must not be allowed to call any server`);
        assert.deepEqual(directive(csp, 'form-action'), ["'none'"]);
        assert.deepEqual([...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]), ['frame-guard.js'], `${page} runs only the frame guard`);
        assert.ok(!/\sstyle=/.test(html), `${page}: inline styles would be blocked by its policy`);
        assert.ok(!/<form|<input|<iframe/i.test(html));
        assert.ok(deploy.includes(page), `${page} is not copied by the deploy workflow`);
        for (const img of [...html.matchAll(/<img src="([^"]+)"/g)].map((m) => m[1])) {
            assert.ok(fs.existsSync(path.join(root, img)), `${page}: missing image ${img}`);
        }
    }
    assert.match(deploy, /pages\.css/);
    assert.match(deploy, /cp -r landing dist\/landing/);
    assert.match(read('pages.css'), /html:not\(\[data-top\]\) body \{ display: none !important; \}/, 'the frame guard needs this rule');
});

test('privacy policy: names every outside service the code actually uses, and the app links to it', () => {
    const policy = read('privacy.html');
    for (const provider of ['Supabase', 'GitHub Pages', 'OCR.space', 'OpenStreetMap', 'Telegram', 'Gmail', 'Gemini', 'Google', 'Cloudflare']) {
        assert.ok(policy.includes(provider), `the privacy policy does not mention ${provider}`);
    }
    // if a function starts calling a new outside service, this list (and the policy) must be updated
    const hosts = new Set();
    for (const file of walk('supabase/functions').filter((f) => f.endsWith('.ts'))) {
        for (const m of read(file).matchAll(/https:\/\/([a-z0-9.-]+\.[a-z]{2,})/g)) hosts.add(m[1]);
    }
    const known = ['api.ocr.space', 'api.telegram.org', 't.me', 'nominatim.openstreetmap.org', 'overpass-api.de', 'generativelanguage.googleapis.com', 'smtp.gmail.com', 'www.openstreetmap.org',
        'myaccount.google.com', 'aistudio.google.com', // only links in setup notes
        'challenges.cloudflare.com'];
    const unknown = [...hosts].filter((h) => !known.includes(h) && !/supabase\.co$|github\.io$|example\.|^x$|^me\./.test(h));
    assert.deepEqual(unknown, [], 'an outside service is used by a function but not covered by the privacy policy');
    const app = read('index.html');
    assert.match(app, /href="privacy\.html"/);
    assert.match(app, /href="terms\.html"/);
    assert.match(read('terms.html'), /not financial advice|financial, investment, tax, legal or accounting advice/);
});

// ------------------------------------------------------------------ sign-in, admin and the security check
test('security check (Cloudflare): off by default, and when switched on it widens the policy for the sign-in page only', () => {
    const { pinCsp, cspOf: cspFrom } = require('../tools/pin-csp.js');
    const html = read('index.html');
    const plain = cspFrom(pinCsp(html, 'https://abcdefghij.supabase.co'));
    assert.ok(!plain.includes('cloudflare'), 'the committed page and the default build allow no third-party script');
    const withCheck = cspFrom(pinCsp(html, 'https://abcdefghij.supabase.co', { turnstile: true }));
    assert.deepEqual(directive(withCheck, 'script-src'), ["'self'", 'https://challenges.cloudflare.com']);
    assert.deepEqual(directive(withCheck, 'frame-src'), ['https://challenges.cloudflare.com']);
    assert.ok(directive(withCheck, 'connect-src').includes('https://challenges.cloudflare.com'));
    assert.ok(!withCheck.includes('*'));
    assert.deepEqual(directive(withCheck, 'default-src'), ["'none'"]);
    const tool = read('tools/pin-csp.js');
    assert.match(tool, /index\\\.html/);
    assert.match(tool, /!\/miniapp\/\.test\(file\)/, 'the Telegram Mini App never gets the third-party allowance');
    assert.match(read('build-config.js'), /TURNSTILE_SITE_KEY/);
    assert.ok(!/TURNSTILE_SECRET/.test(read('build-config.js') + read('auth.js') + read('app.js') + read('admin.js')), 'the secret key never reaches the browser');
});

test('sign-in code: no password or code is ever stored in the browser, logged, or sent anywhere but the sign-in function', () => {
    const auth = read('auth.js');
    assert.ok(!/localStorage\.setItem\([^)]*(pass|code|token)/i.test(auth), 'nothing secret goes into browser storage');
    assert.ok(!/console\.(log|error|warn)/.test(auth), 'auth.js never logs');
    assert.ok(!/innerHTML\s*=\s*[^;]*(value|\.message|reply)/.test(auth.replace(/el\('(mfaCodes|mfaQrBox)'\)\.innerHTML[^;]*;/g, '')), 'text from the page or the server is not put into HTML');
    assert.match(auth, /textContent/);
    // the QR picture is only ever shown from an SVG data address, as an image
    assert.match(auth, /\^data:image\\\/svg\\\+xml/);
    assert.ok(!/eval\(|new Function|document\.write/.test(auth + read('admin.js')));
    const app = read('app.js');
    assert.ok(!/signInWithPassword|signUp\(|resetPasswordForEmail|auth\.resend/.test(app), 'every password, sign-up and reset call goes through the sign-in function (limits and lockouts)');
});

test('admin screen: server-checked, and the page code can not read anyone\'s records', () => {
    const admin = read('admin.js');
    assert.ok(!/from\(['"`](expenses|incomes|budgets|recurring|fixed_deposits|loans)/.test(admin), 'the admin page never queries money tables');
    assert.match(admin, /functions\.invoke\('admin'/);
    const server = read('supabase/functions/admin/handler.ts');
    assert.match(server, /isAdmin\(auth\.userId\)/);
    assert.ok(server.indexOf('isAdmin(auth.userId)') < server.indexOf('switch (body.action)'), 'the role is checked before any action runs');
    assert.ok(!/select=amount|expenses\?select|incomes\?select|merchant|from\("expenses"/.test(server), 'the admin function never selects expense or income rows');
    assert.match(server, /audit\(adminId/);
    // every admin action writes to the log first, and the log can not be edited or deleted
    const sql = read('supabase-schema.sql');
    assert.match(sql, /create trigger admin_audit_log_locked before update or delete on public\.admin_audit_log/);
    for (const table of ['auth_code_requests', 'auth_lockouts', 'mfa_recovery_codes', 'admin_audit_log', 'feedback']) {
        assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`), `${table}: RLS`);
        assert.match(sql, new RegExp(`revoke all on public\\.${table} from anon, authenticated`), `${table}: server only`);
    }
    assert.match(sql, /revoke all on function public\.record_signin_failure\(text, text, integer, integer, integer\) from public, anon, authenticated/);
    assert.match(sql, /revoke all on function public\.admin_user_stats\(uuid\[\]\) from public, anon, authenticated/);
});

test('authenticator: when it is on, the database itself refuses a password-only session, and a fault never locks everyone out', () => {
    const sql = read('supabase-schema.sql');
    assert.match(sql, /as restrictive for all to authenticated using \(\(select public\.mfa_ok\(\)\)\)/);
    for (const table of ['expenses', 'incomes', 'budgets', 'fixed_deposits', 'loans', 'monthly_report_preferences']) assert.ok(sql.includes(`'${table}'`), table);
    const fn = sql.slice(sql.indexOf('create or replace function public.mfa_ok'), sql.indexOf('revoke all on function public.mfa_ok'));
    assert.match(fn, /exception when others then\s+return true;/, 'if the check itself fails it lets the request through');
    assert.match(fn, /aal.*aal2/s);
    const guard = read('supabase/functions/_shared/guard.ts');
    assert.match(guard, /hasMfa && aal !== "aal2"/);
});
