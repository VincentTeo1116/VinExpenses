// Gathers and checks the email settings in one place (the secrets are listed in the README).

import { dailyLimit, env, projectAccess } from "./guard.ts";
import { loadMailConfig, type MailConfig } from "./mailer.ts";

export interface EmailSetup {
  mail: MailConfig;
  tokenSecret: string;
  siteUrl: string; // no trailing slash
  functionsUrl: string; // https://<ref>.supabase.co/functions/v1
  dailyCap: number;
}

/** A clean https address with no query or fragment, or null. */
export function cleanSiteUrl(value: string | undefined): string | null {
  try {
    const url = new URL((value ?? "").trim());
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch (_error) {
    return null;
  }
}

export function loadEmailSetup(): EmailSetup | string {
  const mail = loadMailConfig(env);
  if (typeof mail === "string") return mail;
  const tokenSecret = env("EMAIL_TOKEN_SECRET") ?? "";
  if (tokenSecret.length < 32) return "EMAIL_TOKEN_SECRET must be at least 32 random characters.";
  const siteUrl = cleanSiteUrl(env("SITE_URL"));
  if (!siteUrl) return "SITE_URL must be your website's https address (for example https://yourname.github.io/VinExpenses).";
  const access = projectAccess();
  if (!access) return "The function has no Supabase URL / service key.";
  const functionsUrl = cleanSiteUrl(`${access.url}/functions/v1`);
  if (!functionsUrl) return "SUPABASE_URL is not an https address.";
  return { mail, tokenSecret, siteUrl, functionsUrl, dailyCap: dailyLimit("EMAIL_DAILY_CAP", 400) };
}
