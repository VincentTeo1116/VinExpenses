// Runs hourly from the scheduler. On the 1st it sends last month's report to everyone who opted in, by Telegram or email.

import { dailyLimit, env, safeEqual, takeQuota } from "../_shared/guard.ts";
import { q, rest } from "../_shared/db.ts";
import { loadEmailSetup } from "../_shared/email-setup.ts";
import { deliverReport, recordDelivery, reportWindow } from "../_shared/report-delivery.ts";
import { type Connector, denoConnector } from "../_shared/smtp.ts";
import { type TelegramClient, telegramClient } from "../_shared/telegram.ts";

export { reportWindow };

function reply(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

export function monthInKualaLumpur(now: Date): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

interface Preference { user_id: string; sent_for_month: string | null }

export async function handle(request: Request, now = new Date(), connector: Connector = denoConnector, tgOverride?: TelegramClient): Promise<Response> {
  if (request.method !== "POST") return reply({ error: "Use POST." }, 405);

  const cronSecret = env("MONTHLY_REPORT_CRON_SECRET") ?? "";
  if (cronSecret.length < 24) {
    console.error("monthly-report-email: MONTHLY_REPORT_CRON_SECRET is missing or shorter than 24 characters");
    return reply({ error: "Not configured." }, 503);
  }
  if (!safeEqual(request.headers.get("x-cron-secret") ?? "", cronSecret)) return reply({ error: "Unauthorized" }, 401);

  const kl = monthInKualaLumpur(now);
  if (kl.day !== "01") return reply({ message: "Reports only run on the first day in Kuala Lumpur." });

  // Either channel is enough to run: email needs the mail settings, Telegram needs the bot token.
  const setup = loadEmailSetup();
  const email = typeof setup === "string" ? null : setup;
  const token = env("TELEGRAM_BOT_TOKEN") ?? "";
  const tg = tgOverride ?? (token ? telegramClient(token) : null);
  if (!email && !tg) {
    console.error("monthly-report-email: neither email nor Telegram is set up:", typeof setup === "string" ? setup : "");
    return reply({ error: "Email service is not set up." }, 503);
  }

  const period = reportWindow(Number(kl.year), Number(kl.month));
  const batch = Math.min(dailyLimit("MONTHLY_REPORT_BATCH", 25), 100);

  let preferences: Preference[];
  try {
    const notDone = `and=(or(sent_for_month.is.null,sent_for_month.neq.${period.date}),or(failed_for_month.is.null,failed_for_month.neq.${period.date}))`;
    const response = await rest(`monthly_report_preferences?select=user_id,sent_for_month&enabled=eq.true&${notDone}&order=user_id.asc&limit=${batch}`);
    if (!response.ok) throw new Error(`status ${response.status}`);
    preferences = await response.json();
  } catch (error) {
    console.error("monthly-report-email: could not load preferences", error instanceof Error ? error.message : "unknown");
    return reply({ error: "Could not load report preferences." }, 502);
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  let stopped = "";
  let emailCapHit = false;
  const byChannel = { telegram: 0, email: 0 };

  for (const preference of preferences) {
    const userId = String(preference.user_id);

    // Claim this user for this month before doing any work (a second overlapping run will find nothing to claim).
    const claim = await rest(
      `monthly_report_preferences?user_id=eq.${q(userId)}&enabled=eq.true&or=(sent_for_month.is.null,sent_for_month.neq.${period.date})`,
      { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ sent_for_month: period.date }) },
    );
    if (!claim.ok || (await claim.json()).length !== 1) { skipped++; continue; }

    const release = (permanent: boolean) =>
      rest(`monthly_report_preferences?user_id=eq.${q(userId)}&sent_for_month=eq.${period.date}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ sent_for_month: preference.sent_for_month, ...(permanent ? { failed_for_month: period.date } : {}) }),
      }).catch(() => undefined);

    let capRefused = false;
    const delivery = await deliverReport(userId, period, { now, tg, email, connector }, async () => {
      if (emailCapHit) { capRefused = true; return false; }
      const allowed = await takeQuota("email:global", email?.dailyCap ?? 400);
      if (!allowed) { emailCapHit = true; capRefused = true; }
      return allowed;
    });

    if (delivery.ok) {
      sent++;
      if (delivery.channel) byChannel[delivery.channel]++;
      await recordDelivery(userId, period, delivery, now, { resend_count: 0 });
      continue;
    }
    if (delivery.reason === "no_channel") { skipped++; continue; } // no Telegram and no confirmed email: nothing to send to
    if (capRefused) { await release(false); skipped++; continue; }  // not a failure: it goes out tomorrow

    failed++;
    await release(delivery.permanent === true);
    await recordDelivery(userId, period, delivery, now, { resend_count: 0 });
    if (delivery.stop) {
      stopped = "The mail account could not be reached or logged in to. Stopped to protect the account. Run the admin email test.";
      break;
    }
  }
  if (emailCapHit && !stopped) stopped = "The daily email limit was reached. The rest will be sent tomorrow.";
  return reply({ reportMonth: period.key, sent, skipped, failed, byChannel, ...(stopped ? { stopped } : {}) });
}
