// The front door for sign-up, sign-in and password reset. It adds what the sign-in service does not do on the free plan: code limits, lockouts and recovery codes.

import { callerKey, env, json, preflight, projectAccess, requireUser, sha256Hex, takeQuota } from "../_shared/guard.ts";
import { q, rest } from "../_shared/db.ts";
import { checkPassword, cleanEmail, cleanName, cleanRecoveryCode, isCode, isDeviceId, LIMITS, newRecoveryCode, periods } from "../_shared/auth-rules.ts";

type Body = Record<string, unknown>;
type Reply = Record<string, unknown>;
const HOUR_MS = 3600_000;
const GENERIC = "Something went wrong. Please try again in a moment.";

// Sign-in Service Section: calls to Supabase Auth
async function authCall(path: string, init: { method?: string; body?: unknown; token?: string; admin?: boolean } = {}): Promise<{ status: number; data: Record<string, unknown> }> {
  const access = projectAccess();
  if (!access) throw new Error("not configured");
  const key = init.admin ? access.serviceKey : (env("SUPABASE_ANON_KEY") ?? access.serviceKey);
  const response = await fetch(`${access.url}/auth/v1/${path}`, {
    method: init.method ?? "POST",
    headers: { apikey: key, Authorization: `Bearer ${init.token ?? key}`, "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(12_000),
  });
  let data: Record<string, unknown> = {};
  try { data = await response.json(); } catch (_error) { /* an empty answer is fine */ }
  return { status: response.status, data: data && typeof data === "object" ? data : {} };
}

const errorText = (data: Record<string, unknown>) => `${data.error_code ?? ""} ${data.code ?? ""} ${data.msg ?? ""} ${data.message ?? ""} ${data.error_description ?? ""} ${data.error ?? ""}`.toLowerCase();
const captcha = (body: Body) => (typeof body.captcha === "string" && body.captcha.length <= 4000 ? { gotrue_meta_security: { captcha_token: body.captcha } } : {});

function sessionOf(data: Record<string, unknown>): Reply | null {
  if (typeof data.access_token !== "string" || typeof data.refresh_token !== "string") return null;
  const user = (data.user ?? {}) as Record<string, unknown>;
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    user: { id: user.id, email: user.email, user_metadata: user.user_metadata ?? {} },
  };
}

// Code Limits Section: 3 a day and 10 a month per email
async function reserveCode(email: string, purpose: "signup" | "recovery", now: Date): Promise<{ id: number | null } | { limit: "day" | "month"; retryAt?: string }> {
  const p = periods(now);
  const created = await rest("auth_code_requests", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ email, purpose, sent_at: now.toISOString() }) });
  if (!created.ok) {
    const detail = await created.text().catch(() => "");
    // The database has not been updated yet: keep sign-up working, without limits, and say so in the logs.
    if (created.status === 404 || /does not exist|could not find the table|PGRST205|42P01/i.test(detail)) {
      console.warn("auth-gate: auth_code_requests is missing. Run supabase-schema.sql to enforce code limits.");
      return { id: null };
    }
    throw new Error(`code counter ${created.status}`);
  }
  const id = Number(((await created.json()) as { id: number }[])[0]?.id);
  const count = async (since: string) => {
    const response = await rest(`auth_code_requests?select=id&email=eq.${q(email)}&sent_at=gte.${q(since)}&limit=50`);
    if (!response.ok) throw new Error(`code count ${response.status}`);
    return ((await response.json()) as unknown[]).length;
  };
  const [month, day] = [await count(p.monthStart), await count(p.dayStart)];
  if (month > LIMITS.codesPerMonth || day > LIMITS.codesPerDay) {
    await releaseCode(id);
    return month > LIMITS.codesPerMonth ? { limit: "month" } : { limit: "day", retryAt: p.dayEnd };
  }
  return { id };
}
const releaseCode = (id: number | null) =>
  id === null ? Promise.resolve() : rest(`auth_code_requests?id=eq.${id}`, { method: "DELETE", headers: { Prefer: "return=minimal" } }).then(() => undefined).catch(() => undefined);

