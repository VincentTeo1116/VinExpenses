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

// Fake Supabase Section

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

// A stand-in for the sign-in service (Supabase Auth): accounts, emailed codes, sessions and the admin calls.
function fakeAuth(db, respond, url, method, headers, body) {
    const path = url.pathname.slice('/auth/v1/'.length);
    const bearer = (headers.authorization || '').replace(/^Bearer /i, '');
    if (db.authDown) return respond({ msg: 'down' }, 500);
    const find = (email) => db.accounts.find((a) => a.email === String(email || '').toLowerCase());
    const publicUser = (a) => ({
        id: a.id, email: a.email, user_metadata: a.metadata, created_at: a.created_at, last_sign_in_at: a.last_sign_in_at || null,
        email_confirmed_at: a.confirmed ? '2026-01-01T00:00:00Z' : null, banned_until: a.banned ? '2999-01-01T00:00:00Z' : null,
        factors: a.factors, identities: [{ provider: 'email' }], app_metadata: { provider: a.provider || 'email' },
    });
    const sendCode = (a, type) => {
        const code = db.nextCode || String(100000 + Math.floor(Math.random() * 900000));
        a.codes[type] = { code, at: Date.parse(db.now()) };
        db.mail.push({ email: a.email, type, code });
    };
    const session = (a, aal = 'aal1') => {
        const token = `sess.${Buffer.from(JSON.stringify({ aal, sub: a.id })).toString('base64url')}.${db.users.size}`;
        db.users.set(token, () => publicUser(a));
        a.last_sign_in_at = db.now();
        return { access_token: token, refresh_token: `refresh-${db.users.size}`, user: publicUser(a) };
    };
    const captchaMissing = db.captchaRequired && !(body && body.gotrue_meta_security && body.gotrue_meta_security.captcha_token);
    const captchaError = () => respond({ error_code: 'captcha_failed', msg: 'captcha verification process failed' }, 400);

    if (path === 'signup' && method === 'POST') {
        if (captchaMissing) return captchaError();
        const existing = find(body.email);
        if (existing && existing.confirmed) return respond({ id: crypto.randomUUID(), email: existing.email, identities: [] });
        const account = existing || { id: crypto.randomUUID(), email: String(body.email).toLowerCase(), confirmed: false, banned: false, factors: [], codes: {}, created_at: db.now() };
        account.password = body.password;
        account.metadata = body.data || {};
        if (!existing) db.accounts.push(account);
        sendCode(account, 'signup');
        return respond({ ...publicUser(account), identities: [{ provider: 'email' }] });
    }
    if (path === 'resend' && method === 'POST') {
        if (captchaMissing) return captchaError();
        const account = find(body.email);
        if (account && !account.confirmed) sendCode(account, 'signup');
        return respond({});
    }
    if (path === 'recover' && method === 'POST') {
        if (captchaMissing) return captchaError();
        const account = find(body.email);
        if (account) sendCode(account, 'recovery');
        return respond({});
    }
    if (path === 'verify' && method === 'POST') {
        const account = find(body.email);
        const saved = account && account.codes[body.type];
        const fresh = saved && Date.parse(db.now()) - saved.at <= 5 * 60_000;
        if (!saved || !fresh || saved.code !== body.token) return respond({ error_code: 'otp_expired', msg: 'Token has expired or is invalid' }, 403);
        delete account.codes[body.type];
        if (body.type === 'signup') account.confirmed = true;
        return respond(session(account));
    }
    if (path === 'token' && method === 'POST') {
        if (captchaMissing) return captchaError();
        const account = find(body.email);
        if (!account || account.password !== body.password) return respond({ error_code: 'invalid_credentials', msg: 'Invalid login credentials' }, 400);
        if (!account.confirmed) return respond({ error_code: 'email_not_confirmed', msg: 'Email not confirmed' }, 400);
        if (account.banned) return respond({ error_code: 'user_banned', msg: 'User is banned' }, 400);
        return respond(session(account));
    }
    if (path === 'user' && method === 'PUT') {
        const current = db.users.get(bearer);
        const account = current && db.accounts.find((a) => a.id === (typeof current === 'function' ? current() : current).id);
        if (!account) return respond({ msg: 'invalid' }, 401);
        if (body.password === account.password) return respond({ error_code: 'same_password', msg: 'New password should be different from the old password.' }, 422);
        account.password = body.password;
        return respond(publicUser(account));
    }
    if (path === 'logout' && method === 'POST') {
        db.loggedOut = (db.loggedOut || 0) + 1;
        return new Response(null, { status: 204 });
    }
    if (path.startsWith('admin/')) {
        if (bearer !== 'service-key') return respond({ msg: 'not allowed' }, 403);
        if (path === 'admin/generate_link' && method === 'POST') {
            const target = find(body.email);
            if (!target) return respond({ msg: 'User not found' }, 404);
            const code = db.nextCode || String(100000 + Math.floor(Math.random() * 900000));
            target.codes[body.type] = { code, at: Date.parse(db.now()) }; // made, but NOT emailed by the sign-in service
            return respond({ email_otp: code, action_link: 'https://abcdefghij.supabase.co/auth/v1/verify?token=x', verification_type: body.type });
        }
        const parts = path.split('/'); // admin / users / <id> / factors / <fid>
        if (parts.length === 2 && method === 'GET') {
            const page = Number(url.searchParams.get('page') || 1);
            const per = Number(url.searchParams.get('per_page') || 50);
            return respond({ users: db.accounts.slice((page - 1) * per, page * per).map(publicUser) });
        }
        const account = db.accounts.find((a) => a.id === parts[2]);
        if (!account) return respond({ msg: 'User not found' }, 404);
        if (parts.length === 3 && method === 'GET') return respond(publicUser(account));
        if (parts.length === 3 && method === 'PUT') {
            if ('ban_duration' in body) account.banned = body.ban_duration !== 'none';
            return respond(publicUser(account));
        }
        if (parts[3] === 'factors' && parts.length === 4 && method === 'GET') return respond(account.factors);
        if (parts[3] === 'factors' && parts.length === 5 && method === 'DELETE') {
            account.factors = account.factors.filter((f) => f.id !== parts[4]);
            return respond({});
        }
    }
    throw new Error('fake sign-in service: unexpected request ' + method + ' ' + url.pathname);
}

