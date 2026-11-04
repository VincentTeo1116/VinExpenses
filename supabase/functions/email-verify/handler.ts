// "Send me a confirmation email": proves a person controls the address they want reports sent to.
// Without this, anyone could type a stranger's address and make this app email that stranger.
//
// Signed-in users only. Limits: 3 confirmation emails per user per day, 2 per destination address per day
// (so one person cannot flood somebody else's inbox), and the app-wide daily cap that protects the Gmail account.

import { json, preflight, requireUser, safeEqual, sha256Hex, takeQuota } from "../_shared/guard.ts";
import { q, rest } from "../_shared/db.ts";
import { signToken } from "../_shared/email-tokens.ts";
import { loadEmailSetup } from "../_shared/email-setup.ts";
import { confirmEmail } from "../_shared/email-templates.ts";
import { normalizeEmail, sendEmail } from "../_shared/mailer.ts";
import { type Connector, denoConnector } from "../_shared/smtp.ts";

export async function handle(request: Request, connector: Connector = denoConnector): Promise<Response> {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== "POST") return json(request, { error: "Use POST." }, 405);

  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  const setup = loadEmailSetup();
  if (typeof setup === "string") {
    console.error("email-verify: email service is not set up:", setup);
    return json(request, { error: "Email sending is not set up yet. Ask the administrator." }, 503);
  }

  let row: { recipient_email?: string; verified_email?: string | null } | undefined;
  try {
    const response = await rest(`monthly_report_preferences?select=recipient_email,verified_email&user_id=eq.${q(auth.userId)}`);
    if (!response.ok) throw new Error(`status ${response.status}`);
    row = (await response.json())[0];
  } catch (error) {
    console.error("email-verify: could not read the preference", error instanceof Error ? error.message : "unknown");
    return json(request, { error: "Could not read your settings. Run the latest supabase-schema.sql and try again." }, 503);
  }

  const address = normalizeEmail(row?.recipient_email);
  if (!row || !address) return json(request, { error: "Save a valid report email address first." }, 400);
  if (row.verified_email && safeEqual(row.verified_email, address)) return json(request, { status: "verified" });

  const allowed =
    (await takeQuota(`verify-user:${auth.userId}`, 3)) &&
    (await takeQuota(`verify-to:${await sha256Hex(address)}`, 2)) &&
    (await takeQuota("email:global", setup.dailyCap));
  if (!allowed) return json(request, { error: "Too many confirmation emails today. Try again tomorrow." }, 429);

  const token = await signToken(setup.tokenSecret, "verify", auth.userId, address, 48 * 3600);
  const rendered = confirmEmail(`${setup.siteUrl}/email-action.html#a=confirm&t=${token}`, address);
  const result = await sendEmail(setup.mail, { to: address, ...rendered, headers: { "Auto-Submitted": "auto-generated" } }, connector);
  if (!result.ok) {
    console.error(`email-verify: send failed at stage ${result.stage} (code ${result.code})`);
    return json(request, { error: "Could not send the email right now. Try again later." }, 502);
  }
  return json(request, { status: "sent" });
}