const limitReply = (r: { limit: "day" | "month"; retryAt?: string }): Reply => r.limit === "month"
  ? { ok: false, code: "code_limit_month", message: `You have asked for ${LIMITS.codesPerMonth} codes this month, which is the limit. Please contact the admin to continue.` }
  : { ok: false, code: "code_limit_day", retryAt: r.retryAt, message: `You can ask for ${LIMITS.codesPerDay} codes a day. Please try again tomorrow, or contact the admin.` };

// Lockout Section: 5 wrong passwords on one device, or 20 across devices, pauses sign-in for 3 hours
interface Lock { email: string; device_id: string; blocked_at: string | null; manual: boolean }
async function blockedUntil(email: string, device: string, now: Date): Promise<{ until: string | null; manual: boolean } | null> {
  const response = await rest(`auth_lockouts?select=email,device_id,blocked_at,manual&email=eq.${q(email)}`);
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    if (response.status === 404 || /does not exist|could not find the table|PGRST205|42P01/i.test(detail)) {
      console.warn("auth-gate: auth_lockouts is missing. Run supabase-schema.sql to enforce lockouts.");
      return null;
    }
    throw new Error(`lockout lookup ${response.status}`);
  }
  let until = 0;
  for (const row of (await response.json()) as Lock[]) {
    if (row.device_id !== device && row.device_id !== "*") continue;
    if (!row.blocked_at) continue;
    if (row.manual) return { until: null, manual: true }; // blocked by an admin: no end time
    const end = Date.parse(row.blocked_at) + LIMITS.blockHours * HOUR_MS;
    if (end > now.getTime()) until = Math.max(until, end);
  }
  return until ? { until: new Date(until).toISOString(), manual: false } : null;
}

async function recordFailure(email: string, device: string): Promise<boolean> {
  const response = await rest("rpc/record_signin_failure", {
    method: "POST",
    body: JSON.stringify({ p_email: email, p_device: device, p_max: LIMITS.failsPerDevice, p_email_max: LIMITS.failsPerEmail, p_hours: LIMITS.blockHours }),
  });
  if (!response.ok) { console.warn("auth-gate: record_signin_failure unavailable, status", response.status); return false; }
  return (await response.json()) !== null;
}

const clearLockouts = (email: string, device?: string) =>
  rest(`auth_lockouts?email=eq.${q(email)}&manual=eq.false${device ? `&device_id=eq.${q(device)}` : ""}`, { method: "DELETE", headers: { Prefer: "return=minimal" } }).then(() => undefined).catch(() => undefined);

const blockedReply = (lock: { until: string | null; manual: boolean }): Reply => lock.manual
  ? { ok: false, code: "blocked", manual: true, message: "Sign-in for this account has been paused by the admin. Please contact the admin." }
  : { ok: false, code: "blocked", until: lock.until, message: "Too many wrong attempts. Sign-in is paused for a while. You can reset your password, or contact the admin." };

// Checks the password with the sign-in service and applies the lockout. Returns a session or a ready reply.
async function passwordSignIn(email: string, password: string, device: string, body: Body, request: Request, now: Date): Promise<{ session: Reply; userId: string } | { reply: Reply }> {
  const ip = await callerKey(request);
  if (ip && !(await takeQuota(`signin-ip:${ip}:${periods(now).hourKey}`, LIMITS.ipSignInsPerHour))) {
    return { reply: { ok: false, code: "slow_down", message: "Too many sign-in attempts from this network. Please wait an hour and try again." } };
  }
  const lock = await blockedUntil(email, device, now);
  if (lock) return { reply: blockedReply(lock) };

  const { status, data } = await authCall("token?grant_type=password", { body: { email, password, ...captcha(body) } });
  const session = status === 200 ? sessionOf(data) : null;
  if (session) {
    await clearLockouts(email, device);
    return { session, userId: String((data.user as Record<string, unknown>)?.id ?? "") };
  }
  const text = errorText(data);
  if (/captcha/.test(text)) return { reply: { ok: false, code: "captcha", message: "The security check did not pass. Please try again." } };
  if (/not confirmed|email_not_confirmed/.test(text)) return { reply: { ok: false, code: "unconfirmed", message: "This email is not verified yet. Enter the code we emailed you." } };
  if (/banned/.test(text)) return { reply: { ok: false, code: "disabled", message: "This account has been disabled. Please contact the admin." } };
  if (status === 429) return { reply: { ok: false, code: "slow_down", message: "Too many attempts. Please wait a minute and try again." } };
  if (status >= 500) throw new Error(`sign-in service ${status}`);
  const nowBlocked = await recordFailure(email, device);
  return { reply: nowBlocked ? blockedReply({ until: new Date(now.getTime() + LIMITS.blockHours * HOUR_MS).toISOString(), manual: false })
    : { ok: false, code: "invalid", message: `Wrong email or password. After ${LIMITS.failsPerDevice} wrong tries, sign-in on this device is paused for ${LIMITS.blockHours} hours.` } };
}