function fakeSupabase() {
    const db = {
        users: new Map(),            // token -> {id,email,email_confirmed_at}
        monthly_report_preferences: [],
        expenses: [], incomes: [], user_categories: [],
        app_admins: [], announcements: [], announcement_reads: [],
        telegram_links: [], telegram_link_codes: [], telegram_seen: [], telegram_pending: [], user_payment_methods: [], budgets: [],
        fixed_deposits: [], loans: [], reminder_log: [], user_preferences: [], recurring_expenses: [],
        auth_code_requests: [], auth_lockouts: [], mfa_recovery_codes: [], admin_audit_log: [], feedback: [],
        accounts: [],                // the stand-in sign-in service: {id,email,password,confirmed,banned,metadata,factors,codes}
        mail: [],                    // codes the sign-in service "emailed": {email, type, code}
        captchaRequired: false, authDown: false, nextCode: null,
        counters: new Map(),
        requests: [],
        quotaCalls: [],
        now: () => new Date().toISOString(), // tests replace this with their fixed clock, so stored times agree with the bot's
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

        if (path === '/auth/v1/user' && method === 'GET') {
            const token = (headers.authorization || '').replace(/^Bearer /i, '');
            const user = db.users.get(token);
            return user ? respond(typeof user === 'function' ? user() : user) : respond({ msg: 'invalid' }, 401);
        }
        if (path.startsWith('/auth/v1/')) return fakeAuth(db, respond, url, method, headers, init.body ? JSON.parse(init.body) : {});
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
        if (table === 'rpc/record_signin_failure') {
            // The same rules as the SQL function: count per device, block the device, then the whole email
            const cutoff = Date.parse(db.now()) - body.p_hours * 3600_000;
            let row = db.auth_lockouts.find((r) => r.email === body.p_email && r.device_id === body.p_device);
            if (!row) { row = { email: body.p_email, device_id: body.p_device, fails: 0, last_fail_at: null, blocked_at: null, manual: false }; db.auth_lockouts.push(row); }
            row.fails = !row.last_fail_at || Date.parse(row.last_fail_at) < cutoff ? 1 : row.fails + 1;
            row.last_fail_at = db.now();
            let blocked = null;
            if (row.fails >= body.p_max && (!row.blocked_at || Date.parse(row.blocked_at) < cutoff)) { row.blocked_at = db.now(); blocked = row.blocked_at; }
            const total = db.auth_lockouts.filter((r) => r.email === body.p_email && r.device_id !== '*' && Date.parse(r.last_fail_at) >= cutoff).reduce((s, r) => s + r.fails, 0);
            if (total >= body.p_email_max) {
                let all = db.auth_lockouts.find((r) => r.email === body.p_email && r.device_id === '*');
                if (!all) { all = { email: body.p_email, device_id: '*', fails: total, last_fail_at: db.now(), blocked_at: null, manual: false }; db.auth_lockouts.push(all); }
                if (!all.manual && (!all.blocked_at || Date.parse(all.blocked_at) < cutoff)) all.blocked_at = db.now();
                blocked = blocked || db.now();
            }
            return respond(blocked);
        }
        if (table === 'rpc/admin_user_stats') {
            return respond(body.p_users.map((id) => ({
                user_id: id,
                last_expense_at: db.expenses.filter((e) => e.user_id === id).map((e) => e.created_at).sort().pop() || null,
                telegram_linked: db.telegram_links.some((t) => t.user_id === id),
            })));
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
                if (table === 'expenses' || table === 'incomes' || table === 'announcements') { row.id = row.id || crypto.randomUUID(); row.created_at = row.created_at || db.now(); }
                if (table === 'reminder_log') { row.id = rows.length + 1; row.sent_at = row.sent_at ?? null; }
                if (['auth_code_requests', 'mfa_recovery_codes', 'admin_audit_log', 'feedback'].includes(table)) {
                    db.sequence = (db.sequence || 0) + 1;
                    row.id = db.sequence;
                    if (table === 'mfa_recovery_codes') row.used_at = row.used_at ?? null;
                    if (table === 'feedback') { row.status = row.status || 'open'; row.created_at = row.created_at || db.now(); }
                    if (table === 'admin_audit_log') row.created_at = row.created_at || db.now();
                }
                const sameReminder = (r) => ['item_kind', 'item_id', 'due_date', 'lead_days'].every((k) => String(r[k]) === String(row[k]));
                const clash = (pk && rows.some((r) => String(r[pk]) === String(row[pk])))
                    || (table === 'telegram_links' && rows.some((r) => r.user_id === row.user_id))
                    || (table === 'reminder_log' && rows.some(sameReminder)); // the table's unique key
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
            const order = (url.searchParams.get('order') || '').split(',').filter(Boolean).map((part) => {
                const [column, direction] = part.split('.');
                return { column, sign: direction === 'desc' ? -1 : 1 };
            });
            const sorted = order.length
                ? matched.slice().sort((a, b) => {
                    for (const { column, sign } of order) {
                        const x = a[column];
                        const y = b[column];
                        if (x === y) continue;
                        if (x === undefined || x === null) return 1;
                        if (y === undefined || y === null) return -1;
                        const numeric = !Number.isNaN(Number(x)) && !Number.isNaN(Number(y)) && column !== 'created_at';
                        return (numeric ? Number(x) - Number(y) : String(x) < String(y) ? -1 : 1) * sign;
                    }
                    return 0;
                })
                : matched;
            return respond(sorted.slice(offset, offset + limit));
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
