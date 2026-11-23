// "Send again" for the monthly report: the signed-in person can ask twice per report, and it only ever goes to themselves.

import { env, json, preflight, requireUser, takeQuota } from "../_shared/guard.ts";
import { q, rest } from "../_shared/db.ts";
import { loadEmailSetup } from "../_shared/email-setup.ts";
import { deliverReport, periodOf, recordDelivery, reportWindow } from "../_shared/report-delivery.ts";
import { type Connector, denoConnector } from "../_shared/smtp.ts";
import { type TelegramClient, telegramClient } from "../_shared/telegram.ts";

export const MAX_RESENDS = 2;

export async function handle(request: Request, now = new Date(), connector: Connector = denoConnector, tgOverride?: TelegramClient): Promise<Response> {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== "POST") return json(request, { error: "Use POST." }, 405);
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  try {
    const response = await rest(`monthly_report_preferences?select=*&user_id=eq.${q(auth.userId)}`);
    if (!response.ok) throw new Error(`preferences ${response.status}`);
    const pref = ((await response.json()) as Record<string, unknown>[])[0];
    if (!pref || pref.enabled !== true) return json(request, { ok: false, message: "Turn on the monthly report first, then save." });

    // The report in question is last month's (the one the scheduler sends on the 1st).
    const local = new Date(now.getTime() + 8 * 3600_000);
    const period = reportWindow(local.getUTCFullYear(), local.getUTCMonth() + 1);
    const sameReport = typeof pref.last_month === "string" && periodOf(String(pref.last_month).slice(0, 7))?.date === period.date;
    const used = sameReport ? Number(pref.resend_count ?? 0) : 0;
    if (used >= MAX_RESENDS) {
      return json(request, { ok: false, left: 0, message: `This report was already sent again ${MAX_RESENDS} times. If it still hasn't arrived, please contact the admin.` });
    }
    if (!(await takeQuota(`report-resend:${auth.userId}`, 4))) return json(request, { ok: false, left: MAX_RESENDS - used, message: "Please wait until tomorrow before asking again." });

    const setup = loadEmailSetup();
    const token = env("TELEGRAM_BOT_TOKEN") ?? "";
    const email = typeof setup === "string" ? null : setup;
    const delivery = await deliverReport(auth.userId, period, { now, email, tg: tgOverride ?? (token ? telegramClient(token) : null), connector },
      () => takeQuota("email:global", email?.dailyCap ?? 400));
    if (delivery.reason === "no_channel") {
      return json(request, { ok: false, left: MAX_RESENDS - used, message: "There is nowhere to send it yet. Connect Telegram, or confirm your report email address." });
    }
    await recordDelivery(auth.userId, period, delivery, now, { resend_count: used + 1 });
    const left = MAX_RESENDS - used - 1;
    return json(request, delivery.ok
      ? { ok: true, channel: delivery.channel, left, month: period.label, message: `Your ${period.label} report is on its way by ${delivery.channel === "telegram" ? "Telegram" : "email"}. Please allow 15 minutes. If it still hasn't arrived, contact the admin.` }
      : { ok: false, left, message: "The report could not be sent just now. Please try again later, or contact the admin." });
  } catch (error) {
    console.error("report-resend:", error instanceof Error ? error.message : "unknown");
    return json(request, { error: "The report could not be sent. Please try again." }, 503);
  }
}
