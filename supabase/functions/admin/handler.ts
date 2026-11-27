// The admin dashboard's server side: manage accounts, unblock people, resend a report, read feedback. It never returns anyone's expenses.

import { env, json, preflight, projectAccess, requireUser, takeQuota } from "../_shared/guard.ts";
import { q, rest } from "../_shared/db.ts";
import { summariseScans } from "../_shared/scan-log.ts";
import { audit, isAdmin } from "../_shared/admin.ts";
import { LIMITS, periods } from "../_shared/auth-rules.ts";
import { loadEmailSetup } from "../_shared/email-setup.ts";
import { authTemplates, escapeHtml } from "../_shared/email-templates.ts";
import { sendEmail } from "../_shared/mailer.ts";
import { deliverReport, periodOf, recordDelivery } from "../_shared/report-delivery.ts";
import { type Connector, denoConnector } from "../_shared/smtp.ts";
import { type TelegramClient, telegramClient } from "../_shared/telegram.ts";
import { removeFactors } from "../auth-gate/handler.ts";

type Body = Record<string, unknown>;
type Reply = Record<string, unknown>;
const PAGE = 25;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FOREVER = "876000h"; // about 100 years: how the sign-in service spells "disabled"

interface AuthUser {
  id: string; email?: string; created_at?: string; last_sign_in_at?: string | null; banned_until?: string | null;
  user_metadata?: { username?: string }; factors?: { status?: string }[]; app_metadata?: { provider?: string };
}

async function authAdmin(path: string, init: { method?: string; body?: unknown } = {}): Promise<{ status: number; data: unknown }> {
  const access = projectAccess();
  if (!access) throw new Error("not configured");
  const response = await fetch(`${access.url}/auth/v1/${path}`, {
    method: init.method ?? "GET",
    headers: { apikey: access.serviceKey, Authorization: `Bearer ${access.serviceKey}`, "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(12_000),
  });
  let data: unknown = {};
  try { data = await response.json(); } catch (_error) { /* empty answer */ }
  return { status: response.status, data };
}

async function allUsers(): Promise<AuthUser[]> {
  const users: AuthUser[] = [];
  for (let page = 1; page <= 10; page++) { // up to 2,000 accounts
    const { status, data } = await authAdmin(`admin/users?page=${page}&per_page=200`);
    if (status !== 200) throw new Error(`user list ${status}`);
    const batch = ((data as { users?: AuthUser[] }).users ?? []) as AuthUser[];
    users.push(...batch);
    if (batch.length < 200) break;
  }
  return users;
}

async function oneUser(userId: unknown): Promise<AuthUser | null> {
  if (typeof userId !== "string" || !UUID.test(userId)) return null;
  const { status, data } = await authAdmin(`admin/users/${userId}`);
  return status === 200 && (data as AuthUser)?.id ? (data as AuthUser) : null;
}

const isDisabled = (user: AuthUser, now: Date) => !!user.banned_until && Date.parse(user.banned_until) > now.getTime();

interface Lock { email: string; device_id: string; blocked_at: string | null; manual: boolean }
/** email -> block state. A device-only block is not listed: the person can still sign in elsewhere. */
async function blocks(now: Date): Promise<Map<string, { manual: boolean; until: string | null }>> {
  const map = new Map<string, { manual: boolean; until: string | null }>();
  const response = await rest("auth_lockouts?select=email,device_id,blocked_at,manual&blocked_at=not.is.null&limit=1000");
  if (!response.ok) return map; // older database: nobody is shown as blocked
  for (const row of (await response.json()) as Lock[]) {
    if (!row.blocked_at) continue;
    const end = Date.parse(row.blocked_at) + LIMITS.blockHours * 3600_000;
    if (row.manual) map.set(row.email, { manual: true, until: null });
    else if (end > now.getTime() && !map.get(row.email)?.manual) {
      const current = map.get(row.email);
      if (!current || (current.until && Date.parse(current.until) < end)) map.set(row.email, { manual: false, until: new Date(end).toISOString() });
    }
  }
  return map;
}

async function codeCounts(now: Date): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const response = await rest(`auth_code_requests?select=email&sent_at=gte.${q(periods(now).monthStart)}&limit=5000`);
  if (!response.ok) return map;
  for (const row of (await response.json()) as { email: string }[]) map.set(row.email, (map.get(row.email) ?? 0) + 1);
  return map;
}

