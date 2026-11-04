// Sends email through Gmail SMTP (smtp.gmail.com, port 465, encrypted from the first byte).
//
// One-time Gmail setup (the account that will be the sender):
//   1. Turn on 2-Step Verification:  https://myaccount.google.com/security
//   2. Create an App Password:       https://myaccount.google.com/apppasswords   (16 characters)
//   3. Store them as Supabase secrets:  SMTP_USER=you@gmail.com   SMTP_PASS=<the 16-character app password>
// Never use your normal Gmail password here, and never put either value in the website code or in GitHub.
//
// Gmail always sends "From" the authenticated account, and limits a normal account to about 500 recipients per day
// (a Google Workspace account about 2,000). EMAIL_DAILY_CAP (default 400) stops the app from reaching that limit.

import { type Connector, denoConnector, SmtpError, type SmtpStage, sendSmtp } from "./smtp.ts";

export interface MailConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  fromName: string;
}

export interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Only List-Unsubscribe, List-Unsubscribe-Post and Auto-Submitted are accepted. */
  headers?: Record<string, string>;
}

export type SendResult =
  | { ok: true }
  | { ok: false; stage: SmtpStage; code: number; retryable: boolean; reason: string };

const LOCAL_PART = /^[a-z0-9]+(?:[._%+'-][a-z0-9]+)*$/;
const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const MAX_BODY = 200_000;

/** A strictly validated, lower-cased address, or null. Rejects anything unusual rather than trying to repair it. */
export function normalizeEmail(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const value = input.trim().toLowerCase();
  if (value.length < 6 || value.length > 254) return null;
  const parts = value.split("@");
  if (parts.length !== 2) return null;
  const [local, domain] = parts;
  if (local.length < 1 || local.length > 64 || !LOCAL_PART.test(local)) return null;
  if (domain.length > 253) return null;
  const labels = domain.split(".");
  if (labels.length < 2 || !labels.every((label) => DOMAIN_LABEL.test(label))) return null;
  if (!/^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/.test(labels[labels.length - 1])) return null; // not an IP address
  return value;
}

/** Removes anything that could end a header line. Used on every value that goes into a header or subject. */
export function singleLine(value: unknown, max = 200): string {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * Reads the mail settings. Returns an error MESSAGE (for the logs and the admin test only, never for ordinary users)
 * when something is missing or unsafe.
 */
export function loadMailConfig(get: (name: string) => string | undefined): MailConfig | string {
  const user = normalizeEmail(get("SMTP_USER"));
  if (!user) return "SMTP_USER is missing or is not a valid email address (use the Gmail address that sends the mail).";
  const pass = (get("SMTP_PASS") ?? "").replace(/\s+/g, ""); // Google shows app passwords in groups of four
  if (!pass) return "SMTP_PASS is missing (create a Google App Password and store it as this secret).";
  if (pass.length < 8 || pass.length > 128 || /[^\x21-\x7e]/.test(pass)) return "SMTP_PASS does not look like an app password (16 letters, no other characters).";
  const host = (get("SMTP_HOST") || "smtp.gmail.com").trim().toLowerCase();
  if (!/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/.test(host) || host.length > 253) return "SMTP_HOST is not a valid server name.";
  const port = Number(get("SMTP_PORT") || 465);
  if (port !== 465) return "SMTP_PORT must be 465: Supabase blocks ports 25 and 587, and 465 is encrypted from the start.";
  const fromName = singleLine(get("EMAIL_FROM_NAME") || "VinExpenses", 60).replace(/["<>\\]/g, "") || "VinExpenses";
  return { host, port, user, pass, fromName };
}

const HINTS: Record<string, string> = {
  connect: "Could not reach the mail server. Check SMTP_HOST, and that the function can make outgoing connections on port 465.",
  greeting: "The mail server did not greet us correctly. Check SMTP_HOST.",
  hello: "The mail server refused the introduction. Check SMTP_HOST.",
  auth: "Gmail rejected the login. Check SMTP_USER, create a NEW App Password (2-Step Verification must be on), and paste it into SMTP_PASS.",
  sender: "Gmail refused the sender address. SMTP_USER must be the Gmail account that owns the App Password.",
  recipient: "The recipient address was refused by the mail server.",
  data: "The mail server refused to accept the message.",
  send: "The mail server did not accept the message (it may be too large, or the daily sending limit was reached).",
  build: "The message was rejected before sending because it contained something unsafe.",
};

export function hintFor(stage: SmtpStage, code: number): string {
  if (stage === "send" && (code === 550 || code === 552 || code === 421 || code === 454)) {
    return "Gmail's sending limit may have been reached for today. Try again tomorrow, or lower EMAIL_DAILY_CAP.";
  }
  return HINTS[stage] ?? "Unknown problem.";
}

/** Checks and cleans a message. Throws on anything that should never be sent. */
export function prepareMail(mail: Mail): Mail {
  const to = normalizeEmail(mail.to);
  if (!to) throw new SmtpError("build", 0, "Invalid recipient address.");
  const subject = singleLine(mail.subject, 200);
  if (!subject) throw new SmtpError("build", 0, "Empty subject.");
  if (typeof mail.html !== "string" || !mail.html || mail.html.length > MAX_BODY) throw new SmtpError("build", 0, "Invalid HTML body.");
  if (typeof mail.text !== "string" || !mail.text || mail.text.length > MAX_BODY) throw new SmtpError("build", 0, "Invalid text body.");
  const headers: Record<string, string> = {};
  for (const [name, raw] of Object.entries(mail.headers ?? {})) {
    const lower = name.toLowerCase();
    if (!["list-unsubscribe", "list-unsubscribe-post", "auto-submitted"].includes(lower)) throw new SmtpError("build", 0, `Header not allowed: ${name}`);
    const clean = singleLine(raw, 900);
    if (clean !== String(raw).trim()) throw new SmtpError("build", 0, `Header contains control characters or is too long: ${name}`);
    if (lower === "list-unsubscribe" && !/^<https:\/\/[^<>\s]+>$/.test(clean)) throw new SmtpError("build", 0, "List-Unsubscribe must be one https link.");
    headers[name] = clean;
  }
  return { to, subject, html: mail.html, text: mail.text, headers };
}

/** Never throws for mail-server problems; never logs message content, addresses or the password. */
export async function sendEmail(config: MailConfig, mail: Mail, connector: Connector = denoConnector): Promise<SendResult> {
  try {
    const prepared = prepareMail(mail);
    await sendSmtp(
      { host: config.host, port: config.port, user: config.user, pass: config.pass },
      {
        fromAddress: config.user,
        fromName: config.fromName,
        to: prepared.to,
        subject: prepared.subject,
        text: prepared.text,
        html: prepared.html,
        headers: prepared.headers,
      },
      connector,
    );
    return { ok: true };
  } catch (error) {
    if (error instanceof SmtpError) {
      return { ok: false, stage: error.stage, code: error.code, retryable: error.retryable, reason: hintFor(error.stage, error.code) };
    }
    return { ok: false, stage: "send", code: 0, retryable: true, reason: "Unexpected error while sending." };
  }
}
