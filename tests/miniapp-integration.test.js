'use strict';
// How the Mini App connects to the rest of the project: the bot's /app command and Dashboard buttons, the page's
// security policy, the files that are published, and the rules the data service must follow.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./helpers/tg-harness.js');
const { A, CHAT_A, setup, message, deliver, link, seedChoices } = H;

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test.afterEach(() => { delete globalThis.Deno; });

async function linked(extraEnv = {}) {
    const ctx = setup(extraEnv);
    seedChoices(ctx.db, A);
    await link(ctx.db, ctx.tg, 'tok-a', CHAT_A);
    ctx.tg.sent.length = 0;
    return ctx;
}

// ------------------------------------------------------------------ the bot
test('bot: /app sends one Dashboard button that opens the Mini App from the website address', async () => {
    const { tg } = await linked({ SITE_URL: 'https://me.github.io/VinExpenses' });
    await deliver(tg, message(CHAT_A, '/app'));
    const reply = tg.sent.at(-1);
    assert.match(reply.html, /dashboard/i);
    assert.deepEqual(reply.buttons, [[{ text: '📱 Dashboard', web_app: { url: 'https://me.github.io/VinExpenses/miniapp/' } }]]);
});

test('bot: /app without a website address, or with an unsafe one, explains instead of sending a broken button', async () => {
    for (const site of [undefined, 'http://insecure.example', 'https://me.github.io/x?a=1']) {
        const { tg } = await linked({ SITE_URL: site });
        await deliver(tg, message(CHAT_A, '/app'));
        const reply = tg.sent.at(-1);
        assert.match(reply.html, /isn't set up|SITE_URL/);
        assert.equal(reply.buttons, undefined);
        delete globalThis.Deno;
    }
});

test('bot: /app is answered in the chosen language and refused for chats that are not connected', async () => {
    const ctx = await linked({ SITE_URL: 'https://me.github.io/VinExpenses' });
    ctx.db.telegram_links.find((l) => l.chat_id === CHAT_A).lang = 'zh';
    await deliver(ctx.tg, message(CHAT_A, '/app'));
    assert.match(ctx.tg.sent.at(-1).html, /仪表板/);
    assert.equal(ctx.tg.sent.at(-1).buttons[0][0].text, '📱 仪表板');
    await deliver(ctx.tg, message(9999, '/app'));
    assert.doesNotMatch(JSON.stringify(ctx.tg.sent.at(-1).buttons ?? ''), /web_app/, 'strangers get no dashboard button');
});

test('bot: the command list, help text and every language mention the dashboard', () => {
    const commands = read('tools/telegram-commands.js');
    assert.equal((commands.match(/\['app', /g) || []).length, 3, 'one /app entry per language list');
    const i18n = read('supabase/functions/_shared/tg-i18n.ts');
    assert.equal((i18n.match(/📱 \/app/g) || []).length, 3, 'help lists /app in all three languages');
    for (const key of ['btn_dashboard', 'app_intro', 'app_unavailable']) assert.equal((i18n.match(new RegExp(`^  ${key}:`, 'gm')) || []).length, 3, `${key} in every language`);
});

// ------------------------------------------------------------------ the page
test('page: strict security policy, only its own scripts, no inline code or styles, no third-party addresses', () => {
    const html = read('miniapp/index.html');
    const policy = html.match(/http-equiv="Content-Security-Policy"[^>]+content="([^"]*)"/)[1];
    assert.match(policy, /default-src 'none'/);
    assert.match(policy, /script-src 'self'(;|$)/);
    assert.match(policy, /style-src 'self'(;|$)/, 'no inline styles at all');
    assert.match(policy, /connect-src 'self' https:\/\/\*\.supabase\.co(;|$)/, 'pinned to one project at deploy');
    assert.match(policy, /form-action 'none'/);
    assert.match(policy, /object-src 'none'/);
    assert.doesNotMatch(policy, /unsafe-inline|unsafe-eval|http:/);
    const scripts = [...html.matchAll(/<script([^>]*)>/g)].map((m) => m[1]);
    assert.ok(scripts.length >= 8);
    for (const attrs of scripts) {
        assert.match(attrs, /src="(\.\.\/)?[a-z0-9\-/.]+\.js"/, `a local file: ${attrs}`);
        assert.doesNotMatch(attrs, /https?:|\/\//);
    }
    assert.doesNotMatch(html, /<script>[^<]|<style|\sstyle=|\son[a-z]+=/i);
    assert.doesNotMatch(html, /telegram\.org\/js|cdn\./i, 'Telegram\'s own script is not loaded: the page speaks the protocol itself');
    assert.match(html, /name="referrer" content="no-referrer"/);
    // every script file named in the page exists
    for (const attrs of scripts) {
        const src = attrs.match(/src="([^"]+)"/)[1];
        assert.ok(fs.existsSync(path.join(root, 'miniapp', src)), `${src} exists`);
    }
});

test('page: code never writes HTML from raw data, never uses eval, and keeps the launch data out of storage beyond the tab', () => {
    for (const file of ['app.js', 'views.js', 'bridge.js', 'api.js', 'format.js', 'demo.js']) {
        const source = read(`miniapp/${file}`);
        assert.doesNotMatch(source, /\beval\(|new Function\(|document\.write|insertAdjacentHTML|localStorage|\.outerHTML\s*=/, file);
        assert.doesNotMatch(source, /fetch\(\s*['"]https?:/, `${file} makes no request to a fixed outside address`);
    }
    const app = read('miniapp/app.js');
    for (const match of app.matchAll(/\.innerHTML\s*=\s*([^;]+);/g)) {
        assert.match(match[1], /^(html|views\.[a-zA-Z]+\(\)|''|views \? views\.sheet\(\) : ''|state\.status === 'ready' \? views\.(monthBar|tabBar)\(\) : '')$/, `innerHTML only receives screen builders: ${match[1]}`);
    }
    assert.match(read('miniapp/bridge.js'), /sessionStorage/);
});

test('page: only this one folder is published for the Mini App, with its policy pinned like the other pages', () => {
    const yml = read('.github/workflows/deploy.yml');
    assert.match(yml, /cp -r miniapp dist\/miniapp/);
    assert.match(yml, /pin-csp\.js dist\/index\.html dist\/email-action\.html dist\/miniapp\/index\.html/);
    for (const file of fs.readdirSync(path.join(root, 'miniapp'))) assert.match(file, /^[a-z0-9.\-]+\.(js|css|html)$/, `only page files live in miniapp/: ${file}`);
});

// ------------------------------------------------------------------ the data service
test('service: signature is checked before any database access, every query is scoped to the verified user', () => {
    const handler = read('supabase/functions/miniapp-api/handler.ts');
    assert.ok(handler.indexOf('verifyInitData(') < handler.indexOf('telegram_links?'), 'who the person is comes from the verified signature first');
    assert.doesNotMatch(handler, /body\.(user_?id|chat_?id)/i, 'the request body can never name a user');
    const queries = [...handler.matchAll(/`((?:expenses|budgets|income)[^`]*)`/g)].map((m) => m[1]);
    assert.ok(queries.length >= 3);
    for (const query of queries) assert.match(query, /user_id=eq\.\$\{q\(session\.userId\)\}/, `scoped: ${query.slice(0, 60)}`);
    const writes = [...handler.matchAll(/rest\(\s*`expenses\?id=eq[^`]*`/g)].map((m) => m[0]);
    for (const write of writes) assert.match(write, /user_id=eq/, 'updates and deletes also require ownership');
    assert.match(read('supabase/config.toml'), /\[functions\.miniapp-api\]\s*\n(?:#.*\n)*verify_jwt = false/);
    assert.doesNotMatch(read('supabase/functions/miniapp-api/index.ts'), /SERVICE_ROLE|console\.log/);
});

test('service: the data service address is the only thing the page can reach, and the CORS list is not a wildcard', () => {
    const guard = read('supabase/functions/_shared/guard.ts');
    assert.match(guard, /x-telegram-init-data/);
    assert.doesNotMatch(guard, /Access-Control-Allow-Origin["']?:\s*["']\*/);
    assert.match(read('miniapp/api.js'), /\/functions\/v1\/miniapp-api/);
});
