// Test doubles: a scripted SMTP server (no network) and an in-memory stand-in for Supabase (auth, tables, rpc).
'use strict';

/** A fake Gmail. Reply strings can be overridden per test; `transcript` records what the client sent. */
function fakeSmtp(options = {}) {
    const reply = {
        greeting: '220 smtp.gmail.com ESMTP ready',
        ehlo: '250-smtp.gmail.com at your service\r\n250-SIZE 35882577\r\n250 AUTH LOGIN PLAIN',
        auth: '235 2.7.0 Accepted',
        mail: '250 2.1.0 OK',
        rcpt: '250 2.1.5 OK',
        data: '354 Go ahead',
        end: '250 2.0.0 OK queued',
        ...options.reply,
    };
    const transcript = [];
    const state = { message: '', connected: null, closed: false, opened: 0 };
    const chunks = [];
    let waiting = null;
    let ended = false;
    let inData = false;
    let dataBuffer = '';
    let pending = '';

    const wake = () => {
        if (waiting && (chunks.length || ended)) {
            const resolve = waiting;
            waiting = null;
            resolve(chunks.length ? chunks.shift() : null);
        }
    };
    const say = (text) => {
        const bytes = Buffer.from(text.endsWith('\r\n') ? text : text + '\r\n');
        const size = options.chunk || bytes.length;
        for (let i = 0; i < bytes.length; i += size) chunks.push(new Uint8Array(bytes.subarray(i, i + size)));
        wake();
    };
    const respond = (command, text) => {
        if (options.hangAt === command) return;
        if (options.dropAt === command) { ended = true; wake(); return; }
        say(text);
    };

    const connector = async (host, port) => {
        state.connected = { host, port };
        state.opened++;
        if (options.refuse) throw new Error('refused');
        respond('GREETING', reply.greeting);
        return {
            read() {
                return new Promise((resolve) => { waiting = resolve; wake(); });
            },
            async write(data) {
                const text = Buffer.from(data).toString('utf8');
                if (inData) {
                    dataBuffer += text;
                    if (dataBuffer.endsWith('\r\n.\r\n')) {
                        inData = false;
                        state.message = dataBuffer.slice(0, -3);
                        transcript.push('<message>');
                        respond('END', reply.end);
                    }
                    return;
                }
                pending += text;
                let index;
                while ((index = pending.indexOf('\r\n')) !== -1) {
                    const line = pending.slice(0, index);
                    pending = pending.slice(index + 2);
                    transcript.push(line);
                    const verb = line.split(' ')[0].toUpperCase();
                    if (verb === 'EHLO') respond('EHLO', reply.ehlo);
                    else if (verb === 'AUTH') respond('AUTH', reply.auth);
                    else if (verb === 'MAIL') respond('MAIL', reply.mail);
                    else if (verb === 'RCPT') respond('RCPT', reply.rcpt);
                    else if (verb === 'DATA') { inData = true; dataBuffer = ''; respond('DATA', reply.data); }
                    else if (verb === 'QUIT') { /* no reply needed */ }
                    else say('500 5.5.1 unrecognized command');
                }
            },
            close() { state.closed = true; },
        };
    };
    return { connector, transcript, state };
}

/** Splits a raw message into headers (object, lower-case names) and its decoded text/html parts. */
function parseMessage(raw) {
    const [head, ...rest] = raw.split('\r\n\r\n');
    const headers = {};
    const unfolded = head.replace(/\r\n[ \t]+/g, ' ');
    for (const line of unfolded.split('\r\n')) {
        const i = line.indexOf(':');
        headers[line.slice(0, i).toLowerCase()] = line.slice(i + 1).trim();
    }
    const parts = {};
    const body = rest.join('\r\n\r\n');
    for (const block of body.split(/--=_vx_[0-9a-f]+(?:--)?\r\n?/).filter((b) => b.trim())) {
        const [ph, ...pb] = block.split('\r\n\r\n');
        const type = /Content-Type: (text\/\w+)/.exec(ph)?.[1];
        if (type) parts[type] = Buffer.from(pb.join('').replace(/\r\n/g, ''), 'base64').toString('utf8');
    }
    return { headers, parts };
}

// ------------------------------------------------------------------ fake Supabase

function splitTop(text) {
    const out = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '(') depth++;
        else if (text[i] === ')') depth--;
        else if (text[i] === ',' && depth === 0) { out.push(text.slice(start, i)); start = i + 1; }
    }
    out.push(text.slice(start));
    return out;
}

function matchCondition(row, expr) {
    const group = /^(and|or)\((.*)\)$/s.exec(expr);
    if (group) {
        const results = splitTop(group[2]).map((e) => matchCondition(row, e));
        return group[1] === 'and' ? results.every(Boolean) : results.some(Boolean);
    }
    const dot = expr.indexOf('.');
    const col = expr.slice(0, dot);
    return matchOperator(row[col], expr.slice(dot + 1));
}

function matchOperator(value, rest) {
    if (rest === 'is.null') return value === null || value === undefined;
    if (rest === 'not.is.null') return value !== null && value !== undefined;
    if (rest.startsWith('eq.')) return String(value) === rest.slice(3);
    if (rest.startsWith('neq.')) return String(value) !== rest.slice(4);
    if (rest.startsWith('gte.')) return String(value) >= rest.slice(4);
    if (rest.startsWith('lt.')) return String(value) < rest.slice(3);
    if (rest.startsWith('gt.')) return String(value) > rest.slice(3);
    throw new Error('fake supabase: unsupported operator ' + rest);
}

