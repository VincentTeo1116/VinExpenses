// Runs from the database scheduler (pg_cron) every hour. On the first day of the month (Kuala Lumpur time) it emails
// last month's summary to every user who turned reports on AND confirmed the address.
//
// Safety properties:
//   - only the scheduler can start it: a secret header, compared in constant time;
//   - only CONFIRMED addresses are ever emailed (verified_email must equal the current recipient_email);
//   - each user is "claimed" in the database before sending, so two overlapping runs can never send twice;
//   - at most BATCH emails per run and EMAIL_DAILY_CAP per day, so the Gmail account is never pushed past its limit;
//   - every email carries a one-click unsubscribe;
//   - if Gmail rejects the login, the run stops at once instead of retrying (repeated bad logins can lock the account).

import { dailyLimit, env, safeEqual, takeQuota } from "../_shared/guard.ts";
import { fetchAll, q, rest } from "../_shared/db.ts";
import { signToken } from "../_shared/email-tokens.ts";
import { loadEmailSetup } from "../_shared/email-setup.ts";
import { reportEmail } from "../_shared/email-templates.ts";
import { normalizeEmail, sendEmail } from "../_shared/mailer.ts";
import { type Connector, denoConnector } from "../_shared/smtp.ts";

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

/** The month being reported (the previous one) and the UTC instants that bound it in Kuala Lumpur time (UTC+8). */
export function reportWindow(year: number, month: number) {
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

interface Preference {
  user_id: string;
  recipient_email: string;
  verified_email: string | null;
  sent_for_month: string | null;
}

export async function handle(request: Request, now = new Date(), connector: Connector = denoConnector): Promise<Response> {
  if (request.method !== "POST") return reply({ error: "Use POST." }, 405);

  const cronSecret = env("MONTHLY_REPORT_CRON_SECRET") ?? "";
  if (cronSecret.length < 24) {
    console.error("monthly-report-email: MONTHLY_REPORT_CRON_SECRET is missing or shorter than 24 characters");
    return reply({ error: "Not configured." }, 503);
  }
  if (!safeEqual(request.headers.get("x-cron-secret") ?? "", cronSecret)) return reply({ error: "Unauthorized" }, 401);

  const kl = monthInKualaLumpur(now);
  if (kl.day !== "01") return reply({ message: "Reports only run on the first day in Kuala Lumpur." });

  const setup = loadEmailSetup();
  if (typeof setup === "string") {
    console.error("monthly-report-email: email service is not set up:", setup);
    return reply({ error: "Email service is not set up." }, 503);
  }

  const period = reportWindow(Number(kl.year), Number(kl.month));
  const batch = Math.min(dailyLimit("MONTHLY_REPORT_BATCH", 25), 100);

  let preferences: Preference[];
  try {
    const notDone = `and=(or(sent_for_month.is.null,sent_for_month.neq.${period.date}),or(failed_for_month.is.null,failed_for_month.neq.${period.date}))`;
    const response = await rest(
      `monthly_report_preferences?select=user_id,recipient_email,verified_email,sent_for_month&enabled=eq.true&verified_email=not.is.null&${notDone}&order=user_id.asc&limit=${batch}`,
    );
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

  for (const preference of preferences) {
    const userId = String(preference.user_id);
    const address = normalizeEmail(preference.verified_email);
    // The address must still be the one the person confirmed. Anything else is skipped, never emailed.
    if (!address || normalizeEmail(preference.recipient_email) !== address) { skipped++; continue; }

    // Claim this user for this month before doing any work (a second overlapping run will find nothing to claim).
    const claim = await rest(
      `monthly_report_preferences?user_id=eq.${q(userId)}&enabled=eq.true&verified_email=eq.${q(address)}&or=(sent_for_month.is.null,sent_for_month.neq.${period.date})`,
      { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ sent_for_month: period.date }) },
    );
    if (!claim.ok || (await claim.json()).length !== 1) { skipped++; continue; }

    const release = (permanent: boolean) =>
      rest(`monthly_report_preferences?user_id=eq.${q(userId)}&sent_for_month=eq.${period.date}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ sent_for_month: preference.sent_for_month, ...(permanent ? { failed_for_month: period.date } : {}) }),
      }).catch(() => undefined);

    if (!(await takeQuota("email:global", setup.dailyCap))) {
      await release(false);
      stopped = "The daily email limit was reached. The rest will be sent tomorrow.";
      break;
    }

    try {
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
      });
      const result = await sendEmail(setup.mail, {
        to: address,
        ...rendered,
        headers: {
          "List-Unsubscribe": `<${setup.functionsUrl}/email-action?a=unsub&t=${unsubToken}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          "Auto-Submitted": "auto-generated",
        },
      }, connector);

      if (result.ok) { sent++; continue; }
      failed++;
      console.error(`monthly-report-email: send failed at stage ${result.stage} (code ${result.code})`);
      await release(!result.retryable);
      if (result.stage === "auth" || result.stage === "connect") {
        stopped = "The mail account could not be reached or logged in to. Stopped to protect the account. Run the admin email test.";
        break;
      }
    } catch (error) {
      failed++;
      console.error("monthly-report-email: user failed", error instanceof Error ? error.message : "unknown");
      await release(false);
    }
  }
  return reply({ reportMonth: period.key, sent, skipped, failed, ...(stopped ? { stopped } : {}) });
}
