// A small local stand-in for Supabase, used only by the end-to-end tests. It speaks just enough of the Auth API
// (user, token refresh, factors) and implements the auth-gate and feedback functions with the same rules and answers
// as the real ones (code limits, 5-try lockout, recovery codes). Nothing here is ever deployed.
import { createServer } from 'node:http';

const PORT = Number(process.argv[2] ?? 54321);
const GOOD = 'Str0ng!Passw0rd';
const HOUR = 3600_000;

const state = { users: new Map(), codeLog: [], fails: new Map(), blocked: new Map(), manual: new Set(), mail: [], feedback: [], tokens: new Map(), refresh: new Map(), recovery: new Map(), tables: new Map(), ocr: new Map(), fx: new Map(), nearby: new Map(), telegram: new Map(), admins: new Set(), audit: [] };
let counter = 0;

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const uid = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

function seed(input) {
  const email = String(input.email).toLowerCase();
  const user = {
    id: uid(), email, password: input.password ?? GOOD, name: input.name ?? '', confirmed: input.confirmed !== false, provider: input.google ? 'google' : 'email',
    disabled: Boolean(input.disabled), factors: input.factor ? [{ id: `f-${uid()}`, status: 'verified', factor_type: 'totp', friendly_name: 'ManaDuit' }] : [], codes: {}, created_at: new Date().toISOString(),
  };
  state.users.set(email, user);
  return user;
}

const publicUser = (user) => ({
  id: user.id, aud: 'authenticated', role: 'authenticated', email: user.email, created_at: user.created_at,
  app_metadata: { provider: user.provider }, user_metadata: { ...(user.name ? { username: user.name } : {}), ...(user.meta ?? {}) }, factors: user.factors.map((f) => ({ ...f })),
});