const codeChecksLeft = async (email: string, now: Date) => takeQuota(`otp-check:${(await sha256Hex(email)).slice(0, 24)}:${periods(now).hourKey}`, LIMITS.codeChecksPerHour);
const BAD_CODE: Reply = { ok: false, code: "bad_code", message: `That code is not right or has expired. Codes work once and last ${LIMITS.codeMinutes} minutes.` };
const TOO_MANY_CHECKS: Reply = { ok: false, code: "slow_down", message: "Too many wrong codes. Please wait an hour, then ask for a new code." };

// Actions Section
async function signUp(body: Body, now: Date): Promise<Reply> {
  const email = cleanEmail(body.email);
  const name = cleanName(body.name);
  const password = String(body.password ?? "");
  if (!email) return { ok: false, code: "bad_email", message: "Enter a valid email address." };
  if (!name) return { ok: false, code: "bad_name", message: "Enter a name of 2 to 40 characters." };
  if (!checkPassword(password).ok) return { ok: false, code: "weak_password", message: "The password does not meet every rule shown under the field." };

  const reserved = await reserveCode(email, "signup", now);
  if ("limit" in reserved) return limitReply(reserved);
  let result;
  try {
    result = await authCall("signup", { body: { email, password, data: { username: name, setup_complete: true }, ...captcha(body) } });
  } catch (error) {
    await releaseCode(reserved.id);
    throw error;
  }
  const { status, data } = result;
  const text = errorText(data);
  const user = (data.user ?? data) as Record<string, unknown>;
  // The sign-in service answers with an empty identity list when the address already has an account.
  if (/already registered|user_already_exists/.test(text) || (status === 200 && Array.isArray(user.identities) && user.identities.length === 0)) {
    await releaseCode(reserved.id);
    return { ok: false, code: "exists", message: "This email already has an account. Please sign in instead." };
  }
  if (status !== 200) {
    await releaseCode(reserved.id);
    if (/captcha/.test(text)) return { ok: false, code: "captcha", message: "The security check did not pass. Please try again." };
    if (/weak|password/.test(text)) return { ok: false, code: "weak_password", message: "Please choose a stronger password." };
    if (status === 429 || /rate limit/.test(text)) return { ok: false, code: "slow_down", message: "Too many emails were requested. Please wait a few minutes and try again." };
    throw new Error(`signup ${status}`);
  }
  const session = sessionOf(data);
  if (session) { await releaseCode(reserved.id); return { ok: true, step: "done", session }; } // email confirmation is switched off in the project
  return { ok: true, step: "verify", minutes: LIMITS.codeMinutes };
}

async function resendSignUp(body: Body, now: Date): Promise<Reply> {
  const email = cleanEmail(body.email);
  if (!email) return { ok: false, code: "bad_email", message: "Enter a valid email address." };
  const reserved = await reserveCode(email, "signup", now);
  if ("limit" in reserved) return limitReply(reserved);
  try {
    const { status, data } = await authCall("resend", { body: { type: "signup", email, ...captcha(body) } });
    if (status !== 200) {
      await releaseCode(reserved.id);
      if (/captcha/.test(errorText(data))) return { ok: false, code: "captcha", message: "The security check did not pass. Please try again." };
      if (status === 429) return { ok: false, code: "slow_down", message: "Please wait a minute before asking for another code." };
      throw new Error(`resend ${status}`);
    }
  } catch (error) {
    await releaseCode(reserved.id);
    throw error;
  }
  return { ok: true, minutes: LIMITS.codeMinutes };
}

