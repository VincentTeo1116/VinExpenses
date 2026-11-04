#!/usr/bin/env node
// Narrows the Content-Security-Policy in a built index.html from "any Supabase project" to YOUR project only.
//
//   SUPABASE_URL=https://abcd.supabase.co node tools/pin-csp.js dist/index.html
//
// The committed index.html says `connect-src ... https://*.supabase.co` so that local development works with any
// project. In production an exact address is better: if an attacker ever got script running on the page, a wildcard
// would let it send data to THEIR OWN Supabase project. This step runs in the deploy and fails it if the result is
// not strictly exact, so a mistake can never publish the loose version.

const fs = require('fs');

const WILDCARD = 'https://*.supabase.co';
const EXACT_ORIGIN = /^https:\/\/[a-z0-9]{10,40}\.supabase\.co$/;

function cspOf(html) {
    const match = html.match(/<meta[^>]+http-equiv="Content-Security-Policy"[^>]+content="([^"]*)"/i);
    if (!match) throw new Error('No Content-Security-Policy <meta> tag found in the page.');
    return match[1];
}

function pinCsp(html, supabaseUrl) {
    const origin = String(supabaseUrl || '').trim().replace(/\/+$/, '');
    if (!EXACT_ORIGIN.test(origin)) {
        throw new Error(`SUPABASE_URL must look like https://<project-ref>.supabase.co (got "${origin.slice(0, 60)}").`);
    }
    const before = cspOf(html);
    if (!before.includes(WILDCARD)) throw new Error(`The page's policy does not contain ${WILDCARD}; nothing to pin.`);
    // Replace inside the policy only (an HTML comment above it may mention the same text).
    const tag = html.match(/<meta[^>]+http-equiv="Content-Security-Policy"[^>]*>/i)[0];
    const result = html.replace(tag, tag.replace(WILDCARD, origin));
    const after = cspOf(result);
    if (after.includes('*')) throw new Error('The pinned policy still contains a wildcard. Refusing to continue.');
    if (!after.includes(origin)) throw new Error('The pinned policy does not contain the project address.');
    return result;
}

if (require.main === module) {
    const files = process.argv.slice(2);
    if (!files.length) { console.error('Usage: SUPABASE_URL=... node tools/pin-csp.js <page.html> [more pages...]'); process.exit(2); }
    try {
        for (const file of files) {
            fs.writeFileSync(file, pinCsp(fs.readFileSync(file, 'utf8'), process.env.SUPABASE_URL));
            console.log(file + ': Content-Security-Policy pinned to ' + String(process.env.SUPABASE_URL).replace(/\/+$/, ''));
        }
    } catch (error) {
        console.error('✖ pin-csp: ' + error.message);
        process.exit(1);
    }
}

module.exports = { pinCsp, cspOf };
