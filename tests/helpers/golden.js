// Recorded answers of the old site's code, so the parity tests keep proving "same inputs in, same answers out" after the old files
// (legacy/) are gone. While the old module exists, run once with GOLDEN_WRITE=1 to record every call the tests make and what it
// returned; every other run replays those answers from tests/fixtures/golden/<name>.json.gz.
// NaN, Infinity and undefined survive the round trip (plain JSON would lose them), and a property set to undefined stays present.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const DIR = path.join(__dirname, '..', 'fixtures', 'golden');
const WRITE = process.env.GOLDEN_WRITE === '1';

const encode = (value) =>
    JSON.stringify(value, function replacer(key, v) {
        if (typeof v === 'number' && !Number.isFinite(v)) return { $num: String(v) };
        if (v === undefined) return { $undefined: true };
        return v;
    });

function revive(value) {
    if (Array.isArray(value)) return value.map(revive);
    if (!value || typeof value !== 'object') return value;
    const keys = Object.keys(value);
    if (keys.length === 1 && keys[0] === '$num') return Number(value.$num);
    if (keys.length === 1 && keys[0] === '$undefined') return undefined;
    const out = {};
    for (const key of keys) out[key] = revive(value[key]); // assignment keeps a key whose value is undefined
    return out;
}
const decode = (text) => revive(JSON.parse(text));
const copy = (value) => decode(encode(value));
const hasMethods = (value) => value && typeof value === 'object' && !Array.isArray(value) && Object.values(value).some((v) => typeof v === 'function');

/**
 * Stands in for an old module. `load` is called only while recording. Functions return what the old module returned for the same
 * arguments; objects with methods (for example a sample-data maker) are recorded the same way, method by method; promises too.
 */
function golden(name, load) {
    const file = path.join(DIR, `${name}.json.gz`);
    const store = WRITE ? {} : decode(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'));
    if (WRITE) {
        process.on('exit', () => {
            fs.mkdirSync(DIR, { recursive: true });
            fs.writeFileSync(file, zlib.gzipSync(encode(store), { level: 9 }));
        });
    }
    const keyOf = (prefix, args) => `${prefix}(${encode(args)})`;
    const wrap = (target, prefix) =>
        new Proxy(
            {},
            {
                get(_, prop) {
                    if (typeof prop === 'symbol' || prop === 'then') return undefined; // never look like a promise
                    const name = `${prefix}.${prop}`;
                    if (WRITE) {
                        const value = target[prop];
                        if (typeof value !== 'function') {
                            store[name] = { value: copy(value) };
                            return value;
                        }
                        return (...args) => {
                            const key = keyOf(name, args);
                            const out = value.apply(target, args);
                            if (out && typeof out.then === 'function') {
                                return out.then((result) => {
                                    store[key] = { promise: copy(result) };
                                    return result;
                                });
                            }
                            if (hasMethods(out)) {
                                store[key] = { object: true };
                                return wrap(out, key);
                            }
                            store[key] = { result: copy(out) };
                            return out;
                        };
                    }
                    if (store[name] && 'value' in store[name]) return store[name].value;
                    return (...args) => {
                        const key = keyOf(name, args);
                        const entry = store[key];
                        if (!entry) throw new Error(`no recorded answer for ${key.slice(0, 160)} (record with GOLDEN_WRITE=1 while legacy/ exists)`);
                        if (entry.object) return wrap(null, key);
                        if ('promise' in entry) return Promise.resolve(entry.promise);
                        return entry.result;
                    };
                },
            },
        );
    return wrap(WRITE ? load() : null, name);
}

module.exports = { golden };
