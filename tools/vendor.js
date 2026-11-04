#!/usr/bin/env node
// Self-hosts third-party browser code so the site never loads scripts or styles from someone else's server.
//
//   node tools/vendor.js           download + verify + copy the packages in vendor/vendor.config.json, rewrite the lockfile
//   node tools/vendor.js verify    offline: check that every file in vendor/ still matches vendor/VENDOR.lock.json
//
// WHY: a script tag pointing at a CDN lets that CDN (or anyone who hijacks the package) run code inside the page,
// where it could read every signed-in user's session. Hosting pinned, hash-checked copies removes that risk, and
// lets the Content-Security-Policy say `script-src 'self'` with no exceptions.
//
// `update` verifies each download against the integrity hash that the npm registry publishes for that exact
// version, then records a SHA-384 for every file we keep. CI runs `verify`, so a modified vendor file fails the build.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const VENDOR = path.join(ROOT, 'vendor');
const CONFIG = path.join(VENDOR, 'vendor.config.json');
const LOCK = path.join(VENDOR, 'VENDOR.lock.json');

const sha384 = buf => 'sha384-' + crypto.createHash('sha384').update(buf).digest('base64');

function walk(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(full));
        else out.push(full);
    }
    return out;
}

function relative(file) {
    return path.relative(VENDOR, file).split(path.sep).join('/');
}

async function download(pkg, version) {
    const meta = await (await fetch(`https://registry.npmjs.org/${pkg.replace('/', '%2F')}/${version}`)).json();
    if (!meta.dist || !meta.dist.tarball) throw new Error(`Registry has no ${pkg}@${version}`);
    const response = await fetch(meta.dist.tarball);
    if (!response.ok) throw new Error(`Could not download ${meta.dist.tarball}`);
    const tarball = Buffer.from(await response.arrayBuffer());

    // The registry publishes an integrity hash (sha512) for every version; refuse anything that does not match it.
    const [algorithm, expected] = String(meta.dist.integrity || '').split('-');
    if (algorithm !== 'sha512' || !expected) throw new Error(`${pkg}@${version}: registry gave no sha512 integrity`);
    const actual = crypto.createHash('sha512').update(tarball).digest('base64');
    if (actual !== expected) throw new Error(`${pkg}@${version}: download does not match the registry integrity hash. Not using it.`);
    return { tarball, integrity: meta.dist.integrity, license: meta.license };
}

function extract(tarball) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vendor-'));
    const file = path.join(dir, 'package.tgz');
    fs.writeFileSync(file, tarball);
    // Windows 10+, macOS and Linux all ship a `tar` that reads .tgz. Run it INSIDE the folder with relative names:
    // GNU tar (Git Bash) reads "C:\..." as a remote host called "C".
    execFileSync('tar', ['-xzf', 'package.tgz'], { cwd: dir, stdio: 'pipe' });
    return path.join(dir, 'package');
}

async function update() {
    const config = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
    const lock = { generated: 'by tools/vendor.js. Do not edit by hand.', packages: {}, files: {} };

    for (const [name, spec] of Object.entries(config.packages)) {
        if (!/^\d+\.\d+\.\d+$/.test(spec.version)) throw new Error(`${name}: pin an exact version (got "${spec.version}")`);
        process.stdout.write(`${name}@${spec.version} ... `);
        const { tarball, integrity, license } = await download(name, spec.version);
        const pkgDir = extract(tarball);

        const target = path.join(VENDOR, spec.dir);
        fs.rmSync(target, { recursive: true, force: true });
        for (const [from, to] of Object.entries(spec.files)) {
            const source = path.join(pkgDir, from);
            if (!fs.existsSync(source)) throw new Error(`${name}: ${from} is not in the package`);
            const files = fs.statSync(source).isDirectory() ? walk(source).filter(f => !spec.skip || !spec.skip.some(s => f.endsWith(s))) : [source];
            for (const file of files) {
                const dest = fs.statSync(source).isDirectory() ? path.join(target, to, path.relative(source, file)) : path.join(target, to);
                fs.mkdirSync(path.dirname(dest), { recursive: true });
                fs.copyFileSync(file, dest);
            }
        }
        for (const licenseName of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENSE.mit', 'LICENSE.txt']) {
            const candidate = path.join(pkgDir, licenseName);
            if (fs.existsSync(candidate)) { fs.copyFileSync(candidate, path.join(target, 'LICENSE.txt')); break; }
        }
        lock.packages[name] = { version: spec.version, integrity, license: license || '', dir: spec.dir };
        console.log('ok');
    }

    for (const file of walk(VENDOR).sort()) {
        const rel = relative(file);
        if (rel === 'VENDOR.lock.json' || rel === 'vendor.config.json') continue;
        lock.files[rel] = sha384(fs.readFileSync(file));
    }
    fs.writeFileSync(LOCK, JSON.stringify(lock, null, 2) + '\n');
    console.log(`\nWrote vendor/VENDOR.lock.json (${Object.keys(lock.files).length} files).`);
}

function verify() {
    const lock = JSON.parse(fs.readFileSync(LOCK, 'utf8'));
    const problems = [];
    const seen = new Set();
    for (const [rel, expected] of Object.entries(lock.files)) {
        seen.add(rel);
        const file = path.join(VENDOR, rel);
        if (!fs.existsSync(file)) { problems.push(`missing: ${rel}`); continue; }
        if (sha384(fs.readFileSync(file)) !== expected) problems.push(`MODIFIED: ${rel}`);
    }
    for (const file of walk(VENDOR)) {
        const rel = relative(file);
        if (rel === 'VENDOR.lock.json' || rel === 'vendor.config.json') continue;
        if (!seen.has(rel)) problems.push(`unexpected file: ${rel}`);
    }
    if (problems.length) {
        console.error('vendor/ does not match VENDOR.lock.json:\n  ' + problems.join('\n  '));
        process.exit(1);
    }
    console.log(`vendor/ OK: ${seen.size} files match the lockfile.`);
}

if (process.argv[2] === 'verify') verify();
else update().catch(error => { console.error('\n✖ ' + error.message); process.exit(1); });

module.exports = { sha384 };