// Actions Section
async function list(body: Body, adminId: string, now: Date): Promise<Reply> {
  const search = String(body.search ?? "").trim().toLowerCase().slice(0, 100);
  const status = ["active", "disabled", "blocked"].includes(String(body.status)) ? String(body.status) : "";
  const page = Math.max(1, Math.floor(Number(body.page) || 1));
  const [users, blocked, codes] = await Promise.all([allUsers(), blocks(now), codeCounts(now)]);

  const statusOf = (user: AuthUser) => isDisabled(user, now) ? "disabled" : blocked.has(String(user.email ?? "").toLowerCase()) ? "blocked" : "active";
  const matches = users
    .filter((user) => !search || String(user.email ?? "").toLowerCase().includes(search) || String(user.user_metadata?.username ?? "").toLowerCase().includes(search))
    .filter((user) => !status || statusOf(user) === status)
    .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
  const pageUsers = matches.slice((page - 1) * PAGE, page * PAGE);

  const stats = new Map<string, { last_expense_at: string | null; telegram_linked: boolean }>();
  if (pageUsers.length) {
    const response = await rest("rpc/admin_user_stats", { method: "POST", body: JSON.stringify({ p_users: pageUsers.map((u) => u.id) }) });
    if (response.ok) for (const row of (await response.json()) as { user_id: string; last_expense_at: string | null; telegram_linked: boolean }[]) stats.set(row.user_id, row);
  }
  const admins = await rest("app_admins?select=user_id").then(async (r) => (r.ok ? ((await r.json()) as { user_id: string }[]).map((a) => a.user_id) : []));

  return {
    ok: true, total: matches.length, page, pages: Math.max(1, Math.ceil(matches.length / PAGE)),
    counts: { all: users.length, disabled: users.filter((u) => statusOf(u) === "disabled").length, blocked: users.filter((u) => statusOf(u) === "blocked").length },
    users: pageUsers.map((user) => {
      const email = String(user.email ?? "").toLowerCase();
      const used = codes.get(email) ?? 0;
      return {
        id: user.id, email, name: String(user.user_metadata?.username ?? ""), provider: user.app_metadata?.provider ?? "email",
        createdAt: user.created_at ?? null, lastSignInAt: user.last_sign_in_at ?? null,
        // "last active" is the date of the latest expense: a date only, never an amount or a description
        lastExpenseAt: stats.get(user.id)?.last_expense_at ?? null,
        telegram: stats.get(user.id)?.telegram_linked ?? false,
        authenticator: (user.factors ?? []).some((f) => f?.status === "verified"),
        status: statusOf(user), block: blocked.get(email) ?? null,
        codesThisMonth: used, codeLimited: used >= LIMITS.codesPerMonth,
        isAdmin: admins.includes(user.id), isYou: user.id === adminId,
      };
    }),
  };
}

async function setDisabled(body: Body, adminId: string, disable: boolean): Promise<Reply> {
  const user = await oneUser(body.userId);
  if (!user) return { ok: false, message: "That account was not found." };
  if (disable && user.id === adminId) return { ok: false, message: "You can't disable your own account." };
  if (disable && (await isAdmin(user.id))) return { ok: false, message: "An administrator account can't be disabled." };
  await audit(adminId, disable ? "disable_account" : "enable_account", user.id, String(user.email ?? ""));
  const { status } = await authAdmin(`admin/users/${user.id}`, { method: "PUT", body: { ban_duration: disable ? FOREVER : "none" } });
  if (status !== 200) return { ok: false, message: "The account could not be updated. Please try again." };
  return { ok: true, message: disable ? "Account disabled. They can no longer sign in." : "Account enabled." };
}

