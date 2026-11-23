// Telegram reminders for the Plan tab: a fixed deposit that is about to mature, a loan payment that is about to
// fall due. The database scheduler calls this every hour. Each person gets a reminder once, at or after the hour
// they chose (09:00 Kuala Lumpur time unless changed in Account).
//
// Safety properties (same as the weekly summary): only the scheduler can start it (secret header, constant-time
// comparison). Each reminder is "claimed" in reminder_log before it is sent, and that table's unique key means two
// overlapping runs can never send the same one twice. A temporary failure is retried on later runs, three times
// at most. Someone who blocked the bot is marked and left alone for a day instead of being retried every hour.
// A run that was missed is caught up by the next one, but only with the reminder that matters now: never a backlog.
// Nothing here changes a deposit or a loan.

import { dailyLimit, env, safeEqual } from "../_shared/guard.ts";
import { fetchAll, q, rest } from "../_shared/db.ts";
import { cleanSiteUrl } from "../_shared/email-setup.ts";
import { type DueReminder, loadFinanceCalc } from "../_shared/finance-calc-loader.ts";
import { escapeHtml, type InlineButton, ringgit, type TelegramClient, telegramClient } from "../_shared/telegram.ts";

const KL_MS = 8 * 3600_000;
const DAY_MS = 86_400_000;
const LATE_DAYS = 7;       // how long after the date a missed reminder is still worth sending
const MAX_ATTEMPTS = 3;
const DEFAULT_HOUR = 9;

function reply(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

/** Today's calendar date and hour in Kuala Lumpur. */
export function klNow(now: Date): { date: string; hour: number } {
  const local = new Date(now.getTime() + KL_MS);
  return { date: local.toISOString().slice(0, 10), hour: local.getUTCHours() };
}

const prettyDate = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1];
  return `${d} ${month} ${y}`;
};

/** The message for one reminder. Amounts are left out when the person asked for that. */
export function reminderMessage(r: DueReminder, relative: (days: number) => string, hideAmounts: boolean): string {
  const name = escapeHtml(r.name);
  const date = prettyDate(r.dueDate);
  const amount = hideAmounts ? "" : ` · ${ringgit(r.amount)}`;
  if (r.kind === "fd") {
    if (r.group === "overdue") return `🏦 <b>Fixed deposit matured ${relative(r.daysLeft)}</b>\n${name}${amount}\nMatured on ${date}. Open the app to record the interest, renew it or close it.`;
    const when = r.daysLeft === 0 ? "matures today" : `matures ${relative(r.daysLeft)}`;
    return `🏦 <b>Fixed deposit ${when}</b>\n${name}${amount}\nMaturity date: ${date}`;
  }
  if (r.group === "overdue") {
    const many = (r.count ?? 1) > 1 ? `\n${r.count} payments are not marked as paid.` : "";
    return `💳 <b>Loan payment was due ${relative(r.daysLeft)}</b>\n${name}${amount}\nDue date: ${date}${many}`;
  }
  const when = r.daysLeft === 0 ? "due today" : `due ${relative(r.daysLeft)}`;
  return `💳 <b>Loan payment ${when}</b>\n${name}${amount}\nDue date: ${date}`;
}

interface LinkRow { chat_id: number; user_id: string; reminders_blocked_at?: string | null }
interface PrefRow { user_id: string; reminder_hour?: number | null; reminder_hide_amounts?: boolean | null }
interface LogRow { id: number; attempts: number; sent_at: string | null }
type Item = Record<string, unknown> & { id: string; user_id: string };

async function optional<T>(path: string): Promise<T[]> {
  try {
    return await fetchAll<T>(path);
  } catch (_error) {
    return []; // an older database without this table or column: carry on with the defaults
  }
}