async function verifySignUp(body: Body, now: Date): Promise<Reply> {
  const email = cleanEmail(body.email);
  if (!email || !isCode(body.code)) return BAD_CODE;
  if (!(await codeChecksLeft(email, now))) return TOO_MANY_CHECKS;
  const { status, data } = await authCall("verify", { body: { type: "signup", email, token: String(body.code).trim() } });
  const session = status === 200 ? sessionOf(data) : null;
  if (!session) { if (status >= 500) throw new Error(`verify ${status}`); return BAD_CODE; }
  return { ok: true, session };
}

async function signIn(body: Body, request: Request, now: Date): Promise<Reply> {
  const email = cleanEmail(body.email);
  const password = String(body.password ?? "");
  if (!email || !password || password.length > 200 || !isDeviceId(body.device)) return { ok: false, code: "invalid", message: "Wrong email or password." };
  const result = await passwordSignIn(email, password, String(body.device), body, request, now);
  return "reply" in result ? result.reply : { ok: true, session: result.session };
}

async function startRecovery(body: Body, now: Date): Promise<Reply> {
  const email = cleanEmail(body.email);
  if (!email) return { ok: false, code: "bad_email", message: "Enter a valid email address." };
  const reserved = await reserveCode(email, "recovery", now);
  if ("limit" in reserved) return limitReply(reserved);
  try {
    const { status, data } = await authCall("recover", { body: { email, ...captcha(body) } });
    if (status !== 200) {
      await releaseCode(reserved.id);
      if (/captcha/.test(errorText(data))) return { ok: false, code: "captcha", message: "The security check did not pass. Please try again." };
      if (status >= 500) throw new Error(`recover ${status}`);
    }
  } catch (error) {
    await releaseCode(reserved.id);
    throw error;
  }
  // The same answer whether or not the address has an account, so this can not be used to find accounts.
  return { ok: true, minutes: LIMITS.codeMinutes };
}

async function resetPassword(body: Body, now: Date): Promise<Reply> {
  const email = cleanEmail(body.email);
  const password = String(body.password ?? "");
  if (!email || !isCode(body.code)) return BAD_CODE;
  if (!checkPassword(password).ok) return { ok: false, code: "weak_password", message: "The password does not meet every rule shown under the field." };
  if (!(await codeChecksLeft(email, now))) return TOO_MANY_CHECKS;

  const verified = await authCall("verify", { body: { type: "recovery", email, token: String(body.code).trim() } });
  const token = verified.status === 200 && typeof verified.data.access_token === "string" ? verified.data.access_token : "";
  if (!token) { if (verified.status >= 500) throw new Error(`verify ${verified.status}`); return BAD_CODE; }

  const changed = await authCall("user", { method: "PUT", token, body: { password } });
  if (changed.status !== 200) {
    const text = errorText(changed.data);
    if (/same|different from the old/.test(text)) return { ok: false, code: "same_password", message: "Choose a password you have not used on this account. Ask for a new code to try again." };
    if (/weak|password/.test(text)) return { ok: false, code: "weak_password", message: "Please choose a stronger password. Ask for a new code to try again." };
    throw new Error(`password change ${changed.status}`);
  }
  // Every device is signed out, and the wrong-password count starts again.
  await authCall("logout?scope=global", { token }).catch(() => undefined);
  await clearLockouts(email);
  return { ok: true };
}

const hashRecovery = (userId: string, code: string) => sha256Hex(`recovery:${userId}:${code}`);