async function setBlocked(body: Body, adminId: string, block: boolean, now: Date): Promise<Reply> {
  const user = await oneUser(body.userId);
  const email = String(user?.email ?? "").toLowerCase();
  if (!user || !email) return { ok: false, message: "That account was not found." };
  if (block && user.id === adminId) return { ok: false, message: "You can't block your own account." };
  await audit(adminId, block ? "block_signin" : "unblock_signin", user.id, email);
  const cleared = await rest(`auth_lockouts?email=eq.${q(email)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  if (!cleared.ok) return { ok: false, message: "The block could not be changed. Has supabase-schema.sql been run?" };
  if (block) {
    const added = await rest("auth_lockouts", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ email, device_id: "*", fails: 0, blocked_at: now.toISOString(), manual: true }) });
    if (!added.ok) return { ok: false, message: "The block could not be saved. Please try again." };
  }
  return { ok: true, message: block ? "Sign-in is blocked for this account until you unblock it." : "Unblocked. They can sign in again." };
}

async function clearCodes(body: Body, adminId: string, now: Date): Promise<Reply> {
  const user = await oneUser(body.userId);
  const email = String(user?.email ?? "").toLowerCase();
  if (!user || !email) return { ok: false, message: "That account was not found." };
  await audit(adminId, "clear_code_limit", user.id, email);
  const cleared = await rest(`auth_code_requests?email=eq.${q(email)}&sent_at=gte.${q(periods(now).monthStart)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  return cleared.ok ? { ok: true, message: "Code limit cleared. They can ask for codes again." } : { ok: false, message: "The limit could not be cleared. Please try again." };
}

async function sendReset(body: Body, adminId: string, connector: Connector): Promise<Reply> {
  const user = await oneUser(body.userId);
  const email = String(user?.email ?? "").toLowerCase();
  if (!user || !email) return { ok: false, message: "That account was not found." };
  if (!(await takeQuota(`admin-reset:${user.id}`, 3))) return { ok: false, message: "A reset code was already sent to this person 3 times today." };
  const setup = loadEmailSetup();
  if (typeof setup === "string") return { ok: false, message: "The email service is not set up, so a reset code can't be sent." };
  await audit(adminId, "send_password_reset", user.id, email);
  // The code is made by the sign-in service and goes straight to the person's inbox. It is never returned to the admin,
  // and the admin never sees or sets a password.
  const { status, data } = await authAdmin("admin/generate_link", { method: "POST", body: { type: "recovery", email } });
  const code = String((data as { email_otp?: string })?.email_otp ?? "");
  if (status !== 200 || !/^\d{6}$/.test(code)) return { ok: false, message: "A reset code could not be made. Please try again." };
  const template = authTemplates().find((t) => t.key === "recovery")!;
  const html = template.html.replaceAll("{{ .Token }}", code).replaceAll("{{ .Email }}", escapeHtml(email));
  const sent = await sendEmail(setup.mail, {
    to: email, subject: template.subject, html,
    text: `Your ManaDuit password-reset code is ${code}. It works once and expires in ${LIMITS.codeMinutes} minutes. Open the app, choose "Forgot password?" and then "I already have a code".`,
  }, connector);
  return sent.ok ? { ok: true, message: `A password-reset code was emailed to ${email}.` } : { ok: false, message: "The reset email could not be sent. Check the email service below." };
}

async function resetAuthenticator(body: Body, adminId: string): Promise<Reply> {
  const user = await oneUser(body.userId);
  if (!user) return { ok: false, message: "That account was not found." };
  await audit(adminId, "reset_authenticator", user.id, String(user.email ?? ""));
  if (!(await removeFactors(user.id))) return { ok: false, message: "The authenticator could not be reset. Please try again." };
  await rest(`mfa_recovery_codes?user_id=eq.${q(user.id)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } }).catch(() => undefined);
  return { ok: true, message: "Authenticator turned off. They can sign in with their password and set it up again." };
}

async function resendReport(body: Body, adminId: string, now: Date, tools: { connector: Connector; tg?: TelegramClient }): Promise<Reply> {
  const user = await oneUser(body.userId);
  if (!user) return { ok: false, message: "That account was not found." };
  const period = periodOf(String(body.month ?? ""));
  if (!period || Date.parse(period.end) > now.getTime() || Date.parse(period.end) < now.getTime() - 400 * 86_400_000) {
    return { ok: false, message: "Choose a finished month from the last 12 months." };
  }
  if (!(await takeQuota(`admin-report:${user.id}`, 5))) return { ok: false, message: "This person was already sent 5 reports by an admin today." };
  await audit(adminId, "resend_report", user.id, `${user.email ?? ""} ${period.key}`);
  const setup = loadEmailSetup();
  const token = env("TELEGRAM_BOT_TOKEN") ?? "";
  const delivery = await deliverReport(user.id, period, { now, email: typeof setup === "string" ? null : setup, tg: tools.tg ?? (token ? telegramClient(token) : null), connector: tools.connector });
  if (delivery.reason === "no_channel") return { ok: false, message: "This person has no Telegram link and no confirmed report email, so there is nowhere to send it." };
  await recordDelivery(user.id, period, delivery, now);
  // Only whether it went, and by which channel. The report itself is never returned to the admin.
  return delivery.ok ? { ok: true, message: `The ${period.label} report was sent to this person by ${delivery.channel}.` } : { ok: false, message: "The report could not be sent. Check the service health below." };
}

async function feedbackList(body: Body): Promise<Reply> {
  const status = body.status === "resolved" ? "resolved" : "open";
  const response = await rest(`feedback?select=id,email,topic,message,status,created_at,resolved_at&status=eq.${status}&order=created_at.desc&limit=100`);
  if (!response.ok) return { ok: false, message: "Feedback could not be loaded. Has supabase-schema.sql been run?" };
  return { ok: true, items: await response.json() };
}

async function feedbackResolve(body: Body, adminId: string, now: Date): Promise<Reply> {
  const id = Number(body.id);
  if (!Number.isSafeInteger(id) || id < 1) return { ok: false, message: "That message was not found." };
  const resolved = body.resolved !== false;
  await audit(adminId, resolved ? "resolve_feedback" : "reopen_feedback", null, `feedback ${id}`);
  const response = await rest(`feedback?id=eq.${id}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ status: resolved ? "resolved" : "open", resolved_at: resolved ? now.toISOString() : null }) });
  return response.ok && ((await response.json()) as unknown[]).length === 1 ? { ok: true } : { ok: false, message: "That message could not be updated." };
}

