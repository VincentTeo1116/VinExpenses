// Sends one person's monthly report by Telegram or email, falls back to the other when the first fails, and records the result.

import { env } from "./guard.ts";
import { fetchAll, q, rest } from "./db.ts";
import { signToken } from "./email-tokens.ts";
import { cleanSiteUrl, type EmailSetup } from "./email-setup.ts";
import { reportEmail } from "./email-templates.ts";
import { normalizeEmail, sendEmail } from "./mailer.ts";
import type { Connector } from "./smtp.ts";
import { asLang } from "./tg-i18n.ts";
import { buildView, pagerButtons } from "./tg-views.ts";
import type { TelegramClient } from "./telegram.ts";

export type Channel = "telegram" | "email";
export interface ReportPeriod { key: string; date: string; label: string; start: string; end: string }
export interface Delivery {
  ok: boolean;
  channel: Channel | null;
  /** Why nothing was sent: "no_channel" (no Telegram and no confirmed email), "failed", or "" when it worked. */
  reason: "" | "no_channel" | "failed";
  /** True when sending should not be tried again for this month (for example the address was refused). */
  permanent?: boolean;
  /** The mail account itself is unreachable: the caller should stop the whole run. */
  stop?: boolean;
}

/** The month being reported (the previous one) and the UTC instants that bound it in Kuala Lumpur time (UTC+8). */
export function reportWindow(year: number, month: number): ReportPeriod {
  const first = new Date(Date.UTC(year, month - 2, 1));
  const key = `${first.getUTCFullYear()}-${String(first.getUTCMonth() + 1).padStart(2, "0")}`;
  const eight = 8 * 60 * 60 * 1000;
  return {
    key,
    date: `${key}-01`,
    label: first.toLocaleDateString("en-MY", { month: "long", year: "numeric", timeZone: "UTC" }),
    start: new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1) - eight).toISOString(),
    end: new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1) - eight).toISOString(),
  };
}

/** The report period for a "YYYY-MM" month, or null when the text is not a month. */
export function periodOf(month: string): ReportPeriod | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) return null;
  return reportWindow(Number(match[1]), Number(match[2]) + 1);
}

/** How many months back `period` is from the month of `now` in Kuala Lumpur (0 = this month). */
function monthsBack(period: ReportPeriod, now: Date): number {
  const local = new Date(now.getTime() + 8 * 3600_000);
  const [year, month] = period.key.split("-").map(Number);
  return (local.getUTCFullYear() - year) * 12 + (local.getUTCMonth() + 1 - month);
}

interface Preference { channel?: string | null; recipient_email?: string | null; verified_email?: string | null }
interface Link { chat_id: number; lang?: string | null }

export interface DeliveryTools {
  now: Date;
  tg?: TelegramClient | null;
  email?: EmailSetup | null;
  connector?: Connector;
}

async function byTelegram(userId: string, link: Link, period: ReportPeriod, tools: DeliveryTools): Promise<"ok" | "blocked" | "failed"> {
  if (!tools.tg) return "failed";
  const chatId = Number(link.chat_id);
  if (!Number.isSafeInteger(chatId)) return "failed";
  const offset = monthsBack(period, tools.now);
  if (offset < 0 || offset > 12) return "failed";
  const lang = asLang(link.lang ?? "en");
  const categories = await rest(`user_categories?select=category_key,label&user_id=eq.${q(userId)}`).then(async (r) => (r.ok ? await r.json() : [])).catch(() => []);
  const names = new Map((categories as { category_key: string; label: string }[]).map((c) => [c.category_key, c.label] as const));
  const view = await buildView({ userId, lang, now: tools.now, view: "m", offset, labels: (key) => names.get(key) ?? key });
  const site = cleanSiteUrl(env("SITE_URL"));
  const title = `<b>Your ManaDuit report for ${period.label}</b>\n\n`;
  if (view.kind === "photo" && view.png) {
    const sent = await tools.tg.sendPhotoChecked(chatId, view.png, (title + view.text).slice(0, 1000), { buttons: pagerButtons(lang, "m", offset, { details: true, siteUrl: site }) });
    if (sent !== "failed") return sent;
  }
  return tools.tg.sendChecked(chatId, (title + view.full).slice(0, 3900), { buttons: pagerButtons(lang, "m", offset, { details: false, siteUrl: site }) });
}

