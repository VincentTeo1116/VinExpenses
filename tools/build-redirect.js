#!/usr/bin/env node
// Builds the small "we have moved" site that GitHub Pages publishes once the app lives on Cloudflare.
//   REDIRECT_TO=https://vinexpenses.example.workers.dev BASE=/VinExpenses/ node tools/build-redirect.js dist
// The page is also written as 404.html, because GitHub Pages answers every unknown address with it: a link to any old page therefore
// lands here too, and redirect.js carries the page, the query and the hash across.
const fs = require('node:fs');
const path = require('node:path');

/** Only a plain https address (no path, no credentials, no query) is accepted as the place to send people. */
const validTarget = (value) => /^https:\/\/[a-z0-9.-]+(:\d+)?\/?$/i.test(String(value ?? ''));
/** The folder the old site is served from: "/" or "/something/". */
const validBase = (value) => /^\/([A-Za-z0-9._-]+\/)*$/.test(String(value ?? ''));

function build({ target, base, out, source = path.join(__dirname, '..', 'redirect') }) {
    if (!validTarget(target)) throw new Error(`REDIRECT_TO must be a plain https address such as https://example.workers.dev (got "${target}")`);
    if (!validBase(base)) throw new Error(`BASE must look like / or /name/ (got "${base}")`);
    const origin = target.replace(/\/+$/, '');
    const page = fs.readFileSync(path.join(source, 'index.html'), 'utf8').split('__TARGET__').join(origin).split('__BASE__').join(base);
    fs.rmSync(out, { recursive: true, force: true });
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'index.html'), page);
    fs.writeFileSync(path.join(out, '404.html'), page);
    fs.copyFileSync(path.join(source, 'redirect.js'), path.join(out, 'redirect.js'));
    fs.copyFileSync(path.join(source, 'sw.js'), path.join(out, 'sw.js'));
    return origin;
}

module.exports = { build, validTarget, validBase };

if (require.main === module) {
    const out = process.argv[2] || 'dist';
    const origin = build({ target: process.env.REDIRECT_TO, base: process.env.BASE || '/', out });
    console.log(`Redirect site written to ${out}: every address goes to ${origin}`);
}
