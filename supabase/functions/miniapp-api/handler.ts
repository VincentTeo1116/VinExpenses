// The Mini App's data service. The Mini App is a web page (served from your GitHub Pages site) that opens inside Telegram.
// It has no password: Telegram hands the page a signed string (initData) proving who is using it, and this function
// checks that signature (see _shared/tg-webapp.ts) BEFORE it reads or writes anything.
//
// Rules this function follows:
//   1. No valid signature = no data. Nothing below the authentication step runs without one.
//   2. The signature must be recent (default 6 hours), so a copy that leaks stops working.
//   3. The Telegram user must be LINKED to an app account (the same one-time-code linking as the bot).
//   4. Every query is scoped to that account's user id (the server key ignores row-level security, so this is enforced
//      here, and a test fails if a query is not scoped).
//   5. Reads are limited to 3,000 calls a day and writes to 300 a day per person; the counters fail closed.
//   6. Everything a person types is validated and length-limited before it is stored.
//   7. Browsers may only call it from your own website (ALLOWED_ORIGINS), like every other function.
//
// Request: POST, header "x-telegram-init-data", JSON body {action, ...}. Actions:
//   bootstrap | month | transactions | expense_add | expense_update | expense_delete

import { dailyLimit, env, json, preflight, projectAccess, takeQuota } from "../_shared/guard.ts";
import { fetchAll, q, rest } from "../_shared/db.ts";
import { type Choice, loadChoices } from "../_shared/choices.ts";
import { DAY_MS, KL_MS, klDay } from "../_shared/tg-insights.ts";
import { asLang } from "../_shared/tg-i18n.ts";
import { MAX_OFFSET, monthData, monthWindow } from "../_shared/tg-views.ts";
import { verifyInitData } from "../_shared/tg-webapp.ts";
import { cleanText, MAX_AMOUNT, UUID_PATTERN } from "../_shared/telegram.ts";

const MAX_BODY = 20_000;
const MAX_DAYS_BACK = 400;

interface Session {
  userId: string;
  chatId: number;
  lang: "en" | "ms" | "zh";
  name: string;
}
interface ExpenseRow {
  id: string;
  amount: number | string;
  category: string;
  payment: string;
  merchant: string | null;
  note: string | null;
  created_at: string;
}

/** A whole number sent as a real number (not a string, array or object), or the default when it was not sent at all. */
const wholeNumber = (value: unknown, fallback: number): number => (value === undefined ? fallback : typeof value === "number" && Number.isInteger(value) ? value : NaN);

const fail = (request: Request, status: number, code: string, field?: string) =>
  json(request, { ok: false, error: code, ...(field ? { field } : {}) }, status);

/** "YYYY-MM-DD" for a moment, on the Kuala Lumpur calendar. */
const klDate = (instant: Date) => new Date(instant.getTime() + KL_MS).toISOString().slice(0, 10);

async function authenticate(request: Request, now: Date): Promise<Session | Response> {
  const token = env("TELEGRAM_BOT_TOKEN") ?? "";
  if (!token || !projectAccess()) {
    console.error("miniapp-api: TELEGRAM_BOT_TOKEN or the database settings are missing");
    return fail(request, 503, "not_configured");
  }
  const maxAge = dailyLimit("MINIAPP_MAX_AGE_SECONDS", 6 * 3600);
  const result = await verifyInitData(request.headers.get("x-telegram-init-data"), token, now, maxAge);
  if (!result.ok) return fail(request, 401, result.reason === "expired" ? "expired" : "unauthorized");

  const response = await rest(`telegram_links?select=user_id,chat_id&chat_id=eq.${result.user.id}`);
  if (!response.ok) return fail(request, 503, "unavailable");
  const link = (await response.json())[0] as { user_id?: string; chat_id?: number } | undefined;
  if (!link?.user_id || !UUID_PATTERN.test(link.user_id)) return fail(request, 403, "not_linked");

  // The language chosen in the bot; if that column is not available yet, the person's Telegram language.
  let language = result.user.language_code;
  try {
    const prefs = await rest(`telegram_links?select=lang&chat_id=eq.${result.user.id}`);
    if (prefs.ok) language = (await prefs.json())[0]?.lang ?? language;
  } catch (_error) { /* keep the Telegram language */ }
  return { userId: link.user_id, chatId: result.user.id, lang: asLang(language.startsWith("zh") ? "zh" : language.startsWith("ms") ? "ms" : language), name: result.user.first_name };
}

