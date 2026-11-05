// The opt-in weekly summary. The database scheduler calls this every hour; it only does anything on Monday from
// 09:00 Kuala Lumpur time, and sends each person who switched it on (/digest on) one message per week.
//
// Safety properties (same as the monthly email): only the scheduler can start it (secret header, constant-time
// comparison); each person is "claimed" for the week before sending so overlapping runs never double-send; at most
// BATCH people per run; a person who blocked the bot is switched off instead of retried forever; a temporary failure
// is released and retried the next hour; a week with nothing to report sends nothing.

import { dailyLimit, env, safeEqual } from "../_shared/guard.ts";
import { q, rest } from "../_shared/db.ts";
import { cleanSiteUrl } from "../_shared/email-setup.ts";
import { asLang, tr } from "../_shared/tg-i18n.ts";
import { loadExpenses } from "../_shared/tg-reports.ts";
import { buildView, pagerButtons } from "../_shared/tg-views.ts";
import { stripTags, type TelegramClient, telegramClient } from "../_shared/telegram.ts";

const KL_MS = 8 * 3600_000;
const DAY_MS = 86_400_000;

function reply(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

/** This Monday 00:00 in Kuala Lumpur (as a UTC instant) and the day-of-week / hour there. */
export function klWeek(now: Date) {
  const local = new Date(now.getTime() + KL_MS);
  const dow = local.getUTCDay(); // 0 = Sunday
  const sinceMonday = (dow + 6) % 7;
  const mondayLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - sinceMonday);
  const monday = new Date(mondayLocal - KL_MS);
  return {
    dow,
    hour: local.getUTCHours(),
    monday,
    key: new Date(mondayLocal).toISOString().slice(0, 10), // the Monday's date, used as the "week" label
    lastMonday: new Date(monday.getTime() - 7 * DAY_MS),
    weekBefore: new Date(monday.getTime() - 14 * DAY_MS),
  };
}

export async function handle(request: Request, now = new Date(), clientOverride?: TelegramClient): Promise<Response> {
  if (request.method !== "POST") return reply({ error: "Use POST." }, 405);

  const cronSecret = env("MONTHLY_REPORT_CRON_SECRET") ?? "";
  if (cronSecret.length < 24) {
    console.error("telegram-digest: MONTHLY_REPORT_CRON_SECRET is missing or shorter than 24 characters");
    return reply({ error: "Not configured." }, 503);
  }
  if (!safeEqual(request.headers.get("x-cron-secret") ?? "", cronSecret)) return reply({ error: "Unauthorized" }, 401);

  const token = env("TELEGRAM_BOT_TOKEN") ?? "";
  if (!token) {
    console.error("telegram-digest: TELEGRAM_BOT_TOKEN is missing");
    return reply({ error: "Not configured." }, 503);
  }

  const week = klWeek(now);
  if (week.dow !== 1 || week.hour < 9) return reply({ message: "The weekly summary is sent on Monday from 09:00 Kuala Lumpur time." });

  const tg = clientOverride ?? telegramClient(token);
  const batch = Math.min(dailyLimit("DIGEST_BATCH", 30), 100);
  const notDone = `or=(last_digest_week.is.null,last_digest_week.neq.${week.key})`;

  let people: { chat_id: number; user_id: string; lang: string; last_digest_week: string | null }[];
  try {
    const response = await rest(`telegram_links?select=chat_id,user_id,lang,last_digest_week&digest_on=eq.true&${notDone}&order=chat_id.asc&limit=${batch}`);
    if (!response.ok) throw new Error(`status ${response.status}`);
    people = await response.json();
  } catch (error) {
    console.error("telegram-digest: could not load people", error instanceof Error ? error.message : "unknown");
    return reply({ error: "Could not load recipients." }, 502);
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  let blocked = 0;
  for (const person of people) {
    const chatId = Number(person.chat_id);
    const userId = String(person.user_id);
    if (!Number.isSafeInteger(chatId)) { skipped++; continue; }

    const claim = await rest(`telegram_links?chat_id=eq.${chatId}&user_id=eq.${q(userId)}&digest_on=eq.true&${notDone}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ last_digest_week: week.key }),
    });
    if (!claim.ok || (await claim.json()).length !== 1) { skipped++; continue; }
    const release = () =>
      rest(`telegram_links?chat_id=eq.${chatId}&last_digest_week=eq.${week.key}`, {
        method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ last_digest_week: person.last_digest_week }),
      }).catch(() => undefined);

    try {
      const lang = asLang(person.lang);
      const iso = (d: Date) => d.toISOString();
      // The same week view as the /week command (offset 1 = the week that just ended): bars + caption, with the
      // complete text report as the fallback if the picture cannot be drawn or sent.
      const categories = await rest(`user_categories?select=category_key,label&user_id=eq.${q(userId)}`).then(async (r) => (r.ok ? await r.json() : [])).catch(() => []);
      const names = new Map((categories as { category_key: string; label: string }[]).map((c) => [c.category_key, c.label] as const));
      const view = await buildView({ userId, lang, now, view: "w", offset: 1, labels: (key) => names.get(key) ?? key, digest: true });
      if (!view.hasData) {
        const before = await loadExpenses(userId, iso(week.weekBefore), iso(week.lastMonday));
        if (!before.length) { skipped++; continue; } // a quiet fortnight: say nothing
      }
      const site = cleanSiteUrl(env("SITE_URL"));
      const tip = tr(lang, "digest_tip");
      const withTip = (text: string, limit: number) => (stripTags(`${text}\n\n${tip}`).length <= limit ? `${text}\n\n${tip}` : text);
      let result: "ok" | "blocked" | "failed";
      if (view.kind === "photo" && view.png) {
        result = await tg.sendPhotoChecked(chatId, view.png, withTip(view.text, 1000), { buttons: pagerButtons(lang, "w", 1, { details: true, siteUrl: site }) });
        if (result === "failed") result = await tg.sendChecked(chatId, withTip(view.full, 3900), { buttons: pagerButtons(lang, "w", 1, { details: false, siteUrl: site }) });
      } else {
        result = await tg.sendChecked(chatId, withTip(view.text, 3900), { buttons: pagerButtons(lang, "w", 1, { details: false, siteUrl: site }) });
      }
      if (result === "ok") { sent++; continue; }
      if (result === "blocked") {
        blocked++;
        await rest(`telegram_links?chat_id=eq.${chatId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ digest_on: false }) });
        continue;
      }
      failed++;
      await release();
    } catch (error) {
      failed++;
      console.error("telegram-digest: person failed", error instanceof Error ? error.message : "unknown");
      await release();
    }
  }
  return reply({ week: week.key, sent, skipped, failed, blocked });
}
