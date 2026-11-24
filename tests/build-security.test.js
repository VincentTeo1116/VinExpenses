// Looks at the files that would really be published (the test build), not at the source: no secret, no inline code, the right headers.
// Run `npm run build:e2e` first; without a build these checks are skipped (and the browser tests build one anyway).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dist = path.join(__dirname, '..', 'dist-e2e');
const built = fs.existsSync(path.join(dist, 'index.html'));
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const opts = { skip: built ? false : 'no build found (run npm run build:e2e)' };

test('no secret-shaped value is in any published file', opts, () => {
    const SECRET = /service_role["']?\s*[:=]\s*["']ey|SUPABASE_SERVICE_ROLE_KEY\s*[:=]|sk_live_|-----BEGIN (RSA |EC )?PRIVATE KEY|\b\d{8,10}:[A-Za-z0-9_-]{35}\b|AIza[0-9A-Za-z_-]{35}/;
    for (const file of walk(dist).filter((f) => /\.(js|mjs|html|css|json|webmanifest|txt)$/.test(f))) {
        assert.ok(!SECRET.test(fs.readFileSync(file, 'utf8')), `${path.relative(dist, file)} looks like it contains a secret`);
    }
});

test('no source maps are published (they would hand out the readable source)', opts, () => {
    assert.deepEqual(walk(dist).filter((f) => f.endsWith('.map')), []);
});

test('every page has no inline script or style and carries a Content-Security-Policy', opts, () => {
    for (const page of ['index.html', 'email-action.html', 'miniapp/index.html']) {
        const html = fs.readFileSync(path.join(dist, page), 'utf8');
        assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>[^<]/i.test(html), `${page} has an inline script`);
        assert.ok(!/\sstyle=|<style/i.test(html), `${page} has inline style`);
        assert.ok(/http-equiv="Content-Security-Policy"/.test(html), `${page} has no policy in the page`);
        assert.ok(!/unsafe-inline|unsafe-eval/.test(html), `${page} allows unsafe code`);
    }
});

test('the headers file forbids framing everywhere except the Mini App, which only Telegram may frame', opts, () => {
    const headers = fs.readFileSync(path.join(dist, '_headers'), 'utf8');
    const [everywhere, rest] = headers.split(/^\/miniapp\/\*/m);
    for (const needed of ["frame-ancestors 'none'", 'X-Frame-Options: DENY', 'Strict-Transport-Security', 'X-Content-Type-Options: nosniff', 'Referrer-Policy', 'Permissions-Policy', "default-src 'none'"]) {
        assert.ok(everywhere.includes(needed), `the general rule is missing ${needed}`);
    }
    assert.ok(!/unsafe-inline|unsafe-eval/.test(headers), 'the policy allows unsafe code');
    assert.ok(/frame-ancestors https:\/\/web\.telegram\.org/.test(rest), 'the Mini App rule lists Telegram');
    assert.ok(!/frame-ancestors[^;\n]*\*/.test(headers), 'no wildcard framing');
});

test('the redirect list is only the app addresses (everything else is a real 404)', opts, () => {
    const lines = fs.readFileSync(path.join(dist, '_redirects'), 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#'));
    for (const line of lines) assert.match(line, /^\/(app|auth|welcome|privacy|terms)(\.html|\/[a-z]+)?\s+\/index\.html\s+200$/, line);
    assert.ok(!lines.some((l) => /\*/.test(l)), 'no catch-all rewrite');
});