function rowMatches(row, params) {
    for (const [key, value] of params) {
        if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(key)) continue;
        if (key === 'and' || key === 'or') {
            if (!matchCondition(row, `${key}${value}`)) return false;
        } else if (!matchOperator(row[key], value)) return false;
    }
    return true;
}

function fakeSupabase() {
    const db = {
        users: new Map(),            // token -> {id,email,email_confirmed_at}
        monthly_report_preferences: [],
        expenses: [], incomes: [], user_categories: [],
        app_admins: [],
        telegram_links: [], telegram_link_codes: [], telegram_seen: [], telegram_pending: [], user_payment_methods: [], budgets: [],
        counters: new Map(),
        requests: [],
        quotaCalls: [],
        failures: new Set(),         // e.g. 'rpc/consume_quota' to simulate an outage
    };
    db.addUser = (token, id, email, confirmed = true) => db.users.set(token, { id, email, email_confirmed_at: confirmed ? '2026-01-01T00:00:00Z' : null });

    const respond = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

    db.fetch = async (input, init = {}) => {
        const url = new URL(typeof input === 'string' ? input : input.url);
        const method = (init.method || 'GET').toUpperCase();
        const headers = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
        db.requests.push({ method, path: url.pathname + url.search, headers, body: init.body });
        const path = url.pathname;

        if (path === '/auth/v1/user') {
            const token = (headers.authorization || '').replace(/^Bearer /i, '');
            const user = db.users.get(token);
            return user ? respond(user) : respond({ msg: 'invalid' }, 401);
        }
        if (!path.startsWith('/rest/v1/')) throw new Error('fake supabase: unexpected request ' + url.href);
        const table = path.slice('/rest/v1/'.length);
        if (headers.authorization !== 'Bearer service-key') return respond({ message: 'permission denied' }, 401);
        if (db.failures.has(table)) return respond({ message: 'boom' }, 500);

        const body = init.body ? JSON.parse(init.body) : undefined;
        if (table === 'rpc/consume_quota') {
            db.quotaCalls.push(body);
            const used = db.counters.get(body.p_scope) || 0;
            if (used >= body.p_limit) return respond(false);
            db.counters.set(body.p_scope, used + 1);
            return respond(true);
        }
        if (table === 'rpc/consume_receipt_quota') {
            const key = `ocr:${body.p_user}`;
            const used = db.counters.get(key) || 0;
            if (used >= body.p_limit) return respond(false);
            db.counters.set(key, used + 1);
            return respond(true);
        }
        if (table === 'rpc/claim_first_admin') {
            if (db.app_admins.length) return respond(false);
            const real = [...db.users.values()].find((u) => u.id === body.p_user && u.email.toLowerCase() === body.p_email.toLowerCase() && u.email_confirmed_at);
            if (!real) return respond(false);
            db.app_admins.push({ user_id: body.p_user });
            return respond(true);
        }
        const rows = db[table];
        if (!Array.isArray(rows)) return respond({ message: 'unknown table ' + table }, 404);
        const matched = rows.filter((row) => rowMatches(row, url.searchParams));
        const filtered = [...url.searchParams.keys()].some((k) => !['select', 'order', 'limit', 'offset', 'on_conflict'].includes(k));
        const wantsRows = (headers.prefer || '').includes('return=representation');
        if (method === 'POST') {
            const pk = { telegram_seen: 'update_id', telegram_links: 'chat_id', telegram_link_codes: 'code_hash', telegram_pending: 'chat_id' }[table];
            const inserted = [];
            for (const item of Array.isArray(body) ? body : [body]) {
                const row = { ...item };
                if (table === 'expenses' || table === 'incomes') { row.id = row.id || crypto.randomUUID(); row.created_at = row.created_at || new Date().toISOString(); }
                const clash = (pk && rows.some((r) => String(r[pk]) === String(row[pk])))
                    || (table === 'telegram_links' && rows.some((r) => r.user_id === row.user_id));
                if (clash && (headers.prefer || '').includes('merge-duplicates')) {
                    Object.assign(rows.find((r) => String(r[pk]) === String(row[pk])), row);
                    continue;
                }
                if (clash) {
                    if ((headers.prefer || '').includes('ignore-duplicates')) continue;
                    return respond({ code: '23505' }, 409);
                }
                rows.push(row);
                inserted.push(row);
            }
            return wantsRows ? respond(inserted, 201) : new Response(null, { status: 201 });
        }
        if ((method === 'PATCH' || method === 'DELETE') && !filtered) return respond({ message: 'refusing an unfiltered ' + method }, 400);
        if (method === 'DELETE') {
            const removed = matched.slice();
            rows.splice(0, rows.length, ...rows.filter((row) => !removed.includes(row)));
            return wantsRows ? respond(removed) : new Response(null, { status: 204 });
        }
        if (method === 'GET') {
            const offset = Number(url.searchParams.get('offset') || 0);
            const limit = Number(url.searchParams.get('limit') || 1000);
            return respond(matched.slice(offset, offset + limit));
        }
        if (method === 'PATCH') {
            matched.forEach((row) => Object.assign(row, body));
            return wantsRows ? respond(matched) : new Response(null, { status: 204 });
        }
        throw new Error('fake supabase: unsupported method ' + method);
    };
    return db;
}

module.exports = { fakeSmtp, parseMessage, fakeSupabase };