// Lost authenticator: password plus a one-time recovery code turns the authenticator off.
async function recoverMfa(body: Body, request: Request, now: Date): Promise<Reply> {
  const email = cleanEmail(body.email);
  const password = String(body.password ?? "");
  const code = cleanRecoveryCode(body.code);
  if (!email || !password || !isDeviceId(body.device) || !code) return { ok: false, code: "invalid", message: "That recovery code is not right." };
  const result = await passwordSignIn(email, password, String(body.device), body, request, now);
  if ("reply" in result) return result.reply;

  const hash = await hashRecovery(result.userId, code);
  const used = await rest(`mfa_recovery_codes?user_id=eq.${q(result.userId)}&code_hash=eq.${hash}&used_at=is.null`, {
    method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ used_at: now.toISOString() }),
  });
  if (!used.ok || ((await used.json()) as unknown[]).length !== 1) {
    const nowBlocked = await recordFailure(email, String(body.device));
    return nowBlocked ? blockedReply({ until: new Date(now.getTime() + LIMITS.blockHours * HOUR_MS).toISOString(), manual: false })
      : { ok: false, code: "invalid", message: "That recovery code is not right, or it was already used." };
  }
  const removed = await removeFactors(result.userId);
  if (!removed) return { ok: false, code: "failed", message: "The code was accepted but the authenticator could not be turned off. Please contact the admin." };
  await rest(`mfa_recovery_codes?user_id=eq.${q(result.userId)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } }).catch(() => undefined);
  return { ok: true, session: result.session, authenticatorOff: true };
}

/** Removes every authenticator of one person. Used by recovery codes and by the admin reset. */
export async function removeFactors(userId: string): Promise<boolean> {
  const listed = await authCall(`admin/users/${encodeURIComponent(userId)}/factors`, { method: "GET", admin: true });
  if (listed.status !== 200) return false;
  const factors = (Array.isArray(listed.data) ? listed.data : (listed.data.factors ?? Object.values(listed.data))) as { id?: string }[];
  let ok = true;
  for (const factor of factors) {
    if (!factor?.id) continue;
    const gone = await authCall(`admin/users/${encodeURIComponent(userId)}/factors/${encodeURIComponent(factor.id)}`, { method: "DELETE", admin: true });
    if (gone.status !== 200 && gone.status !== 204) ok = false;
  }
  return ok;
}

// Signed-in, with the authenticator already confirmed: makes 8 new recovery codes and shows them once.
async function newRecoveryCodes(request: Request): Promise<Reply | Response> {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;
  if (!auth.hasMfa || auth.aal !== "aal2") return { ok: false, code: "no_authenticator", message: "Turn on an authenticator first." };
  if (!(await takeQuota(`recovery-codes:${auth.userId}`, 5))) return { ok: false, code: "slow_down", message: "New recovery codes can be made 5 times a day." };
  const codes = Array.from({ length: 8 }, () => newRecoveryCode());
  const rows = await Promise.all(codes.map(async (code) => ({ user_id: auth.userId, code_hash: await hashRecovery(auth.userId, code) })));
  const cleared = await rest(`mfa_recovery_codes?user_id=eq.${q(auth.userId)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  const saved = cleared.ok ? await rest("mfa_recovery_codes", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(rows) }) : cleared;
  if (!saved.ok) return { ok: false, code: "failed", message: "Recovery codes could not be saved. Has supabase-schema.sql been run?" };
  return { ok: true, codes };
}

// The Door Section
export async function handle(request: Request, now = new Date()): Promise<Response> {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== "POST") return json(request, { error: "Use POST." }, 405);
  // Sign-in is only ever done from the website: a call without an Origin header is not a browser.
  if (!request.headers.get("origin")) return json(request, { error: "This website is not allowed to use this service." }, 403);
  if (!projectAccess()) return json(request, { error: "Server is not configured." }, 503);

  let body: Body;
  try {
    body = await request.json();
    if (!body || typeof body !== "object") throw new Error("bad");
  } catch (_error) {
    return json(request, { error: "Bad request." }, 400);
  }

  try {
    let reply: Reply | Response;
    switch (body.action) {
      case "signup": reply = await signUp(body, now); break;
      case "signup_resend": reply = await resendSignUp(body, now); break;
      case "signup_verify": reply = await verifySignUp(body, now); break;
      case "signin": reply = await signIn(body, request, now); break;
      case "recover": reply = await startRecovery(body, now); break;
      case "reset": reply = await resetPassword(body, now); break;
      case "mfa_recover": reply = await recoverMfa(body, request, now); break;
      case "recovery_codes": reply = await newRecoveryCodes(request); break;
      default: return json(request, { error: "Bad request." }, 400);
    }
    return reply instanceof Response ? reply : json(request, reply);
  } catch (error) {
    // If a limit or the sign-in service can't be reached the request is refused, never waved through.
    console.error("auth-gate:", String(body.action), error instanceof Error ? error.message : "unknown");
    return json(request, { error: GENERIC }, 503);
  }
}