// ---------------------------------------------------------------- validation

interface Checked {
  amount?: number;
  category?: string;
  payment?: string;
  merchant?: string | null;
  note?: string | null;
  date?: string;
}

function checkExpense(input: Record<string, unknown>, categories: Choice[], payments: Choice[], now: Date, requireAll: boolean): { ok: true; value: Checked } | { ok: false; field: string } {
  const value: Checked = {};
  if (requireAll || "amount" in input) {
    const raw = typeof input.amount === "string" ? input.amount.trim().replace(",", ".") : input.amount;
    const number = typeof raw === "number" || (typeof raw === "string" && /^\d{1,7}(\.\d{1,2})?$/.test(raw)) ? Number(raw) : NaN;
    const amount = Math.round(number * 100) / 100;
    if (!Number.isFinite(amount) || amount < 0.01 || amount > MAX_AMOUNT) return { ok: false, field: "amount" };
    value.amount = amount;
  }
  if (requireAll || "category" in input) {
    if (typeof input.category !== "string" || !categories.some((c) => c.key === input.category)) return { ok: false, field: "category" };
    value.category = input.category;
  }
  if (requireAll || "payment" in input) {
    if (typeof input.payment !== "string" || !payments.some((p) => p.key === input.payment)) return { ok: false, field: "payment" };
    value.payment = input.payment;
  }
  if ("merchant" in input) {
    if (input.merchant !== null && typeof input.merchant !== "string") return { ok: false, field: "merchant" };
    value.merchant = typeof input.merchant === "string" ? cleanText(input.merchant, 80) || null : null;
  }
  if ("note" in input) {
    if (input.note !== null && typeof input.note !== "string") return { ok: false, field: "note" };
    value.note = typeof input.note === "string" ? cleanText(input.note, 200) || null : null;
  }
  if ("date" in input && input.date !== null && input.date !== "") {
    if (typeof input.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return { ok: false, field: "date" };
    const [y, m, d] = input.date.split("-").map(Number);
    const probe = new Date(Date.UTC(y, m - 1, d));
    if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return { ok: false, field: "date" };
    const back = klDay(now) - Math.floor(probe.getTime() / DAY_MS);
    if (back < 0 || back > MAX_DAYS_BACK) return { ok: false, field: "date" };
    value.date = input.date;
  }
  return { ok: true, value };
}

/** Noon in Kuala Lumpur on a "YYYY-MM-DD" date, as an ISO time. */
const noonKl = (date: string) => new Date(`${date}T12:00:00+08:00`).toISOString();

// ---------------------------------------------------------------- the handler

export async function handle(request: Request, now = new Date()): Promise<Response> {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== "POST") return fail(request, 405, "method");

  const session = await authenticate(request, now);
  if (session instanceof Response) return session;

  let body: Record<string, unknown>;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) return fail(request, 413, "too_large");
    body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("not an object");
  } catch (_error) {
    return fail(request, 400, "bad_request");
  }
  const action = body.action;
  const writes = action === "expense_add" || action === "expense_update" || action === "expense_delete";
  if (!(await takeQuota(`mini:${session.userId}`, dailyLimit("MINIAPP_DAILY_LIMIT", 3000)))) return fail(request, 429, "limit");
  if (writes && !(await takeQuota(`mini-write:${session.userId}`, dailyLimit("MINIAPP_WRITE_LIMIT", 300)))) return fail(request, 429, "limit");

  try {
    switch (action) {
      case "bootstrap": {
        const { categories, payments } = await loadChoices(session.userId);
        return json(request, { ok: true, name: session.name, lang: session.lang, today: klDate(now), categories, payments, maxOffset: MAX_OFFSET.m, maxAmount: MAX_AMOUNT, maxDaysBack: MAX_DAYS_BACK });
      }

      case "month": {
        const offset = wholeNumber(body.offset, 0);
        if (!(offset >= 0 && offset <= MAX_OFFSET.m)) return fail(request, 400, "invalid", "offset");
        return json(request, { ok: true, data: await monthData(session.userId, now, offset) });
      }

      case "transactions": {
        const offset = wholeNumber(body.offset, 0);
        if (!(offset >= 0 && offset <= MAX_OFFSET.m)) return fail(request, 400, "invalid", "offset");
        // Paging values that make no sense fall back to the defaults (50 rows, from the start); a huge limit is capped at 100.
        const asked = typeof body.limit === "number" && Number.isFinite(body.limit) && body.limit >= 1 ? Math.floor(body.limit) : 50;
        const limit = Math.min(100, asked);
        const skip = typeof body.skip === "number" && Number.isFinite(body.skip) && body.skip >= 0 ? Math.floor(body.skip) : 0;
        const category = typeof body.category === "string" && body.category ? body.category.slice(0, 64) : "";
        const search = typeof body.q === "string" ? cleanText(body.q, 60).toLowerCase() : "";
        const win = monthWindow(now, offset);
        const rows = await fetchAll<ExpenseRow>(
          `expenses?select=id,amount,category,payment,merchant,note,created_at&user_id=eq.${q(session.userId)}&created_at=gte.${q(win.start.toISOString())}&created_at=lt.${q(win.end.toISOString())}&order=created_at.desc,id.desc`,
        );
        // Filtering happens here, in code, on the person's own rows: no search text is ever placed in a database query.
        const kept = rows.filter((r) => (!category || r.category === category) && (!search || `${r.merchant ?? ""} ${r.note ?? ""}`.toLowerCase().includes(search)));
        const sum = Math.round(kept.reduce((s, r) => s + Math.round(Number(r.amount) * 100), 0)) / 100;
        return json(request, { ok: true, total: kept.length, sum, items: kept.slice(skip, skip + limit).map((r) => ({ ...r, amount: Number(r.amount) })) });
      }

      case "expense_add": {
        const { categories, payments } = await loadChoices(session.userId);
        const checked = checkExpense(body, categories.filter((c) => c.active), payments.filter((p) => p.active), now, true);
        if (!checked.ok) return fail(request, 400, "invalid", checked.field);
        const v = checked.value;
        const created = await rest("expenses", {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({
            user_id: session.userId, amount: v.amount, category: v.category, payment: v.payment, merchant: v.merchant ?? null, note: v.note ?? "via Mini App",
            ...(v.date && v.date !== klDate(now) ? { created_at: noonKl(v.date) } : {}),
          }),
        });
        const row = created.ok ? ((await created.json()) as ExpenseRow[])[0] : undefined;
        if (!row) return fail(request, 502, "save_failed");
        return json(request, { ok: true, item: { ...row, amount: Number(row.amount) } });
      }

      case "expense_update": {
        const id = String(body.id ?? "");
        if (!UUID_PATTERN.test(id)) return fail(request, 400, "invalid", "id");
        const { categories, payments } = await loadChoices(session.userId);
        const checked = checkExpense(body, categories, payments, now, false);
        if (!checked.ok) return fail(request, 400, "invalid", checked.field);
        const v = checked.value;
        const patch: Record<string, unknown> = {};
        for (const key of ["amount", "category", "payment", "merchant", "note"] as const) if (key in v) patch[key] = v[key];
        if (v.date) {
          const existing = await rest(`expenses?select=created_at&id=eq.${q(id)}&user_id=eq.${q(session.userId)}`);
          const current = existing.ok ? (await existing.json())[0]?.created_at : undefined;
          if (!current) return fail(request, 404, "not_found");
          if (klDate(new Date(current)) !== v.date) patch.created_at = noonKl(v.date); // same day: keep the original time
        }
        if (!Object.keys(patch).length) return fail(request, 400, "invalid", "nothing");
        const updated = await rest(`expenses?id=eq.${q(id)}&user_id=eq.${q(session.userId)}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(patch) });
        const row = updated.ok ? ((await updated.json()) as ExpenseRow[])[0] : undefined;
        if (!row) return fail(request, 404, "not_found");
        return json(request, { ok: true, item: { ...row, amount: Number(row.amount) } });
      }

      case "expense_delete": {
        const id = String(body.id ?? "");
        if (!UUID_PATTERN.test(id)) return fail(request, 400, "invalid", "id");
        const removed = await rest(`expenses?id=eq.${q(id)}&user_id=eq.${q(session.userId)}`, { method: "DELETE", headers: { Prefer: "return=representation" } });
        const rows = removed.ok ? (await removed.json()) as ExpenseRow[] : [];
        if (!rows.length) return fail(request, 404, "not_found");
        return json(request, { ok: true, id });
      }

      default:
        return fail(request, 400, "bad_request");
    }
  } catch (error) {
    console.error("miniapp-api failed", error instanceof Error ? error.message : "unknown");
    return fail(request, 503, "unavailable");
  }
}