async function health(): Promise<Reply> {
  const setup = loadEmailSetup();
  const open = await rest("feedback?select=id&status=eq.open&limit=200").then(async (r) => (r.ok ? ((await r.json()) as unknown[]).length : null)).catch(() => null);
  const tables = await Promise.all(["auth_lockouts", "auth_code_requests", "feedback", "admin_audit_log", "fixed_deposits"].map((t) => rest(`${t}?select=*&limit=1`).then((r) => r.ok).catch(() => false)));
  return {
    ok: true,
    checks: {
      "Email (Gmail SMTP)": typeof setup !== "string",
      "Telegram bot": !!env("TELEGRAM_BOT_TOKEN"),
      "Scheduled jobs secret": (env("MONTHLY_REPORT_CRON_SECRET") ?? "").length >= 24,
      "Allowed website list": (env("ALLOWED_ORIGINS") ?? "").trim().length > 0,
      "Database is up to date": tables.every(Boolean),
    },
    openFeedback: open,
  };
}

/** Receipt-scan reliability over the last 7 days: counts, success rate and timing. Never any receipt content. */
async function scanStats(now: Date): Promise<Reply> {
  const since = new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString();
  const response = await rest(`scan_events?select=engine,ok,reason,ms&at=gte.${q(since)}&order=at.desc&limit=5000`);
  if (!response.ok) return { ok: false, message: "Scan statistics are not set up yet: run the scan_events part of supabase-schema.sql in Supabase." };
  return { ok: true, ...summariseScans((await response.json()) as never[]) };
}