async function byEmail(userId: string, address: string, period: ReportPeriod, tools: DeliveryTools): Promise<{ ok: boolean; permanent: boolean; stop: boolean }> {
  const setup = tools.email;
  if (!setup) return { ok: false, permanent: false, stop: false };
  const range = `created_at=gte.${q(period.start)}&created_at=lt.${q(period.end)}`;
  const [expenses, incomes, labelRows] = await Promise.all([
    fetchAll<{ amount: string | number; category: string }>(`expenses?select=amount,category&user_id=eq.${q(userId)}&${range}&order=created_at.asc,id.asc`),
    fetchAll<{ amount: string | number }>(`incomes?select=amount&user_id=eq.${q(userId)}&${range}&order=created_at.asc,id.asc`),
    fetchAll<{ category_key: string; label: string }>(`user_categories?select=category_key,label&user_id=eq.${q(userId)}&order=category_key.asc`).catch(() => []),
  ]);
  const labels = new Map(labelRows.map((row) => [row.category_key, row.label] as const));
  const byCategory = new Map<string, number>();
  let expenseTotal = 0;
  for (const expense of expenses) {
    const amount = Number(expense.amount);
    expenseTotal += amount;
    byCategory.set(expense.category, (byCategory.get(expense.category) ?? 0) + amount);
  }
  const incomeTotal = incomes.reduce((sum, row) => sum + Number(row.amount), 0);
  const unsubToken = await signToken(setup.tokenSecret, "unsub", userId, address, 400 * 24 * 3600);
  const rendered = reportEmail({
    label: period.label,
    incomeTotal,
    expenseTotal,
    expenseCount: expenses.length,
    incomeCount: incomes.length,
    categories: [...byCategory.entries()].sort((a, b) => b[1] - a[1]).map(([key, amount]) => ({ name: labels.get(key) ?? key, amount })),
    unsubscribeUrl: `${setup.siteUrl}/email-action.html#a=unsub&t=${unsubToken}`,
    appUrl: setup.siteUrl,
  });
  const result = await sendEmail(setup.mail, {
    to: address,
    ...rendered,
    headers: {
      "List-Unsubscribe": `<${setup.functionsUrl}/email-action?a=unsub&t=${unsubToken}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      "Auto-Submitted": "auto-generated",
    },
  }, tools.connector);
  if (result.ok) return { ok: true, permanent: false, stop: false };
  console.error(`report-delivery: email failed at stage ${result.stage} (code ${result.code})`);
  return { ok: false, permanent: !result.retryable, stop: result.stage === "auth" || result.stage === "connect" };
}

/** Sends the report for one person and one month. Never throws: a problem becomes { ok: false }. */
export async function deliverReport(userId: string, period: ReportPeriod, tools: DeliveryTools, beforeEmail?: () => Promise<boolean>): Promise<Delivery> {
  try {
    const [prefRows, linkRows] = await Promise.all([
      rest(`monthly_report_preferences?select=*&user_id=eq.${q(userId)}`).then(async (r) => (r.ok ? await r.json() : [])),
      rest(`telegram_links?select=chat_id,lang&user_id=eq.${q(userId)}`).then(async (r) => (r.ok ? await r.json() : [])).catch(() => []),
    ]);
    const pref = ((prefRows as Preference[])[0] ?? {}) as Preference;
    const link = (linkRows as Link[])[0] ?? null;
    const verified = normalizeEmail(pref.verified_email);
    // An email is only ever sent to the address the person confirmed.
    const address = verified && normalizeEmail(pref.recipient_email) === verified ? verified : "";
    const wanted = pref.channel === "email" ? "email" : pref.channel === "telegram" ? "telegram" : "auto";

    const order: Channel[] = [];
    if (wanted !== "email" && link && tools.tg) order.push("telegram");
    if (address && tools.email) order.push("email");
    if (wanted === "email" && !order.includes("email") && link && tools.tg) order.push("telegram"); // nothing confirmed to email to: Telegram is better than silence
    if (!order.length) return { ok: false, channel: null, reason: "no_channel" };

    let last: Delivery = { ok: false, channel: order[0], reason: "failed" };
    for (const channel of order) {
      if (channel === "telegram") {
        const sent = await byTelegram(userId, link!, period, tools).catch(() => "failed" as const);
        if (sent === "ok") return { ok: true, channel, reason: "" };
        last = { ok: false, channel, reason: "failed" };
      } else {
        if (beforeEmail && !(await beforeEmail())) { last = { ok: false, channel, reason: "failed" }; continue; }
        const sent = await byEmail(userId, address, period, tools);
        if (sent.ok) return { ok: true, channel, reason: "" };
        last = { ok: false, channel, reason: "failed", permanent: sent.permanent, stop: sent.stop };
      }
    }
    return last;
  } catch (error) {
    console.error("report-delivery:", error instanceof Error ? error.message : "unknown");
    return { ok: false, channel: null, reason: "failed" };
  }
}

/** Writes the result where the Account screen can show it. Best effort: a failure here never undoes a sent report. */
export async function recordDelivery(userId: string, period: ReportPeriod, delivery: Delivery, now: Date, extra: Record<string, unknown> = {}): Promise<void> {
  await rest(`monthly_report_preferences?user_id=eq.${q(userId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ last_status: delivery.ok ? "sent" : "failed", last_channel: delivery.channel, last_attempt_at: now.toISOString(), last_month: period.date, ...extra }),
  }).catch(() => undefined);
}
