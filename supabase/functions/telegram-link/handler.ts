// What the website's "Connect Telegram" card talks to. Signed-in users only; each person can only ever see and
// change their OWN connection.
//
//   {action: "create"}  -> a one-time code and a t.me link that opens the bot with the code filled in
//   {action: "status"}  -> {linked: true/false}
//   {action: "unlink"}  -> disconnects this account's Telegram chat

import { dailyLimit, env, json, preflight, requireUser, sha256Hex, takeQuota } from "../_shared/guard.ts";
import { q, rest } from "../_shared/db.ts";
import { newLinkCode } from "../_shared/telegram.ts";

const CODE_LIFETIME_SECONDS = 600;

export async function handle(request: Request): Promise<Response> {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== "POST") return json(request, { error: "Use POST." }, 405);

  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  let action: unknown;
  try {
    action = (await request.json())?.action;
  } catch (_error) {
    return json(request, { error: "Bad request." }, 400);
  }

  try {
    if (action === "status") {
      const response = await rest(`telegram_links?select=linked_at&user_id=eq.${q(auth.userId)}`);
      if (!response.ok) throw new Error(`status ${response.status}`);
      const row = (await response.json())[0];
      return json(request, { linked: Boolean(row), linkedAt: row?.linked_at ?? null });
    }

    if (action === "unlink") {
      const response = await rest(`telegram_links?user_id=eq.${q(auth.userId)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(`status ${response.status}`);
      return json(request, { linked: false });
    }

    if (action === "create") {
      const bot = (env("TELEGRAM_BOT_USERNAME") ?? "").replace(/^@/, "");
      const secret = env("TELEGRAM_WEBHOOK_SECRET") ?? "";
      if (!/^[A-Za-z0-9_]{5,32}$/.test(bot) || secret.length < 24) {
        console.error("telegram-link: TELEGRAM_BOT_USERNAME or TELEGRAM_WEBHOOK_SECRET is missing");
        return json(request, { error: "Telegram is not set up yet. Ask the administrator." }, 503);
      }
      if (!(await takeQuota(`tg-code:${auth.userId}`, dailyLimit("TELEGRAM_CODES_PER_DAY", 10)))) {
        return json(request, { error: "Too many codes today. Try again tomorrow." }, 429);
      }
      const code = newLinkCode();
      const hash = await sha256Hex(`${secret}:${code}`); // only the hash is stored: a database leak can't be used to link
      await rest(`telegram_link_codes?user_id=eq.${q(auth.userId)}`, { method: "DELETE" }); // a new code replaces older ones
      const saved = await rest("telegram_link_codes", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ code_hash: hash, user_id: auth.userId, expires_at: new Date(Date.now() + CODE_LIFETIME_SECONDS * 1000).toISOString() }),
      });
      if (!saved.ok) throw new Error(`status ${saved.status}`);
      return json(request, { code, link: `https://t.me/${bot}?start=${code}`, expiresInSeconds: CODE_LIFETIME_SECONDS });
    }
  } catch (error) {
    console.error("telegram-link failed", error instanceof Error ? error.message : "unknown");
    return json(request, { error: "Could not reach the database. Run the latest supabase-schema.sql and try again." }, 503);
  }
  return json(request, { error: "Bad request." }, 400);
}