async function log(): Promise<Reply> {
  const response = await rest("admin_audit_log?select=id,admin_id,action,detail,created_at&order=created_at.desc&limit=50");
  return response.ok ? { ok: true, items: await response.json() } : { ok: false, message: "The log could not be loaded." };
}

// Announcements: one live "what's new" message. English is required; Malay and Chinese are optional and fall back to English.
const ANN_COLUMNS = "id,title_en,body_en,title_ms,body_ms,title_zh,body_zh,status,published_at,created_at";
const ANN_TITLE_MAX = 80;
const ANN_BODY_MAX = 1500;

/** Text from the form: line breaks kept, other control characters dropped, trimmed. */
function annText(value: unknown): string {
  if (typeof value !== "string") return "";
  return [...value.replace(/\r\n/g, "\n")].filter((ch) => { const c = ch.charCodeAt(0); return c === 10 || (c >= 32 && c !== 127); }).join("").trim();
}

/** The six text fields of an announcement, or why they cannot be used. A language is kept only when both its title and its message are written. */
function annFields(body: Body, forPublish: boolean): { ok: true; fields: Record<string, string | null> } | { ok: false; message: string } {
  const pick = (name: string) => ({ title: annText(body["title" + name]), body: annText(body["body" + name]) });
  const en = pick("En");
  const ms = pick("Ms");
  const zh = pick("Zh");
  for (const [label, t] of [["English", en], ["Malay", ms], ["Chinese", zh]] as const) {
    if (t.title.length > ANN_TITLE_MAX) return { ok: false, message: label + " title is too long (at most " + ANN_TITLE_MAX + " characters)." };
    if (t.body.length > ANN_BODY_MAX) return { ok: false, message: label + " message is too long (at most " + ANN_BODY_MAX + " characters)." };
  }
  if (forPublish && (!en.title || !en.body)) return { ok: false, message: "The English title and message are required." };
  const both = (t: { title: string; body: string }) => (t.title && t.body ? t : null);
  return {
    ok: true,
    fields: {
      title_en: en.title || "(untitled)", body_en: en.body || "(empty)",
      title_ms: both(ms)?.title ?? null, body_ms: both(ms)?.body ?? null,
      title_zh: both(zh)?.title ?? null, body_zh: both(zh)?.body ?? null,
    },
  };
}

async function announcementState(): Promise<Reply> {
  const live = await rest("announcements?select=" + ANN_COLUMNS + "&status=eq.published&limit=1");
  const draft = await rest("announcements?select=" + ANN_COLUMNS + "&status=eq.draft&order=created_at.desc&limit=1");
  if (!live.ok || !draft.ok) return { ok: false, message: "Announcements are not set up yet: run the announcements part of supabase-schema.sql in Supabase." };
  const published = ((await live.json()) as Reply[])[0] ?? null;
  let reads = 0;
  if (published) {
    const seen = await rest("announcement_reads?select=user_id&announcement_id=eq." + q(String(published.id)) + "&limit=100000");
    if (seen.ok) reads = ((await seen.json()) as unknown[]).length;
  }
  return { ok: true, published, draft: ((await draft.json()) as Reply[])[0] ?? null, reads };
}

async function announcementSave(body: Body, adminId: string): Promise<Reply> {
  const parsed = annFields(body, false);
  if (!parsed.ok) return parsed;
  const existing = await rest("announcements?select=id&status=eq.draft&limit=1");
  if (!existing.ok) return { ok: false, message: "Announcements are not set up yet: run the announcements part of supabase-schema.sql in Supabase." };
  const found = ((await existing.json()) as { id: string }[])[0];
  const response = found
    ? await rest("announcements?id=eq." + q(found.id), { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(parsed.fields) })
    : await rest("announcements", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ ...parsed.fields, status: "draft", created_by: adminId }) });
  if (!response.ok) return { ok: false, message: "The draft could not be saved." };
  await audit(adminId, "save_announcement_draft", null, String(parsed.fields.title_en));
  return { ok: true, message: "Draft saved." };
}