function makeSession(user, aal = 'aal1') {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const access = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: user.id, email: user.email, role: 'authenticated', aal, exp, amr: [{ method: aal === 'aal2' ? 'totp' : 'password', timestamp: exp - 3600 }], session_id: uid() })}.fakesig`;
  const refresh = `r-${uid()}`;
  state.tokens.set(access, { email: user.email, aal });
  state.refresh.set(refresh, { email: user.email, aal });
  return { access_token: access, refresh_token: refresh, token_type: 'bearer', expires_in: 3600, expires_at: exp, user: publicUser(user) };
}

const userFor = (request) => {
  const token = String(request.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const entry = state.tokens.get(token);
  return entry ? { user: state.users.get(entry.email), aal: entry.aal, token } : null;
};

// ---- the same rules as supabase/functions/_shared/auth-rules.ts ----
const passwordOk = (p) => p.length >= 10 && p.length <= 72 && /[A-Z]/.test(p) && /[a-z]/.test(p) && /\d/.test(p) && /[^A-Za-z0-9\s]/.test(p);
const cleanEmail = (v) => { const e = String(v ?? '').trim().toLowerCase(); return e.length <= 254 && /^[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(e) ? e : ''; };
const cleanName = (v) => { const n = String(v ?? '').replace(/\s+/g, ' ').trim(); return n.length >= 2 && n.length <= 40 && !/[<>]/.test(n) ? n : ''; };
const isCode = (v) => /^\d{6}$/.test(String(v ?? '').trim());
const KL = 8 * HOUR;
const dayStart = (now) => { const l = new Date(now + KL); return Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate()) - KL; };
const monthStart = (now) => { const l = new Date(now + KL); return Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), 1) - KL; };

function reserve(email, purpose) {
  const now = Date.now();
  const mine = state.codeLog.filter((c) => c.email === email);
  if (mine.filter((c) => c.t >= monthStart(now)).length >= 10) return { ok: false, code: 'code_limit_month', message: 'You have asked for 10 codes this month, which is the limit. Please contact the admin to continue.' };
  if (mine.filter((c) => c.t >= dayStart(now)).length >= 3) return { ok: false, code: 'code_limit_day', retryAt: new Date(dayStart(now) + 24 * HOUR).toISOString(), message: 'You can ask for 3 codes a day. Please try again tomorrow, or contact the admin.' };
  state.codeLog.push({ email, t: now, purpose });
  return null;
}

function blockedReply(email, device) {
  if (state.manual.has(email)) return { ok: false, code: 'blocked', manual: true, message: 'Sign-in for this account has been paused by the admin.' };
  const until = state.blocked.get(`${email}|${device}`);
  if (until && until > Date.now()) return { ok: false, code: 'blocked', until: new Date(until).toISOString(), message: 'Too many wrong attempts.' };
  return null;
}

function passwordCheck(email, password, device) {
  const lock = blockedReply(email, device);
  if (lock) return { reply: lock };
  const user = state.users.get(email);
  if (!user || user.password !== password) {
    const key = `${email}|${device}`;
    const n = (state.fails.get(key) ?? 0) + 1;
    state.fails.set(key, n);
    if (n >= 5) { state.blocked.set(key, Date.now() + 3 * HOUR); return { reply: blockedReply(email, device) }; }
    return { reply: { ok: false, code: 'invalid', message: 'Wrong email or password.' } };
  }
  if (!user.confirmed) return { reply: { ok: false, code: 'unconfirmed', message: 'This email is not verified yet.' } };
  if (user.disabled) return { reply: { ok: false, code: 'disabled', message: 'This account has been disabled.' } };
  state.fails.delete(`${email}|${device}`);
  return { user };
}

const newRecovery = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const t = Array.from({ length: 10 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  return `${t.slice(0, 5)}-${t.slice(5)}`;
};

function gate(body, request) {
  const email = cleanEmail(body.email);
  const device = String(body.device ?? '');
  switch (body.action) {
    case 'signup': {
      if (!email) return { ok: false, code: 'bad_email' };
      if (!cleanName(body.name)) return { ok: false, code: 'bad_name' };
      if (!passwordOk(String(body.password ?? ''))) return { ok: false, code: 'weak_password' };
      const existing = state.users.get(email);
      if (existing?.confirmed) return { ok: false, code: 'exists', message: 'This email already has an account. Please sign in instead.' };
      const limit = reserve(email, 'signup');
      if (limit) return limit;
      const user = existing ?? seed({ email, password: body.password, name: cleanName(body.name), confirmed: false });
      user.password = body.password; user.name = cleanName(body.name);
      user.codes.signup = { code: '123456', at: Date.now() };
      state.mail.push({ email, kind: 'signup', code: '123456' });
      return { ok: true, step: 'verify', minutes: 5 };
    }
    case 'signup_resend': {
      if (!email) return { ok: false, code: 'bad_email' };
      const limit = reserve(email, 'signup');
      if (limit) return limit;
      const user = state.users.get(email);
      if (user) user.codes.signup = { code: '123456', at: Date.now() };
      state.mail.push({ email, kind: 'signup', code: '123456' });
      return { ok: true, minutes: 5 };
    }
    case 'signup_verify': {
      const user = state.users.get(email);
      const c = user?.codes.signup;
      if (!email || !isCode(body.code) || !c || c.code !== String(body.code).trim() || Date.now() - c.at > 5 * 60_000) return { ok: false, code: 'bad_code', message: 'That code is not right or has expired.' };
      user.confirmed = true; delete user.codes.signup;
      return { ok: true, session: makeSession(user) };
    }
    case 'signin': {
      if (!email || !body.password || !/^[A-Za-z0-9_-]{16,64}$/.test(device)) return { ok: false, code: 'invalid', message: 'Wrong email or password.' };
      const result = passwordCheck(email, String(body.password), device);
      return result.reply ?? { ok: true, session: makeSession(result.user) };
    }
    case 'recover': {
      if (!email) return { ok: false, code: 'bad_email' };
      const limit = reserve(email, 'recovery');
      if (limit) return limit;
      const user = state.users.get(email);
      if (user) { user.codes.recovery = { code: '123456', at: Date.now() }; state.mail.push({ email, kind: 'recovery', code: '123456' }); }
      return { ok: true, minutes: 5 };
    }
    case 'reset': {
      const user = state.users.get(email);
      const c = user?.codes.recovery;
      if (!email || !isCode(body.code) || !c || c.code !== String(body.code).trim() || Date.now() - c.at > 5 * 60_000) return { ok: false, code: 'bad_code', message: 'That code is not right or has expired.' };
      if (!passwordOk(String(body.password ?? ''))) return { ok: false, code: 'weak_password' };
      if (user.password === body.password) return { ok: false, code: 'same_password' };
      user.password = body.password; delete user.codes.recovery;
      for (const key of [...state.fails.keys()]) if (key.startsWith(`${email}|`)) state.fails.delete(key);
      for (const key of [...state.blocked.keys()]) if (key.startsWith(`${email}|`)) state.blocked.delete(key);
      return { ok: true };
    }
    case 'mfa_recover': {
      const result = passwordCheck(email, String(body.password ?? ''), device);
      if (result.reply) return result.reply;
      const code = String(body.code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const formatted = code.length === 10 ? `${code.slice(0, 5)}-${code.slice(5)}` : '';
      const list = state.recovery.get(result.user.id) ?? [];
      if (!formatted || !list.includes(formatted)) return { ok: false, code: 'invalid', message: 'That recovery code is not right.' };
      state.recovery.delete(result.user.id);
      result.user.factors = [];
      return { ok: true, session: makeSession(result.user), authenticatorOff: true };
    }
    case 'recovery_codes': {
      const who = userFor(request);
      if (!who?.user || who.aal !== 'aal2' || !who.user.factors.some((f) => f.status === 'verified')) return { ok: false, code: 'no_authenticator', message: 'Turn on an authenticator first.' };
      const codes = Array.from({ length: 8 }, newRecovery);
      state.recovery.set(who.user.id, codes);
      return { ok: true, codes };
    }
    default:
      return { error: 'Bad request.', __status: 400 };
  }
}

function feedback(body, request) {
  const who = userFor(request);
  const email = who?.user?.email || cleanEmail(body.email);
  const topics = ['locked_out', 'code_limit', 'report', 'bug', 'other'];
  const message = String(body.message ?? '').trim();
  if (!email) return { ok: false, field: 'email', message: 'Enter the email address we can reply to.' };
  if (!topics.includes(body.topic)) return { ok: false, field: 'topic', message: 'Choose what this is about.' };
  if (message.length < 5) return { ok: false, field: 'message', message: 'Please tell us a little more (at least 5 characters).' };
  if (message.length > 2000) return { ok: false, field: 'message', message: 'Please keep it under 2,000 characters.' };
  state.feedback.push({ id: state.feedback.length + 1, email, topic: body.topic, message, signedIn: Boolean(who), status: 'open', created_at: new Date().toISOString() });
  return { ok: true, message: 'Thank you. Your message was sent, and the admin will reply by email.' };
}

// ---- HTTP ----
function cors(request, response) {
  response.setHeader('Access-Control-Allow-Origin', request.headers.origin ?? '*');
  response.setHeader('Access-Control-Allow-Headers', 'authorization, apikey, content-type, x-client-info, x-supabase-api-version, prefer, range, range-unit, accept-profile, content-profile, accept');
  response.setHeader('Access-Control-Expose-Headers', 'Content-Range');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  response.setHeader('Vary', 'Origin');
}
const send = (request, response, status, body) => {
  cors(request, response);
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(body === undefined ? '' : JSON.stringify(body));
};
const readBody = (request) => new Promise((resolve) => {
  let raw = '';
  request.on('data', (chunk) => { raw += chunk; });
  request.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); } });
});


// ---- the data API (PostgREST): the same access rule as the real database policies, "you only touch your own rows" ----
const TABLES = {
  expenses: { check: (r) => Number(r.amount) > 0 },
  incomes: { check: (r) => Number(r.amount) > 0, defaults: { source: 'Salary' } },
  recurring_expenses: { check: (r) => Number(r.amount) > 0 && ['weekly', 'monthly', 'yearly'].includes(r.frequency), defaults: { active: true, end_date: null, loan_id: null } },
  recurring_incomes: { check: (r) => Number(r.amount) > 0 && ['weekly', 'monthly', 'yearly'].includes(r.frequency), defaults: { active: true } },
  budgets: { check: (r) => Number(r.amount) > 0, unique: ['user_id', 'category'] },
  user_categories: { check: (r) => String(r.label ?? '').length >= 1 && String(r.label).length <= 32, unique: ['user_id', 'category_key'], defaults: { icon: 'fa-tag', color: '#6b7280', active: true, is_builtin: false, sort_order: 100 } },
  user_payment_methods: { check: (r) => String(r.label ?? '').length >= 1 && String(r.label).length <= 32, unique: ['user_id', 'payment_key'], defaults: { icon: 'fa-wallet', color: '#4f46e5', active: true, is_builtin: false, sort_order: 100 } },
  monthly_report_preferences: {
    check: (r) => ['auto', 'email'].includes(r.channel ?? 'auto') && (r.recipient_email == null || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.recipient_email)),
    unique: ['user_id'],
    defaults: { enabled: false, channel: 'auto', recipient_email: null, verified_email: null, last_status: null, last_channel: null, last_month: null, last_attempt_at: null, resend_count: 0 },
  },
  fixed_deposits: {
    check: (r) => String(r.name ?? '').trim().length >= 1 && String(r.name).length <= 60 && Number(r.principal) >= 1 && Number(r.principal) <= 100000000 && Number(r.rate) > 0 && Number(r.rate) <= 30 && r.maturity_date > r.start_date
      && ['days', 'months', 'years'].includes(r.tenure_unit) && ['maturity', 'monthly', 'quarterly', 'yearly'].includes(r.payout) && ['open', 'closed'].includes(r.status ?? 'open')
      && (r.reminder_days ?? []).length <= 5 && (r.reminder_days ?? []).every((d) => d >= 0 && d <= 60),
    unique: ['id'],
    defaults: { bank: null, payout: 'maturity', tax_rate: 0, day_basis: 365, reminders_on: true, reminder_days: [7, 1, 0], status: 'open', interest_recorded: false },
  },
  loans: {
    check: (r) => String(r.name ?? '').trim().length >= 1 && String(r.name).length <= 60 && Number(r.principal) >= 1 && Number(r.principal) <= 100000000 && Number(r.rate) >= 0 && Number(r.rate) <= 40
      && ['reducing', 'flat'].includes(r.method) && Number(r.term_months) >= 1 && Number(r.term_months) <= 480 && Number(r.instalment) > 0 && ['open', 'closed'].includes(r.status ?? 'open')
      && (r.reminder_days ?? []).length <= 5 && (r.reminder_days ?? []).every((d) => d >= 0 && d <= 60),
    unique: ['id'],
    defaults: { lender: null, fees: 0, reminders_on: true, reminder_days: [3, 0], status: 'open', paid_through: null },
  },
  user_preferences: { check: (r) => ['dmy_short', 'dmy', 'ymd'].includes(r.date_format ?? 'dmy_short'), unique: ['user_id'], defaults: { date_format: 'dmy_short' } },
  // global in the real database (everyone reads the published one); here also limited to the people named in `audience`, so one test's announcement never reaches another test's users
  announcements: { global: true, check: () => false },
  announcement_reads: { check: (r) => Boolean(r.announcement_id), unique: ['user_id', 'announcement_id'] },
};
const dataStore = new Map(Object.keys(TABLES).map((name) => [name, []]));

function matchFilter(row, key, spec) {
  const [op, ...restParts] = spec.split('.');
  const value = restParts.join('.');
  const cell = row[key];
  const text = cell === null || cell === undefined ? null : String(cell);
  switch (op) {
    case 'eq': return text === value;
    case 'neq': return text !== value;
    case 'gt': return text !== null && text > value;
    case 'gte': return text !== null && text >= value;
    case 'lt': return text !== null && text < value;
    case 'lte': return text !== null && text <= value;
    case 'is': return value === 'null' ? text === null : text !== null;
    case 'in': return value.replace(/^\(|\)$/g, '').split(',').map((v) => v.replace(/^"|"$/g, '')).includes(text ?? '');
    default: return true;
  }
}

function rest(request, response, url, table, body) {
  const meta = TABLES[table];
  if (!meta) return send(request, response, 404, { code: 'PGRST205', message: `Could not find the table 'public.${table}'` });
  const who = userFor(request);
  if (!who?.user) return send(request, response, 401, { code: 'PGRST301', message: 'JWT expired or invalid' });
  const me = who.user.id;
  if (meta.global && request.method !== 'GET') return send(request, response, 403, { code: '42501', message: 'permission denied for table ' + table });
  const rows = dataStore.get(table);
  const filters = [...url.searchParams.entries()].filter(([k]) => !['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k));
  const mine = () =>
    meta.global
      ? rows.filter((row) => row.status === 'published' && (row.audience ?? []).includes(who.user.email) && filters.every(([k, v]) => matchFilter(row, k, v)))
      : rows.filter((row) => row.user_id === me && filters.every(([k, v]) => matchFilter(row, k, v)));
  const prefer = String(request.headers.prefer ?? '');
  const wantRows = /return=representation/.test(prefer);
  const single = /vnd\.pgrst\.object/.test(String(request.headers.accept ?? ''));
  const reply = (status, list) => {
    if (single) {
      if (list.length !== 1) return send(request, response, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' });
      return send(request, response, status, list[0]);
    }
    return send(request, response, status, list);
  };

  if (request.method === 'GET') {
    let list = mine().map((row) => ({ ...row }));
    const order = url.searchParams.get('order');
    if (order) {
      for (const part of order.split(',').reverse()) {
        const [col, dir] = part.split('.');
        list.sort((a, b) => (String(a[col] ?? '') < String(b[col] ?? '') ? -1 : String(a[col] ?? '') > String(b[col] ?? '') ? 1 : 0) * (dir === 'desc' ? -1 : 1));
      }
    }
    const range = String(request.headers.range ?? '');
    const m = /^(\d+)-(\d+)$/.exec(range);
    const total = list.length;
    if (m) list = list.slice(Number(m[1]), Number(m[2]) + 1);
    const limit = url.searchParams.get('limit');
    if (limit) list = list.slice(Number(url.searchParams.get('offset') ?? 0), Number(url.searchParams.get('offset') ?? 0) + Number(limit));
    response.setHeader('Content-Range', `${m ? m[1] : 0}-${Math.max(0, list.length - 1)}/${total}`);
    return reply(m && total > list.length ? 206 : 200, list);
  }

  if (request.method === 'POST') {
    const incoming = (Array.isArray(body) ? body : [body]).map((r) => ({ ...(meta.defaults ?? {}), ...r }));
    const upsert = /resolution=merge-duplicates/.test(prefer);
    const created = [];
    for (const row of incoming) {
      if (row.user_id !== me) return send(request, response, 403, { code: '42501', message: 'new row violates row-level security policy' });
      if (!meta.check(row)) return send(request, response, 400, { code: '23514', message: 'new row violates check constraint' });
      const clash = meta.unique && rows.find((r) => meta.unique.every((k) => r[k] === row[k]));
      if (clash) {
        if (!upsert) return send(request, response, 409, { code: '23505', message: 'duplicate key value violates unique constraint' });
        Object.assign(clash, row);
        created.push({ ...clash });
        continue;
      }
      const full = { id: row.id ?? uid(), created_at: new Date().toISOString(), ...row };
      rows.push(full);
      created.push({ ...full });
    }
    return wantRows || single ? reply(201, created) : send(request, response, 201);
  }

  if (request.method === 'PATCH') {
    const targets = mine();
    if (body.user_id && body.user_id !== me) return send(request, response, 403, { code: '42501', message: 'new row violates row-level security policy' });
    for (const row of targets) if (!meta.check({ ...row, ...body })) return send(request, response, 400, { code: '23514', message: 'new row violates check constraint' });
    for (const row of targets) Object.assign(row, body);
    return wantRows || single ? reply(200, targets.map((r) => ({ ...r }))) : send(request, response, 204);
  }

  if (request.method === 'DELETE') {
    const targets = mine();
    for (const row of targets) rows.splice(rows.indexOf(row), 1);
    return wantRows ? reply(200, targets) : send(request, response, 204);
  }
  return send(request, response, 405, { message: 'method not allowed' });
}

createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const path = url.pathname;
  if (request.method === 'OPTIONS') { cors(request, response); response.writeHead(204); return response.end(); }
  const body = request.method === 'GET' || request.method === 'DELETE' ? {} : await readBody(request);

  // test controls
  if (path === '/__test/seed') { const u = seed(body); return send(request, response, 200, { id: u.id, email: u.email }); }
  if (path === '/__test/mail') return send(request, response, 200, state.mail.filter((m) => m.email === String(url.searchParams.get('email')).toLowerCase()));
  if (path === '/__test/block') { if (body.on) state.manual.add(String(body.email).toLowerCase()); else state.manual.delete(String(body.email).toLowerCase()); return send(request, response, 200, { ok: true }); }
  if (path === '/__test/age-code') { const u = state.users.get(String(body.email).toLowerCase()); const c = u?.codes[body.kind]; if (c) c.at -= 6 * 60_000; return send(request, response, 200, { ok: Boolean(c) }); }
  if (path === '/__test/state') { const u = state.users.get(String(url.searchParams.get('email')).toLowerCase()); return send(request, response, 200, { user: u ? { ...u, codes: undefined } : null, feedback: state.feedback }); }
  if (path === '/__test/rows') {
    const u = state.users.get(String(url.searchParams.get('email')).toLowerCase());
    return send(request, response, 200, (dataStore.get(String(url.searchParams.get('table'))) ?? []).filter((r) => !u || r.user_id === u.id));
  }
  if (path === '/__test/insert') {
    const u = state.users.get(String(body.email).toLowerCase());
    const list = dataStore.get(String(body.table));
    for (const row of body.rows) list.push({ id: uid(), created_at: new Date().toISOString(), ...(TABLES[body.table].defaults ?? {}), ...row, user_id: u.id });
    return send(request, response, 200, { ok: true });
  }
  if (path === '/__test/health') return send(request, response, 200, { ok: true });

  if (path === '/functions/v1/auth-gate' && request.method === 'POST') {
    if (!request.headers.origin) return send(request, response, 403, { error: 'This website is not allowed to use this service.' });
    const reply = gate(body, request);
    return send(request, response, reply.__status ?? 200, reply.__status ? { error: reply.error } : reply);
  }
  // The receipt reader: signed-in only, a daily allowance, and the test sets what the "photo" says (or that the service is down)
  // (kept per person, so tests running side by side do not disturb each other)
  if (path === '/__test/ocr') { state.ocr.set(String(body.email).toLowerCase(), { text: body.text ?? '', words: body.words ?? [], mode: body.mode ?? 'ok', calls: 0, limit: body.limit ?? 30 }); return send(request, response, 200, { ok: true }); }
  if (path === '/__test/ocr-calls') return send(request, response, 200, { calls: state.ocr.get(String(url.searchParams.get('email')).toLowerCase())?.calls ?? 0 });
  if (path === '/functions/v1/receipt-ocr' && request.method === 'POST') {
    const who = userFor(request);
    if (!who?.user) return send(request, response, 401, { error: 'Please sign in to scan a receipt.' });
    const ocr = state.ocr.get(String(who.user.email).toLowerCase()) ?? { text: '', mode: 'off', calls: 0, limit: 30 };
    if (ocr.mode === 'off') return send(request, response, 503, { error: 'Receipt scanning is not configured yet.' });
    if (!/^data:image\/(jpeg|png|webp);base64,/.test(String(body.imageData ?? ''))) return send(request, response, 400, { error: 'Choose a JPG, PNG, WebP or PDF receipt.' });
    ocr.calls += 1;
    if (ocr.calls > ocr.limit) return send(request, response, 429, { error: 'You have reached the limit for today for receipt scans. Please enter it manually.' });
    if (ocr.mode === 'unreadable') return send(request, response, 422, { error: 'I couldn’t read this receipt clearly. Try a sharper, well-lit photo or enter it manually.' });
    return send(request, response, 200, ocr.words?.length ? { text: ocr.text, words: ocr.words } : { text: ocr.text });
  }
  // The exchange-rate lookup for a receipt in another currency: the test sets the rate, or that the service is down or only has today's rate
  if (path === '/__test/fx') { state.fx.set(String(body.email).toLowerCase(), { rate: body.rate ?? 4, mode: body.mode ?? 'ok', last: null }); return send(request, response, 200, { ok: true }); }
  if (path === '/__test/fx-last') return send(request, response, 200, state.fx.get(String(url.searchParams.get('email')).toLowerCase())?.last ?? {});
  if (path === '/functions/v1/fx-rate' && request.method === 'POST') {
    const who = userFor(request);
    if (!who?.user) return send(request, response, 401, { error: 'Please sign in.' });
    const fx = state.fx.get(String(who.user.email).toLowerCase()) ?? { rate: 4, mode: 'ok', last: null };
    fx.last = { currency: body.currency, date: body.date };
    if (fx.mode === 'down') return send(request, response, 502, { error: 'The exchange-rate service could not be reached. Enter the ringgit amount yourself.' });
    const today = new Date().toISOString().slice(0, 10);
    return send(request, response, 200, fx.mode === 'fallback' ? { rate: fx.rate, date: today, fallback: true } : { rate: fx.rate, date: body.date, fallback: false });
  }
  // The nearby-places lookup: signed-in only; the test sets the list (or that the map service is down)
  if (path === '/__test/nearby') { state.nearby.set(String(body.email).toLowerCase(), { places: body.places ?? [], mode: body.mode ?? 'ok', calls: 0, limit: body.limit ?? 200, last: null }); return send(request, response, 200, { ok: true }); }
  if (path === '/__test/nearby-last') return send(request, response, 200, state.nearby.get(String(url.searchParams.get('email')).toLowerCase()) ?? {});
  if (path === '/functions/v1/nearby-place' && request.method === 'POST') {
    const who = userFor(request);
    if (!who?.user) return send(request, response, 401, { error: 'Please sign in.' });
    const near = state.nearby.get(String(who.user.email).toLowerCase()) ?? { places: [], mode: 'ok', calls: 0, limit: 200 };
    const valid = typeof body.latitude === 'number' && typeof body.longitude === 'number' && Math.abs(body.latitude) <= 90 && Math.abs(body.longitude) <= 180;
    if (!valid) return send(request, response, 400, { error: 'The location coordinates are invalid.' });
    near.calls += 1;
    near.last = { latitude: body.latitude, longitude: body.longitude, list: body.list === true };
    if (near.calls > near.limit) return send(request, response, 429, { error: 'Daily nearby-place limit reached. Enter the merchant manually.' });
    if (near.mode === 'down') return send(request, response, 502, { error: 'The map services did not answer.' });
    return send(request, response, 200, { places: near.places });
  }
  if (path === '/__test/telegram') { state.telegram.set(String(body.email).toLowerCase(), Boolean(body.linked)); return send(request, response, 200, { ok: true }); }
  if (path === '/__test/verify-report-email') {
    const u = state.users.get(String(body.email).toLowerCase());
    const row = dataStore.get('monthly_report_preferences').find((r) => r.user_id === u?.id);
    if (row) row.verified_email = String(row.recipient_email ?? '').toLowerCase();
    return send(request, response, 200, { ok: Boolean(row) });
  }
  if (path === '/functions/v1/telegram-link' && request.method === 'POST') {
    const who = userFor(request);
    if (!who?.user) return send(request, response, 401, { error: 'Please sign in.' });
    const email = who.user.email;
    if (body.action === 'status') return send(request, response, 200, { linked: Boolean(state.telegram.get(email)), linkedAt: null, remindersBlocked: false });
    if (body.action === 'unlink') { state.telegram.set(email, false); return send(request, response, 200, { linked: false }); }
    if (body.action === 'create') {
      const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      const code = Array.from({ length: 10 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
      return send(request, response, 200, { code, link: `https://t.me/VinExpensesBot?start=${code}`, expiresInSeconds: 600 });
    }
    return send(request, response, 400, { error: 'Unknown action.' });
  }
  if (path === '/functions/v1/email-verify' && request.method === 'POST') {
    const who = userFor(request);
    if (!who?.user) return send(request, response, 401, { error: 'Please sign in.' });
    const row = dataStore.get('monthly_report_preferences').find((r) => r.user_id === who.user.id);
    if (!row?.recipient_email) return send(request, response, 400, { error: 'Save a report email address first.' });
    if (row.verified_email === String(row.recipient_email).toLowerCase()) return send(request, response, 200, { status: 'verified' });
    state.mail.push({ email: String(row.recipient_email).toLowerCase(), kind: 'verify-report-email', at: Date.now() });
    return send(request, response, 200, { status: 'sent' });
  }
  if (path === '/functions/v1/report-resend' && request.method === 'POST') {
    const who = userFor(request);
    if (!who?.user) return send(request, response, 401, { error: 'Please sign in.' });
    const row = dataStore.get('monthly_report_preferences').find((r) => r.user_id === who.user.id);
    if (!row || row.enabled !== true) return send(request, response, 200, { ok: false, message: 'Turn on the monthly report first, then save.' });
    const used = Number(row.resend_count ?? 0);
    if (used >= 2) return send(request, response, 200, { ok: false, left: 0, message: 'This report was already sent again 2 times. If it still hasn\'t arrived, please contact the admin.' });
    if (!state.telegram.get(who.user.email) && row.verified_email !== String(row.recipient_email ?? '').toLowerCase()) return send(request, response, 200, { ok: false, left: 2 - used, message: 'There is nowhere to send it yet. Connect Telegram, or confirm your report email address.' });
    row.resend_count = used + 1;
    row.last_status = 'sent';
    return send(request, response, 200, { ok: true, channel: state.telegram.get(who.user.email) ? 'telegram' : 'email', left: 2 - used - 1, message: 'Your report is on its way. Please allow 15 minutes. If it still hasn\'t arrived, contact the admin.' });
  }
  if (path === '/functions/v1/delete-account' && request.method === 'POST') {
    const who = userFor(request);
    if (!who?.user) return send(request, response, 401, { error: 'Please sign in.' });
    for (const list of dataStore.values()) for (let i = list.length - 1; i >= 0; i -= 1) if (list[i].user_id === who.user.id) list.splice(i, 1);
    state.users.delete(who.user.email);
    for (const [token, entry] of state.tokens) if (entry.email === who.user.email) state.tokens.delete(token);
    for (const [token, entry] of state.refresh) if (entry.email === who.user.email) state.refresh.delete(token);
    return send(request, response, 200, { deleted: true });
  }
  if (path === '/__test/announcement') {
    const list = dataStore.get('announcements');
    for (const row of list) if (row.status === 'published' && (row.audience ?? []).some((e) => (body.audience ?? []).includes(e))) row.status = 'retired';
    const row = { id: body.id ?? uid(), title_en: body.titleEn, body_en: body.bodyEn, title_ms: body.titleMs ?? null, body_ms: body.bodyMs ?? null, title_zh: body.titleZh ?? null, body_zh: body.bodyZh ?? null, status: body.status ?? 'published', audience: (body.audience ?? []).map((e) => String(e).toLowerCase()), created_at: new Date().toISOString(), published_at: new Date().toISOString() };
    list.push(row);
    return send(request, response, 200, { ok: true, id: row.id });
  }
  if (path === '/__test/make-admin') { state.admins.add(String(body.email).toLowerCase()); return send(request, response, 200, { ok: true }); }
  if (path === '/functions/v1/admin-email-test' && request.method === 'POST') {
    const who = userFor(request);
    if (!who?.user) return send(request, response, 401, { error: 'Please sign in.' });
    const admin = state.admins.has(who.user.email);
    if (body.action === 'status') return send(request, response, 200, admin ? { admin: true, checks: { 'Email (Gmail SMTP)': true }, justCreated: false } : { admin: false });
    if (!admin) return send(request, response, 403, { error: 'You are not allowed to do this.' });
    return send(request, response, 200, { ok: true, sentTo: who.user.email, elapsedMs: 1200, checks: { 'Email (Gmail SMTP)': true } });
  }
  if (path === '/functions/v1/admin' && request.method === 'POST') {
    const who = userFor(request);
    if (!who?.user) return send(request, response, 401, { error: 'Please sign in.' });
    // checked on every call, here as on the real server
    if (!state.admins.has(who.user.email)) return send(request, response, 403, { error: 'You are not allowed to do this.' });
    const me = who.user;
    const byId = (id) => [...state.users.values()].find((u) => u.id === id);
    const audit = (action, detail) => state.audit.unshift({ id: state.audit.length + 1, admin_id: me.id, action, detail, created_at: new Date().toISOString() });
    const monthStartMs = monthStart(Date.now());
    const statusOf = (u) => (u.disabled ? 'disabled' : state.manual.has(u.email) ? 'blocked' : 'active');
    switch (body.action) {
      case 'list': {
        const search = String(body.search ?? '').toLowerCase();
        const status = String(body.status ?? '');
        const page = Math.max(1, Number(body.page) || 1);
        const all = [...state.users.values()];
        const matches = all.filter((u) => !search || u.email.includes(search) || String(u.name).toLowerCase().includes(search)).filter((u) => !status || statusOf(u) === status).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
        const slice = matches.slice((page - 1) * 25, page * 25);
        return send(request, response, 200, {
          ok: true, total: matches.length, page, pages: Math.max(1, Math.ceil(matches.length / 25)),
          counts: { all: all.length, disabled: all.filter((u) => statusOf(u) === 'disabled').length, blocked: all.filter((u) => statusOf(u) === 'blocked').length },
          users: slice.map((u) => {
            const used = state.codeLog.filter((c) => c.email === u.email && c.t >= monthStartMs).length;
            const last = dataStore.get('expenses').filter((r) => r.user_id === u.id).map((r) => r.created_at).sort().pop() ?? null;
            // a date and nothing else: never an amount, a merchant or a note
            return { id: u.id, email: u.email, name: u.name, provider: u.provider, createdAt: u.created_at, lastSignInAt: null, lastExpenseAt: last, telegram: Boolean(state.telegram.get(u.email)), authenticator: u.factors.some((f) => f.status === 'verified'), status: statusOf(u), block: state.manual.has(u.email) ? { manual: true, until: null } : null, codesThisMonth: used, codeLimited: used >= 10, isAdmin: state.admins.has(u.email), isYou: u.id === me.id };
          }),
        });
      }
      case 'disable': case 'enable': {
        const u = byId(body.userId);
        if (!u) return send(request, response, 200, { ok: false, message: 'That account was not found.' });
        if (body.action === 'disable' && u.id === me.id) return send(request, response, 200, { ok: false, message: 'You can\'t disable your own account.' });
        if (body.action === 'disable' && state.admins.has(u.email)) return send(request, response, 200, { ok: false, message: 'An administrator account can\'t be disabled.' });
        u.disabled = body.action === 'disable';
        audit(body.action === 'disable' ? 'disable_account' : 'enable_account', u.email);
        return send(request, response, 200, { ok: true, message: u.disabled ? 'Account disabled. They can no longer sign in.' : 'Account enabled.' });
      }
      case 'block': case 'unblock': {
        const u = byId(body.userId);
        if (!u) return send(request, response, 200, { ok: false, message: 'That account was not found.' });
        if (body.action === 'block' && u.id === me.id) return send(request, response, 200, { ok: false, message: 'You can\'t block your own account.' });
        if (body.action === 'block') state.manual.add(u.email); else state.manual.delete(u.email);
        audit(body.action === 'block' ? 'block_signin' : 'unblock_signin', u.email);
        return send(request, response, 200, { ok: true, message: body.action === 'block' ? 'Sign-in is blocked for this account until you unblock it.' : 'Unblocked. They can sign in again.' });
      }
      case 'clear_codes': {
        const u = byId(body.userId);
        if (!u) return send(request, response, 200, { ok: false, message: 'That account was not found.' });
        state.codeLog = state.codeLog.filter((c) => !(c.email === u.email && c.t >= monthStartMs));
        audit('clear_code_limit', u.email);
        return send(request, response, 200, { ok: true, message: 'Code limit cleared. They can ask for codes again.' });
      }
      case 'send_reset': {
        const u = byId(body.userId);
        if (!u) return send(request, response, 200, { ok: false, message: 'That account was not found.' });
        state.mail.push({ email: u.email, kind: 'admin-reset', at: Date.now() }); // the code goes to their inbox, never to the admin
        audit('send_password_reset', u.email);
        return send(request, response, 200, { ok: true, message: `A password-reset code was emailed to ${u.email}.` });
      }
      case 'reset_authenticator': {
        const u = byId(body.userId);
        if (!u) return send(request, response, 200, { ok: false, message: 'That account was not found.' });
        u.factors = [];
        audit('reset_authenticator', u.email);
        return send(request, response, 200, { ok: true, message: 'Authenticator turned off. They can sign in with their password and set it up again.' });
      }
      case 'resend_report': {
        const u = byId(body.userId);
        if (!u) return send(request, response, 200, { ok: false, message: 'That account was not found.' });
        if (!/^\d{4}-\d{2}$/.test(String(body.month ?? ''))) return send(request, response, 200, { ok: false, message: 'Choose a finished month from the last 12 months.' });
        if (!state.telegram.get(u.email)) return send(request, response, 200, { ok: false, message: 'This person has no Telegram link and no confirmed report email, so there is nowhere to send it.' });
        audit('resend_report', `${u.email} ${body.month}`);
        return send(request, response, 200, { ok: true, message: `The ${body.month} report was sent to this person by telegram.` });
      }
      case 'feedback_list': {
        const wanted = body.status === 'resolved' ? 'resolved' : 'open';
        return send(request, response, 200, { ok: true, items: state.feedback.filter((f) => f.status === wanted).sort((a, b) => b.id - a.id) });
      }
      case 'feedback_resolve': {
        const f = state.feedback.find((x) => x.id === Number(body.id));
        if (!f) return send(request, response, 200, { ok: false, message: 'That message was not found.' });
        f.status = body.resolved === false ? 'open' : 'resolved';
        audit(body.resolved === false ? 'reopen_feedback' : 'resolve_feedback', `feedback ${f.id}`);
        return send(request, response, 200, { ok: true });
      }
      case 'scan_stats': return send(request, response, 200, { ok: true, total: 8, worked: 6, successPercent: 75, medianMs: 1200, p90Ms: 3100, failures: [{ reason: 'busy', count: 2 }], byEngine: [{ engine: 'ocr.space', total: 8, ok: 6 }] });
      case 'health': return send(request, response, 200, { ok: true, checks: { 'Email (Gmail SMTP)': true, 'Telegram bot': true, 'Scheduled jobs secret': false, 'Allowed website list': true, 'Database is up to date': true }, openFeedback: state.feedback.filter((f) => f.status === 'open').length });
      case 'announcement_state': case 'announcement_save': case 'announcement_publish': case 'announcement_retire': {
        // the same rules as the real function, but an announcement belongs to the administrator who made it (test isolation only)
        const list = dataStore.get('announcements');
        const mineRows = list.filter((r) => (r.audience ?? []).includes(me.email));
        const live = mineRows.find((r) => r.status === 'published') ?? null;
        const draft = mineRows.find((r) => r.status === 'draft') ?? null;
        if (body.action === 'announcement_state') {
          const reads = live ? dataStore.get('announcement_reads').filter((r) => r.announcement_id === live.id).length : 0;
          return send(request, response, 200, { ok: true, published: live, draft, reads });
        }
        if (body.action === 'announcement_retire') {
          if (live) live.status = 'retired';
          audit('retire_announcement', '');
          return send(request, response, 200, { ok: true, message: 'The announcement was switched off.' });
        }
        const clean = (v) => (typeof v === 'string' ? [...v.split('\r\n').join('\n')].filter((ch) => { const c = ch.charCodeAt(0); return c === 10 || (c >= 32 && c !== 127); }).join('').trim() : '');
        const part = (name) => ({ title: clean(body['title' + name]), body: clean(body['body' + name]) });
        const en = part('En'), ms = part('Ms'), zh = part('Zh');
        for (const [label, x] of [['English', en], ['Malay', ms], ['Chinese', zh]]) {
          if (x.title.length > 80) return send(request, response, 200, { ok: false, message: label + ' title is too long (at most 80 characters).' });
          if (x.body.length > 1500) return send(request, response, 200, { ok: false, message: label + ' message is too long (at most 1500 characters).' });
        }
        const publish = body.action === 'announcement_publish';
        if (publish && (!en.title || !en.body)) return send(request, response, 200, { ok: false, message: 'The English title and message are required.' });
        const both = (x) => (x.title && x.body ? x : null);
        const fields = { title_en: en.title || '(untitled)', body_en: en.body || '(empty)', title_ms: both(ms)?.title ?? null, body_ms: both(ms)?.body ?? null, title_zh: both(zh)?.title ?? null, body_zh: both(zh)?.body ?? null };
        if (!publish) {
          if (draft) Object.assign(draft, fields);
          else list.push({ id: uid(), ...fields, status: 'draft', audience: [me.email], created_at: new Date().toISOString(), published_at: null });
          audit('save_announcement_draft', fields.title_en);
          return send(request, response, 200, { ok: true, message: 'Draft saved.' });
        }
        if (live) live.status = 'retired';
        if (draft) list.splice(list.indexOf(draft), 1);
        list.push({ id: uid(), ...fields, status: 'published', audience: [me.email], created_at: new Date().toISOString(), published_at: new Date().toISOString() });
        audit('publish_announcement', fields.title_en);
        return send(request, response, 200, { ok: true, message: 'Published. People who open or refresh the app from now on will see it.' });
      }
      case 'log': return send(request, response, 200, { ok: true, items: state.audit.slice(0, 50) });
      default: return send(request, response, 400, { error: 'Unknown action.' });
    }
  }
  // the page behind the links in our emails: a token starting "good" works, "used" has been used already, "down" fails
  if (path === '/functions/v1/email-action' && request.method === 'POST') {
    state.emailActionCalls = (state.emailActionCalls ?? 0) + 1;
    const token = String(body.token ?? '');
    if (token.startsWith('down')) return send(request, response, 503, { ok: false, message: 'This service is not set up yet.' });
    if (!token.startsWith('good')) return send(request, response, 200, { ok: false, message: 'This link is invalid or has expired. Request a new one from the app.' });
    return send(request, response, 200, body.action === 'confirm' ? { ok: true, message: 'Thank you. This address is confirmed and monthly reports can be sent to it.' } : { ok: true, message: 'You are unsubscribed. No more ManaDuit reports will be sent to this address.' });
  }
  if (path === '/__test/email-action-calls') return send(request, response, 200, { calls: state.emailActionCalls ?? 0 });
  if (path === '/functions/v1/feedback' && request.method === 'POST') return send(request, response, 200, feedback(body, request));

  const restMatch = /^\/rest\/v1\/([a-z_]+)$/.exec(path);
  if (restMatch) return rest(request, response, url, restMatch[1], body);

  // Auth API
  if (path === '/auth/v1/user' && request.method === 'GET') {
    const who = userFor(request);
    return who?.user ? send(request, response, 200, publicUser(who.user)) : send(request, response, 401, { code: 401, msg: 'invalid JWT' });
  }
  if (path === '/auth/v1/user' && request.method === 'PUT') {
    const who = userFor(request);
    if (!who?.user) return send(request, response, 401, { code: 401, msg: 'invalid JWT' });
    if (body.password) {
      if (body.password === who.user.password) return send(request, response, 422, { code: 422, error_code: 'same_password', msg: 'New password should be different from the old password.' });
      who.user.password = body.password;
    }
    if (body.data?.username) who.user.name = body.data.username;
    if (body.data) who.user.meta = { ...(who.user.meta ?? {}), ...Object.fromEntries(Object.entries(body.data).filter(([k]) => k !== 'username')) };
    return send(request, response, 200, publicUser(who.user));
  }
  if (path === '/auth/v1/token' && request.method === 'POST') {
    const entry = state.refresh.get(body.refresh_token);
    const user = entry && state.users.get(entry.email);
    return user ? send(request, response, 200, makeSession(user, entry.aal)) : send(request, response, 400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token' });
  }
  if (path === '/auth/v1/logout') return send(request, response, 204);
  if (path === '/auth/v1/factors' && request.method === 'POST') {
    const who = userFor(request);
    if (!who?.user) return send(request, response, 401, { msg: 'invalid JWT' });
    const factor = { id: `f-${uid()}`, status: 'unverified', factor_type: 'totp', friendly_name: body.friendly_name ?? 'ManaDuit' };
    who.user.factors.push(factor);
    const svg = encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 8 8"><rect width="8" height="8" fill="#fff"/><path d="M0 0h3v3H0zM5 0h3v3H5zM0 5h3v3H0zM4 4h1v1H4zM6 5h2v1H6zM5 7h1v1H5z" fill="#000"/></svg>');
    return send(request, response, 200, { id: factor.id, type: 'totp', friendly_name: factor.friendly_name, totp: { qr_code: `data:image/svg+xml;utf-8,${svg}`, secret: 'JBSWY3DPEHPK3PXP', uri: 'otpauth://totp/VinExpenses' } });
  }
  const factorRoute = /^\/auth\/v1\/factors\/([^/]+)(?:\/(challenge|verify))?$/.exec(path);
  if (factorRoute) {
    const who = userFor(request);
    if (!who?.user) return send(request, response, 401, { msg: 'invalid JWT' });
    const factor = who.user.factors.find((f) => f.id === factorRoute[1]);
    if (!factor) return send(request, response, 404, { msg: 'Factor not found' });
    if (request.method === 'DELETE') { who.user.factors = who.user.factors.filter((f) => f.id !== factor.id); return send(request, response, 200, { id: factor.id }); }
    if (factorRoute[2] === 'challenge') return send(request, response, 200, { id: `ch-${uid()}`, type: 'totp', expires_at: Math.floor(Date.now() / 1000) + 300 });
    if (factorRoute[2] === 'verify') {
      if (String(body.code) !== '654321') return send(request, response, 400, { code: 400, error_code: 'mfa_verification_failed', msg: 'Invalid TOTP code entered' });
      factor.status = 'verified';
      return send(request, response, 200, makeSession(who.user, 'aal2'));
    }
  }
  send(request, response, 404, { error: 'not found', path });
}).listen(PORT, '127.0.0.1', () => console.log(`fake backend on http://127.0.0.1:${PORT}`));