/** Claims one reminder. Returns the log row id to finish with, or null when it must not be sent (again). */
async function claim(userId: string, r: DueReminder): Promise<number | null> {
  const key = `item_kind=eq.${r.kind}&item_id=eq.${q(r.id)}&due_date=eq.${r.dueDate}&lead_days=eq.${r.milestone}`;
  const created = await rest("reminder_log", {
    method: "POST",
    headers: { Prefer: "return=representation,resolution=ignore-duplicates" },
    body: JSON.stringify({ user_id: userId, item_kind: r.kind, item_id: r.id, due_date: r.dueDate, lead_days: r.milestone, attempts: 1 }),
  });
  if (created.ok) {
    const rows = (await created.json().catch(() => [])) as LogRow[];
    if (rows.length === 1) return rows[0].id;
  } else if (created.status !== 409) {
    throw new Error(`reminder_log insert ${created.status}`);
  }
  // It exists already: sent, given up on, or a failed try that may be repeated
  const found = await rest(`reminder_log?select=id,attempts,sent_at&${key}`);
  if (!found.ok) throw new Error(`reminder_log read ${found.status}`);
  const existing = ((await found.json()) as LogRow[])[0];
  if (!existing || existing.sent_at || existing.attempts >= MAX_ATTEMPTS) return null;
  const retry = await rest(`reminder_log?id=eq.${existing.id}&attempts=eq.${existing.attempts}&sent_at=is.null`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ attempts: existing.attempts + 1 }),
  });
  if (!retry.ok) throw new Error(`reminder_log retry ${retry.status}`);
  return ((await retry.json()) as LogRow[]).length === 1 ? existing.id : null; // another run took this try
}

