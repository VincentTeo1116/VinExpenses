// The "we have moved" site that GitHub Pages publishes: where each old address goes, that it can never leave the new site, and the build.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { destination } = require('../redirect/redirect.js');
const { build, validTarget, validBase } = require('../tools/build-redirect.js');

const TARGET = 'https://vinexpenses.tkqvincent2.workers.dev';
const BASE = '/VinExpenses/';
const go = (pathname, search = '', hash = '', base = BASE) => destination(TARGET, base, pathname, search, hash);

test('the old app address opens the new app; the old front page opens the new front page', () => {
    assert.equal(go('/VinExpenses/'), `${TARGET}/app`);
    assert.equal(go('/VinExpenses'), `${TARGET}/app`);
    assert.equal(go('/VinExpenses/index.html'), `${TARGET}/app`);
    assert.equal(go('/VinExpenses/welcome.html'), `${TARGET}/`);
});

test('other pages keep their name, and the query and the hash go with them', () => {
    assert.equal(go('/VinExpenses/privacy.html'), `${TARGET}/privacy.html`);
    assert.equal(go('/VinExpenses/terms.html'), `${TARGET}/terms.html`);
    assert.equal(go('/VinExpenses/email-action.html', '?token=abc&type=signup'), `${TARGET}/email-action.html?token=abc&type=signup`);
    assert.equal(go('/VinExpenses/miniapp/', '?demo=1', '#x'), `${TARGET}/miniapp/?demo=1#x`);
    assert.equal(go('/VinExpenses/', '', '#access_token=t'), `${TARGET}/app#access_token=t`);
});

test('on a custom domain (base "/") the same rules apply', () => {
    assert.equal(go('/', '', '', '/'), `${TARGET}/app`);
    assert.equal(go('/privacy.html', '', '', '/'), `${TARGET}/privacy.html`);
});

test('no address can send a visitor to another website', () => {
    const tricks = ['//evil.example', '/\\evil.example', '/VinExpenses//evil.example', '/VinExpenses/\\evil.example', '/VinExpenses/..//evil.example', '///evil.example/x', '/VinExpenses/@evil.example', 'evil.example', '/VinExpenses/https://evil.example'];
    for (const trick of tricks) {
        const result = go(trick, '?a=1', '#b');
        assert.equal(new URL(result).origin, TARGET, `${trick} -> ${result}`);
    }
});

test('the build writes the redirect page as the front page and as the 404 page, with the address and folder filled in', () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'redirect-'));
    build({ target: `${TARGET}/`, base: BASE, out });
    for (const file of ['index.html', '404.html', 'redirect.js', 'sw.js']) assert.ok(fs.existsSync(path.join(out, file)), `${file} is missing`);
    const page = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
    assert.equal(page, fs.readFileSync(path.join(out, '404.html'), 'utf8'));
    assert.ok(!/__TARGET__|__BASE__/.test(page), 'a placeholder was left in the page');
    assert.match(page, new RegExp(`<script src="${BASE}redirect\\.js" data-target="${TARGET.replace(/\./g, '\\.')}" data-base="${BASE}"></script>`));
    assert.match(page, new RegExp(`<meta http-equiv="refresh" content="3;url=${TARGET.replace(/\./g, '\\.')}/" />`));
    assert.ok(!/<script>[^<]/.test(page), 'no inline script');
    fs.rmSync(out, { recursive: true, force: true });
});

test('only a plain https address is accepted as the place to send people', () => {
    for (const good of [TARGET, `${TARGET}/`, 'https://example.com', 'https://my-app.pages.dev', 'https://localhost.test:8443']) assert.ok(validTarget(good), good);
    for (const bad of ['', undefined, 'http://example.com', 'javascript:alert(1)', 'https://example.com/path', 'https://user@example.com', 'https://example.com?x=1', '//example.com', 'https://exa mple.com', 'https://example.com"onload="x']) assert.ok(!validTarget(bad), String(bad));
    assert.throws(() => build({ target: 'http://example.com', base: BASE, out: path.join(os.tmpdir(), 'never') }), /https/);
    assert.ok(validBase('/') && validBase('/VinExpenses/') && !validBase('VinExpenses') && !validBase('/a b/') && !validBase('//x/') && !validBase('/"/'));
});

test('the replacement service worker clears every cache, removes itself and reloads the open pages', () => {
    const sw = fs.readFileSync(path.join(__dirname, '..', 'redirect', 'sw.js'), 'utf8');
    for (const needed of ['skipWaiting', 'caches.keys()', 'caches.delete', 'registration.unregister()', 'client.navigate']) assert.ok(sw.includes(needed), `sw.js does not ${needed}`);
    assert.ok(!/addEventListener\('fetch'/.test(sw), 'it must not answer requests from a cache');
});

test('the GitHub Pages workflow sends people to a valid address by default, and publishes nothing else', () => {
    const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'deploy.yml'), 'utf8');
    const fallback = /REDIRECT_TO: \$\{\{ vars\.REDIRECT_TO \|\| '([^']+)' \}\}/.exec(workflow)?.[1];
    assert.ok(fallback && validTarget(fallback), 'the default address is missing or not a plain https address');
    assert.ok(!/legacy|REDIRECT_TO == 'off'/.test(workflow), 'the old site is never published again');
    assert.match(workflow, /node tools\/build-redirect\.js dist/);
});