async function announcementPublish(body: Body, adminId: string, now: Date): Promise<Reply> {
  const parsed = annFields(body, true);
  if (!parsed.ok) return parsed;
  await audit(adminId, "publish_announcement", null, String(parsed.fields.title_en));
  const retired = await rest("announcements?status=eq.published", { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "retired", retired_at: now.toISOString() }) });
  if (!retired.ok) return { ok: false, message: "The announcement could not be published." };
  const made = await rest("announcements", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ ...parsed.fields, status: "published", created_by: adminId, published_at: now.toISOString() }) });
  if (!made.ok) return { ok: false, message: "The announcement could not be published." };
  await rest("announcements?status=eq.draft", { method: "DELETE", headers: { Prefer: "return=minimal" } });
  return { ok: true, message: "Published. People who open or refresh the app from now on will see it." };
}

async function announcementRetire(adminId: string, now: Date): Promise<Reply> {
  await audit(adminId, "retire_announcement", null);
  const response = await rest("announcements?status=eq.published", { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "retired", retired_at: now.toISOString() }) });
  return response.ok ? { ok: true, message: "The announcement was switched off." } : { ok: false, message: "The announcement could not be switched off." };
}

// The Door Section
export async function handle(request: Request, now = new Date(), connector: Connector = denoConnector, tg?: TelegramClient): Promise<Response> {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== "POST") return json(request, { error: "Use POST." }, 405);
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  let body: Body;
  try {
    body = await request.json();
    if (!body || typeof body !== "object") throw new Error("bad");
  } catch (_error) {
    return json(request, { error: "Bad request." }, 400);
  }

  try {
    // Checked on every call, on the server. Hiding the screen in the app is not what protects this.
    if (!(await isAdmin(auth.userId))) return json(request, { error: "You are not allowed to do this." }, 403);
    if (!(await takeQuota(`admin:${auth.userId}:${periods(now).hourKey}`, 300))) return json(request, { error: "Too many admin actions this hour. Please wait." }, 429);

    let reply: Reply;
    switch (body.action) {
      case "list": reply = await list(body, auth.userId, now); break;
      case "disable": reply = await setDisabled(body, auth.userId, true); break;
      case "enable": reply = await setDisabled(body, auth.userId, false); break;
      case "block": reply = await setBlocked(body, auth.userId, true, now); break;
      case "unblock": reply = await setBlocked(body, auth.userId, false, now); break;
      case "clear_codes": reply = await clearCodes(body, auth.userId, now); break;
      case "send_reset": reply = await sendReset(body, auth.userId, connector); break;
      case "reset_authenticator": reply = await resetAuthenticator(body, auth.userId); break;
      case "resend_report": reply = await resendReport(body, auth.userId, now, { connector, tg }); break;
      case "feedback_list": reply = await feedbackList(body); break;
      case "feedback_resolve": reply = await feedbackResolve(body, auth.userId, now); break;
      case "health": reply = await health(); break;
      case "scan_stats": reply = await scanStats(now); break;
      case "log": reply = await log(); break;
      case "announcement_state": reply = await announcementState(); break;
      case "announcement_save": reply = await announcementSave(body, auth.userId); break;
      case "announcement_publish": reply = await announcementPublish(body, auth.userId, now); break;
      case "announcement_retire": reply = await announcementRetire(auth.userId, now); break;
      default: return json(request, { error: "Bad request." }, 400);
    }
    return json(request, reply);
  } catch (error) {
    console.error("admin:", String(body.action), error instanceof Error ? error.message : "unknown");
    return json(request, { error: "That could not be done. Please try again." }, 503);
  }
}