export async function handle(request: Request, now = new Date(), clientOverride?: TelegramClient): Promise<Response> {
  if (request.method !== "POST") return reply({ error: "Use POST." }, 405);

  const cronSecret = env("MONTHLY_REPORT_CRON_SECRET") ?? "";
  if (cronSecret.length < 24) {
    console.error("plan-reminders: MONTHLY_REPORT_CRON_SECRET is missing or shorter than 24 characters");
    return reply({ error: "Not configured." }, 503);
  }
  if (!safeEqual(request.headers.get("x-cron-secret") ?? "", cronSecret)) return reply({ error: "Unauthorized" }, 401);

  const token = env("TELEGRAM_BOT_TOKEN") ?? "";
  if (!token) {
    console.error("plan-reminders: TELEGRAM_BOT_TOKEN is missing");
    return reply({ error: "Not configured." }, 503);
  }
  const calc = await loadFinanceCalc();
  if (!calc) {
    console.error("plan-reminders: finance-calc.js could not be loaded");
    return reply({ error: "Not ready." }, 503);
  }

  const today = klNow(now);
  const tg = clientOverride ?? telegramClient(token);
  const batch = Math.min(dailyLimit("REMINDER_BATCH", 60), 200);

  let links: LinkRow[];
  let deposits: Item[];
  let loans: Item[];
  try {
    links = await fetchAll<LinkRow>("telegram_links?select=chat_id,user_id,reminders_blocked_at&order=chat_id.asc")
      .catch(() => fetchAll<LinkRow>("telegram_links?select=chat_id,user_id&order=chat_id.asc"));
    if (!links.length) return reply({ date: today.date, sent: 0, message: "Nobody has connected Telegram." });
    const from = new Date(Date.parse(`${today.date}T00:00:00Z`) - LATE_DAYS * DAY_MS).toISOString().slice(0, 10);
    const until = new Date(Date.parse(`${today.date}T00:00:00Z`) + 61 * DAY_MS).toISOString().slice(0, 10);
    deposits = await fetchAll<Item>(`fixed_deposits?select=*&status=eq.open&reminders_on=eq.true&maturity_date=gte.${from}&maturity_date=lt.${until}&order=id.asc`);
    loans = await fetchAll<Item>("loans?select=*&status=eq.open&reminders_on=eq.true&order=id.asc");
  } catch (error) {
    console.error("plan-reminders: could not load data", error instanceof Error ? error.message : "unknown");
    return reply({ error: "Could not load reminders. Has supabase-schema.sql been run?" }, 502);
  }

  const prefs = new Map((await optional<PrefRow>("user_preferences?select=user_id,reminder_hour,reminder_hide_amounts&order=user_id.asc")).map((p) => [p.user_id, p] as const));
  // A loan that was added to recurring expenses is paid automatically while that entry is running. If the entry is
  // paused (or finished), everything before its next date was already posted, so only later dates can be overdue.
  const entries = await optional<{ loan_id: string | null; next_due?: string | null; active?: boolean | null }>(
    "recurring_expenses?select=loan_id,next_due,active&loan_id=not.is.null&order=loan_id.asc",
  );
  const autoPaid = entries.filter((e) => e.active !== false).map((e) => e.loan_id).filter((id): id is string => typeof id === "string");
  for (const entry of entries) {
    if (entry.active !== false || typeof entry.next_due !== "string") continue;
    const loan = loans.find((l) => l.id === entry.loan_id);
    if (!loan) continue;
    const posted = calc.lastDueBefore(loan, entry.next_due);
    if (posted && (typeof loan.paid_through !== "string" || posted > loan.paid_through)) loan.paid_through = posted;
  }

  const site = cleanSiteUrl(env("SITE_URL"));
  const buttons: InlineButton[][] | undefined = site ? [[{ text: "Open the app", url: site }]] : undefined;

  let sent = 0, skipped = 0, failed = 0, blocked = 0, waiting = 0;
  for (const link of links) {
    if (sent + failed >= batch) { waiting++; continue; }
    const chatId = Number(link.chat_id);
    const userId = String(link.user_id);
    if (!Number.isSafeInteger(chatId)) { skipped++; continue; }

    const pref = prefs.get(userId);
    const hour = Number.isInteger(pref?.reminder_hour) && pref!.reminder_hour! >= 0 && pref!.reminder_hour! <= 23 ? pref!.reminder_hour! : DEFAULT_HOUR;
    if (today.hour < hour) { waiting++; continue; } // later today

    // Blocked the bot: leave them alone for a day, then one reminder is tried again in case they came back
    const blockedAt = link.reminders_blocked_at ? Date.parse(link.reminders_blocked_at) : NaN;
    if (Number.isFinite(blockedAt) && now.getTime() - blockedAt < DAY_MS) { skipped++; continue; }

    const due = calc.dueReminders(
      deposits.filter((d) => d.user_id === userId),
      loans.filter((l) => l.user_id === userId),
      today.date,
      { lateDays: LATE_DAYS, autoPaidLoanIds: autoPaid },
    );
    for (const reminder of due) {
      if (sent + failed >= batch) { waiting++; break; }
      try {
        const logId = await claim(userId, reminder);
        if (logId === null) { skipped++; continue; }
        const result = await tg.sendChecked(chatId, reminderMessage(reminder, calc.relativeDay, pref?.reminder_hide_amounts === true), { buttons });
        if (result === "ok") {
          sent++;
          await rest(`reminder_log?id=eq.${logId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ sent_at: now.toISOString() }) });
          if (Number.isFinite(blockedAt)) {
            await rest(`telegram_links?chat_id=eq.${chatId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ reminders_blocked_at: null }) }).catch(() => undefined);
          }
          continue;
        }
        if (result === "blocked") {
          blocked++;
          // Forget this try (so the reminder can still go out if they unblock the bot) and stop for this person
          await rest(`reminder_log?id=eq.${logId}&sent_at=is.null`, { method: "DELETE", headers: { Prefer: "return=minimal" } }).catch(() => undefined);
          await rest(`telegram_links?chat_id=eq.${chatId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ reminders_blocked_at: now.toISOString() }) }).catch(() => undefined);
          break;
        }
        failed++; // the claimed row stays unsent: the next run tries again, up to MAX_ATTEMPTS
      } catch (error) {
        failed++;
        console.error("plan-reminders: reminder failed", error instanceof Error ? error.message : "unknown");
      }
    }
  }
  return reply({ date: today.date, hour: today.hour, sent, skipped, failed, blocked, waiting });
}
