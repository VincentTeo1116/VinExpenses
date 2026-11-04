// The administrator's one tool: "is the email service working right now?"
//
//   {action: "status"}     -> are you an administrator, and which settings are in place (yes/no only, never the values)
//   {action: "send_test"}  -> really sends a test message through Gmail to the administrator's OWN address and reports
//                             exactly where it stopped if it fails (connect, login, sender, recipient, delivery)
//
// Who is the administrator?
//   - Anyone listed in the app_admins table (see supabase-schema.sql).
//   - Bootstrap: while that table is EMPTY, the one person who is signed in with a CONFIRMED email equal to the
//     ADMIN_EMAIL secret is registered as the first administrator, automatically, on their first call. The database
//     refuses to register anyone else afterwards, so ADMIN_EMAIL cannot be used to add a second administrator.
//   - Everybody else gets the same plain "not allowed" answer, whatever the reason.
//
// The test message can only go to the administrator's own login address, so this cannot be used to email strangers.

import { env, json, preflight, projectAccess, requireUser, takeQuota } from "../_shared/guard.ts";
import { q, rest } from "../_shared/db.ts";
import { signToken, verifyToken } from "../_shared/email-tokens.ts";
import { cleanSiteUrl } from "../_shared/email-setup.ts";
import { adminTestEmail } from "../_shared/email-templates.ts";
import { loadMailConfig, normalizeEmail, sendEmail } from "../_shared/mailer.ts";
import { type Connector, denoConnector } from "../_shared/smtp.ts";

const DENIED = "You are not allowed to do this.";

async function isAdmin(userId: string): Promise<boolean> {
  const response = await rest(`app_admins?select=user_id&user_id=eq.${q(userId)}`);
  if (!response.ok) throw new Error(`app_admins lookup failed (${response.status}). Has supabase-schema.sql been run?`);
  return (await response.json()).length === 1;
}

/** Registers the first administrator. The database function re-checks everything and only ever succeeds once. */
async function claimFirstAdmin(userId: string, email: string): Promise<boolean> {
  const adminEmail = normalizeEmail(env("ADMIN_EMAIL"));
  if (!adminEmail || adminEmail !== email) return false;
  const response = await rest("rpc/claim_first_admin", { method: "POST", body: JSON.stringify({ p_user: userId, p_email: email }) });
  return response.ok && (await response.json()) === true;
}

async function configurationChecks(): Promise<Record<string, boolean>> {
  const mail = loadMailConfig(env);
  let tokensWork = false;
  try {
    const secret = env("EMAIL_TOKEN_SECRET") ?? "";
    const probe = await signToken(secret, "verify", "00000000-0000-4000-8000-000000000000", "probe@example.com", 60);
    tokensWork = (await verifyToken(secret, probe, "verify")) !== null;
  } catch (_error) {
    tokensWork = false;
  }
  return {
    "Gmail account and App Password (SMTP_USER, SMTP_PASS)": typeof mail !== "string",
    "Link-signing secret (EMAIL_TOKEN_SECRET)": tokensWork,
    "Website address (SITE_URL)": cleanSiteUrl(env("SITE_URL")) !== null,
    "Allowed website list (ALLOWED_ORIGINS)": (env("ALLOWED_ORIGINS") ?? "").trim().length > 0,
    "Scheduler password (MONTHLY_REPORT_CRON_SECRET)": (env("MONTHLY_REPORT_CRON_SECRET") ?? "").length >= 24,
    "Database access": projectAccess() !== null,
  };
}

export async function handle(request: Request, connector: Connector = denoConnector): Promise<Response> {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== "POST") return json(request, { error: "Use POST." }, 405);

  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  let body: { action?: unknown } = {};
  try {
    body = await request.json();
  } catch (_error) {
    return json(request, { error: "Bad request." }, 400);
  }
  const action = body?.action;
  if (action !== "status" && action !== "send_test") return json(request, { error: "Bad request." }, 400);

  let admin = false;
  let justCreated = false;
  try {
    admin = await isAdmin(auth.userId);
    if (!admin && auth.emailConfirmed && auth.email) {
      admin = await claimFirstAdmin(auth.userId, auth.email);
      justCreated = admin;
    }
  } catch (error) {
    console.error("admin-email-test:", error instanceof Error ? error.message : "unknown");
    return json(request, { error: "Could not check administrator access." }, 503);
  }

  if (!admin) {
    // The website calls "status" for every signed-in person, so for them this is a normal answer, not an error.
    return action === "status" ? json(request, { admin: false }) : json(request, { error: DENIED }, 403);
  }

  const checks = await configurationChecks();
  if (action === "status") return json(request, { admin: true, justCreated, checks });

  if (!(await takeQuota(`admin-test:${auth.userId}`, 10))) {
    return json(request, { error: "Test limit reached for today (10). Try again tomorrow." }, 429);
  }
  const mail = loadMailConfig(env);
  if (typeof mail === "string") return json(request, { admin: true, ok: false, stage: "config", reason: mail, checks });
  const recipient = normalizeEmail(auth.email);
  if (!recipient) return json(request, { admin: true, ok: false, stage: "recipient", reason: "Your account has no valid email address.", checks });

  const started = Date.now();
  const rendered = adminTestEmail(new Date().toISOString(), checks);
  const result = await sendEmail(mail, { to: recipient, ...rendered, headers: { "Auto-Submitted": "auto-generated" } }, connector);
  const elapsedMs = Date.now() - started;
  if (result.ok) return json(request, { admin: true, ok: true, stage: "delivered", sentTo: recipient, elapsedMs, checks });
  console.error(`admin-email-test: failed at stage ${result.stage} (code ${result.code})`);
  return json(request, { admin: true, ok: false, stage: result.stage, code: result.code, reason: result.reason, elapsedMs, checks });
}
