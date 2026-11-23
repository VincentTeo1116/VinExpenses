// The contact form. It works for people who can't sign in too, so it is protected by limits and the security check instead of a login.

import { callerKey, env, json, preflight, projectAccess, sha256Hex, takeQuota } from "../_shared/guard.ts";
import { rest } from "../_shared/db.ts";
import { cleanEmail } from "../_shared/auth-rules.ts";
import { loadEmailSetup } from "../_shared/email-setup.ts";
import { emailLayout, escapeHtml } from "../_shared/email-templates.ts";
import { normalizeEmail, sendEmail } from "../_shared/mailer.ts";
import { type Connector, denoConnector } from "../_shared/smtp.ts";

const TOPICS: Record<string, string> = {
  locked_out: "Locked out", code_limit: "Code limit reached", report: "Report not received", bug: "Something is broken", other: "Something else",
};

/** Asks Cloudflare whether the security check was really passed. Only used when a secret key is set. */
async function captchaPassed(token: unknown, fetchImpl: typeof fetch): Promise<boolean> {
  const secret = env("TURNSTILE_SECRET_KEY") ?? "";
  if (!secret) return true; // the check is not switched on for this project
  if (typeof token !== "string" || !token || token.length > 4000) return false;
  try {
    const response = await fetchImpl("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token }),
      signal: AbortSignal.timeout(8000),
    });
    return response.ok && (await response.json())?.success === true;
  } catch (_error) {
    return false;
  }
}

/** The signed-in person, if the request carries a real sign-in. Being signed out is fine here. */
async function optionalUser(request: Request): Promise<{ id: string; email: string } | null> {
  const access = projectAccess();
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!access || !token || token.length > 4096) return null;
  try {
    const response = await fetch(`${access.url}/auth/v1/user`, { headers: { apikey: access.serviceKey, Authorization: `Bearer ${token}` } });
    if (!response.ok) return null;
    const user = await response.json();
    return user?.id ? { id: String(user.id), email: cleanEmail(user.email) } : null;
  } catch (_error) {
    return null;
  }
}

export async function handle(request: Request, connector: Connector = denoConnector, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== "POST") return json(request, { error: "Use POST." }, 405);
  if (!request.headers.get("origin")) return json(request, { error: "This website is not allowed to use this service." }, 403);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
    if (!body || typeof body !== "object") throw new Error("bad");
  } catch (_error) {
    return json(request, { error: "Bad request." }, 400);
  }

  const user = await optionalUser(request);
  const email = user?.email || cleanEmail(body.email);
  const topic = typeof body.topic === "string" && body.topic in TOPICS ? body.topic : "";
  const message = String(body.message ?? "").replace(/\r\n/g, "\n").trim();
  if (!email) return json(request, { ok: false, field: "email", message: "Enter the email address we can reply to." });
  if (!topic) return json(request, { ok: false, field: "topic", message: "Choose what this is about." });
  if (message.length < 5) return json(request, { ok: false, field: "message", message: "Please tell us a little more (at least 5 characters)." });
  if (message.length > 2000) return json(request, { ok: false, field: "message", message: "Please keep it under 2,000 characters." });

  if (!(await captchaPassed(body.captcha, fetchImpl))) return json(request, { ok: false, field: "captcha", message: "The security check did not pass. Please try again." });

  // Limits: per network, per email address, and for the whole app, so the inbox can't be flooded.
  const ip = await callerKey(request);
  const emailKey = (await sha256Hex(email)).slice(0, 24);
  if ((ip && !(await takeQuota(`feedback-ip:${ip}`, 5))) || !(await takeQuota(`feedback-email:${emailKey}`, 5))) {
    return json(request, { ok: false, message: "You have sent several messages today. Please email the admin if it is urgent." });
  }
  if (!(await takeQuota("feedback:global", 200))) return json(request, { ok: false, message: "The form is busy today. Please email the admin instead." });

  const saved = await rest("feedback", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ user_id: user?.id ?? null, email, topic, message }) });
  if (!saved.ok) {
    console.error("feedback: could not save, status", saved.status);
    return json(request, { ok: false, message: "Your message could not be saved. Please email the admin instead." });
  }

  // Tell the admin by email too. Best effort: the message is already in the inbox on the admin screen.
  try {
    const setup = loadEmailSetup();
    const admin = normalizeEmail(env("ADMIN_EMAIL"));
    if (typeof setup !== "string" && admin && (await takeQuota("feedback-notify", 50))) {
      await sendEmail(setup.mail, {
        to: admin,
        subject: `VinExpenses feedback: ${TOPICS[topic]}`,
        html: emailLayout({
          preheader: `New message from ${email}`, eyebrow: "Feedback", title: TOPICS[topic],
          body: `<p style="margin:0 0 14px">From <strong>${escapeHtml(email)}</strong>${user ? " (signed in)" : " (not signed in: the address is not verified)"}</p><p style="margin:0;white-space:pre-wrap">${escapeHtml(message)}</p>`,
          footer: "Sent from the VinExpenses contact form. Open the admin screen to mark it resolved.",
        }),
        text: `VinExpenses feedback: ${TOPICS[topic]}\nFrom: ${email}${user ? " (signed in)" : " (not signed in)"}\n\n${message}`,
        headers: { "Auto-Submitted": "auto-generated" },
      }, connector);
    }
  } catch (_error) { /* the saved message is what matters */ }

  return json(request, { ok: true, message: "Thank you. Your message was sent, and the admin will reply by email." });
}
