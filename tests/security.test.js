'use strict';
// Security regression tests. These read the project's own files and fail if a protection is removed or weakened,
// so a future edit (or a careless "quick fix") can not silently re-open a hole.
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

// ------------------------------------------------------------------ pages and the Content-Security-Policy
for (const page of ['index.html', 'email-action.html']) {
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

// ------------------------------------------------------------------ vendored libraries and supply chain
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

// ------------------------------------------------------------------ edge functions
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
    assert.deepEqual(Object.keys(settings).filter((n) => settings[n] === 'false').sort(), ['email-action', 'miniapp-api', 'monthly-report-email', 'telegram-bot', 'telegram-digest']);
});

test('no function allows every website (CORS *) and none builds its own CORS headers', () => {
    for (const file of walk('supabase/functions').filter((f) => f.endsWith('.ts'))) {
        const code = read(file);
        assert.ok(!/Access-Control-Allow-Origin["']?\s*[:,]\s*["']\*/i.test(code), `${file} allows *`);
        if (!file.endsWith('guard.ts')) assert.ok(!/Access-Control-Allow-Origin/i.test(code), `${file} builds its own CORS headers`);
    }
});

test('browser-facing functions all sit behind the same guard: allowed website + signed-in user', () => {
    for (const name of ['receipt-ocr', 'receipt-ai', 'nearby-place', 'delete-account', 'email-verify', 'admin-email-test', 'telegram-link']) {
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
    assert.ok(!/resend/i.test(joined), 'Resend references should be gone');
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

// ------------------------------------------------------------------ database
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
    assert.equal((sql.match(/security definer\s*\n\s*set search_path = public/g) || []).length, 3, 'every SECURITY DEFINER function pins its search_path');
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

// ------------------------------------------------------------------ vendored PDF reader
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
