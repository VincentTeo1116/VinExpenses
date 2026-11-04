// Handles the two links inside our emails: "confirm this address" and "unsubscribe".
// No sign-in is needed (the person is clicking from their inbox), so the SIGNED TOKEN is the only credential:
// it cannot be forged, expires, says exactly what it allows, and is tied to one account and one address.
//
//   POST {action, token}  JSON, from the website's email-action page (the person presses a button)
//   POST ?a=unsub&t=...   form body "List-Unsubscribe=One-Click" (the Unsubscribe button of Gmail, Apple Mail, Outlook)
//   GET  ?a=...&t=...     only redirects to the website page. A GET never changes anything, because mail scanners
//                         open every link in a message, and that must not confirm or unsubscribe anyone.

import { env, json, preflight } from "../_shared/guard.ts";
import { q, rest } from "../_shared/db.ts";
import { verifyToken } from "../_shared/email-tokens.ts";
import { cleanSiteUrl } from "../_shared/email-setup.ts";
import { normalizeEmail } from "../_shared/mailer.ts";

const MAX_BODY = 4096;
const BAD_LINK = "This link is invalid or has expired. Request a new one from the app.";

type Outcome = { ok: boolean; message: string };

async function doConfirm(secret: string, token: string): Promise<Outcome> {
  const claim = await verifyToken(secret, token, "verify");
  if (!claim) return { ok: false, message: BAD_LINK };
  const lookup = await rest(`monthly_report_preferences?select=recipient_email&user_id=eq.${q(claim.userId)}`);
  if (!lookup.ok) return { ok: false, message: "Something went wrong. Try again in a minute." };
  const row = (await lookup.json())[0];
  if (!row || normalizeEmail(row.recipient_email) !== claim.email) {
    return { ok: false, message: "This address is no longer the one on the account. Request a new confirmation from the app." };
  }
  // The exact stored value in the filter means a change made a moment ago cannot slip through.
  const update = await rest(
    `monthly_report_preferences?user_id=eq.${q(claim.userId)}&recipient_email=eq.${q(row.recipient_email)}`,
    { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ verified_email: claim.email, verified_at: new Date().toISOString() }) },
  );
  if (!update.ok || (await update.json()).length !== 1) {
    return { ok: false, message: "This address changed while confirming. Request a new confirmation from the app." };
  }
  return { ok: true, message: "Thank you. This address is confirmed and monthly reports can be sent to it." };
}

async function doUnsubscribe(secret: string, token: string): Promise<Outcome> {
  const claim = await verifyToken(secret, token, "unsub");
  if (!claim) return { ok: false, message: BAD_LINK };
  // Switches reports off only while the confirmed address is still the one in the link. Repeating it is harmless.
  const update = await rest(
    `monthly_report_preferences?user_id=eq.${q(claim.userId)}&verified_email=eq.${q(claim.email)}`,
    { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ enabled: false }) },
  );
  if (!update.ok) return { ok: false, message: "Something went wrong. Try again in a minute." };
  return { ok: true, message: "You are unsubscribed. No more VinExpenses reports will be sent to this address." };
}

function plain(status: number, text: string): Response {
  return new Response(text, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" },
  });
}

export async function handle(request: Request): Promise<Response> {
  const early = preflight(request);
  if (early) return early;

  const secret = env("EMAIL_TOKEN_SECRET") ?? "";
  if (secret.length < 32) {
    console.error("email-action: EMAIL_TOKEN_SECRET is not set");
    return json(request, { ok: false, message: "This service is not set up yet." }, 503);
  }
  const url = new URL(request.url);

  if (request.method === "GET") {
    const action = url.searchParams.get("a");
    const token = url.searchParams.get("t") ?? "";
    const site = cleanSiteUrl(env("SITE_URL"));
    if (!site || (action !== "confirm" && action !== "unsub") || !/^[A-Za-z0-9_.-]{10,700}$/.test(token)) return plain(400, "Invalid link.");
    return new Response(null, {
      status: 302,
      headers: { Location: `${site}/email-action.html#a=${action}&t=${token}`, "Referrer-Policy": "no-referrer", "Cache-Control": "no-store" },
    });
  }

  if (request.method !== "POST") return json(request, { ok: false, message: "Use POST." }, 405);

  let text: string;
  try {
    text = await request.text();
  } catch (_error) {
    return json(request, { ok: false, message: BAD_LINK }, 400);
  }
  if (text.length > MAX_BODY) return json(request, { ok: false, message: BAD_LINK }, 413);

  let action = "";
  let token = "";
  const type = (request.headers.get("content-type") ?? "").toLowerCase();
  if (type.includes("application/json")) {
    try {
      const body = JSON.parse(text);
      action = String(body?.action ?? "");
      token = String(body?.token ?? "");
    } catch (_error) {
      return json(request, { ok: false, message: BAD_LINK }, 400);
    }
  } else if (type.includes("application/x-www-form-urlencoded") && new URLSearchParams(text).get("List-Unsubscribe") === "One-Click") {
    action = url.searchParams.get("a") ?? ""; // RFC 8058 one-click: the link carries the token, the body carries the marker
    token = url.searchParams.get("t") ?? "";
    if (action !== "unsub") return json(request, { ok: false, message: BAD_LINK }, 400);
  } else {
    return json(request, { ok: false, message: BAD_LINK }, 400);
  }

  try {
    const result: Outcome = action === "confirm" ? await doConfirm(secret, token)
      : action === "unsub" ? await doUnsubscribe(secret, token)
      : { ok: false, message: BAD_LINK };
    return json(request, result, result.ok ? 200 : 400);
  } catch (error) {
    console.error("email-action failed", error instanceof Error ? error.message : "unknown");
    return json(request, { ok: false, message: "Something went wrong. Try again in a minute." }, 500);
  }
}
