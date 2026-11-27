// The old Cloudflare address sends people to manaduit.com, keeping the page, the query and the hash, and never anywhere else.
const test = require('node:test');
const assert = require('node:assert/strict');
const { destination } = require('../public/host-redirect.js');

const OLD = 'vinexpenses.tkqvincent2.workers.dev';

test('the old address goes to the same page on manaduit.com', () => {
    assert.equal(destination(OLD, '/', '', ''), 'https://manaduit.com/');
    assert.equal(destination(OLD, '/app', '?a=1&b=2', '#top'), 'https://manaduit.com/app?a=1&b=2#top');
    assert.equal(destination(OLD, '/guides/sst-vs-service-charge', '', ''), 'https://manaduit.com/guides/sst-vs-service-charge');
    assert.equal(destination(OLD, '/ms/privacy', '', ''), 'https://manaduit.com/ms/privacy');
    assert.equal(destination(OLD.toUpperCase(), '/terms', '', ''), 'https://manaduit.com/terms');
    // sign-in links carry their data in the hash, and it must survive the move
    assert.equal(destination(OLD, '/app', '', '#access_token=t&type=signup'), 'https://manaduit.com/app#access_token=t&type=signup');
});

test('any other host is left alone: the new address, local testing, previews, look-alikes', () => {
    for (const host of ['manaduit.com', 'www.manaduit.com', '127.0.0.1', 'localhost', 'preview.tkqvincent2.workers.dev', 'vinexpenses.workers.dev', 'vinexpenses.evil.com', 'vinexpenses.tkqvincent2.workers.dev.evil.com', 'evilvinexpenses.tkqvincent2.workers.dev', '', undefined, null]) {
        assert.equal(destination(host, '/app', '', ''), null, String(host));
    }
});

test('a crafted path can never change the website the person is sent to', () => {
    for (const path of ['//evil.example', '///evil.example/x', '/\\evil.example', '/\\\\evil.example', '/..//evil.example', '/@evil.example', 'evil.example']) {
        const to = destination(OLD, path, '', '');
        assert.ok(to.startsWith('https://manaduit.com/'), `${path} -> ${to}`);
        assert.equal(new URL(to).hostname, 'manaduit.com', `${path} -> ${to}`);
    }
});
