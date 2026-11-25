'use strict';
// Security tests: they fail if a protection is removed or weakened.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const resolve = (...parts) => path.join(root, ...parts);
const read = (rel) => fs.readFileSync(resolve(rel), 'utf8');
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
// Vendored libraries and supply chain Section
test('GitHub Pages workflow: actions pinned to commits, publishes only the checked redirect to the new site', () => {
    const yml = read('.github/workflows/deploy.yml');
    const uses = [...yml.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
    assert.ok(uses.length >= 4);
    for (const u of uses) assert.match(u, /@[0-9a-f]{40}$/, `${u} must be pinned to a full commit hash`);
    assert.match(yml, /node --test tests\/redirect\.test\.js/);
    assert.match(yml, /node tools\/build-redirect\.js dist/);
    assert.ok(yml.indexOf('node --test') < yml.indexOf('deploy-pages'), 'the redirect is checked before it is published');
    assert.ok(!/legacy/.test(yml), 'the old site is no longer published');
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

// Vendored PDF reader Section
function pathToUrl(p) { return require('node:url').pathToFileURL(p).href; }

// Plan tab Section: deposits, loans, reminders
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
test('privacy policy: names every outside service the code actually uses, and the app has the policy and the terms', () => {
    const policy = read('src/features/public/PrivacyPage.tsx');
    for (const provider of ['Supabase', 'Cloudflare', 'GitHub Pages', 'Google', 'OCR.space', 'Telegram', 'OpenStreetMap', 'Photon', 'Gmail', 'Frankfurter', 'Google Analytics']) {
        assert.ok(policy.includes(provider), `the privacy policy does not mention ${provider}`);
    }
    // if the server functions or the page start calling a new outside service, this list (and the policy) must be updated
    const hosts = new Set();
    for (const file of [...walk('supabase/functions'), ...walk('src')].filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f))) {
        for (const m of fs.readFileSync(file, 'utf8').matchAll(/https:\/\/([a-z0-9.-]+\.[a-z]{2,})/g)) hosts.add(m[1]);
    }
    const known = ['api.ocr.space', 'api.telegram.org', 't.me', 'telegram.org', 'web.telegram.org', 'webk.telegram.org', 'webz.telegram.org', 'nominatim.openstreetmap.org', 'overpass-api.de', 'photon.komoot.io', 'api.frankfurter.dev', 'www.googletagmanager.com', 'www.google-analytics.com',
        'generativelanguage.googleapis.com', 'smtp.gmail.com', 'www.openstreetmap.org', 'accounts.google.com', 'challenges.cloudflare.com',
        'myaccount.google.com', 'aistudio.google.com', // only links in setup notes
        'vincent16.vercel.app', // only a link to the author's portfolio, see AuthorCredit.tsx
    ];
    const unknown = [...hosts].filter((h) => !known.includes(h) && !/supabase\.co$|github\.io$|workers\.dev$|pages\.dev$|example\.|^x$|^me\.|w3\.org$/.test(h));
    assert.deepEqual(unknown, [], 'an outside service is used but not covered by the privacy policy');
    const paths = read('src/app/paths.ts');
    assert.match(paths, /'\/privacy'/);
    assert.match(paths, /'\/terms'/);
    assert.match(read('src/features/public/TermsPage.tsx'), /financial, investment, tax, legal or accounting advice/);
});

// ------------------------------------------------------------------ sign-in, admin and the security check
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

// 404 page Section
