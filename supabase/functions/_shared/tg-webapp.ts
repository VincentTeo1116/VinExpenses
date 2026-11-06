// Proves that a request really comes from a person using the Mini App inside Telegram.
//
// When Telegram opens a Mini App it hands the page a string called initData ("query_id=...&user=...&auth_date=...&hash=...").
// The hash is an HMAC signature made with a key derived from YOUR bot token, which only Telegram and your server know.
// So if the signature checks out, the user id inside it is genuine; nobody can invent or change it without the token.
// The page sends this string with every request; this file checks it. It is the only door into the Mini App's data.
//
//   secret = HMAC-SHA256(key = "WebAppData", message = bot token)
//   hash   = HMAC-SHA256(key = secret, message = the other fields as "key=value" lines, sorted, joined by "\n")

import { safeEqual } from "./guard.ts";

export interface WebAppUser {
  id: number;
  first_name: string;
  language_code: string;
}
export type InitDataResult =
  | { ok: true; user: WebAppUser; authDate: number }
  | { ok: false; reason: "missing" | "malformed" | "bad_signature" | "expired" | "no_user" };

const encoder = new TextEncoder();
const MAX_INIT_DATA = 4096;

async function hmac(key: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey("raw", new Uint8Array(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, new Uint8Array(message)));
}
const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

/**
 * Checks initData against the bot token. `maxAgeSeconds` is how old the launch may be (a stolen copy stops working after
 * that). Returns the verified Telegram user, or the reason it was refused (never any detail an attacker could use).
 */
export async function verifyInitData(
  initData: unknown,
  botToken: string,
  now: Date = new Date(),
  maxAgeSeconds = 6 * 3600,
): Promise<InitDataResult> {
  if (typeof initData !== "string" || !initData) return { ok: false, reason: "missing" };
  if (initData.length > MAX_INIT_DATA || !botToken) return { ok: false, reason: "malformed" };

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch (_error) {
    return { ok: false, reason: "malformed" };
  }
  const given = params.get("hash") ?? "";
  if (!/^[0-9a-f]{64}$/.test(given)) return { ok: false, reason: "malformed" };

  // A repeated field would let the same name mean two things: refuse it outright.
  const seen = new Set<string>();
  for (const key of params.keys()) {
    if (seen.has(key)) return { ok: false, reason: "malformed" };
    seen.add(key);
  }

  const secret = await hmac(encoder.encode("WebAppData"), encoder.encode(botToken));
  const check = async (skip: string[]) => {
    const text = [...params.entries()]
      .filter(([key]) => !skip.includes(key))
      .map(([key, value]) => `${key}=${value}`)
      .sort()
      .join("\n");
    return hex(await hmac(secret, encoder.encode(text)));
  };
  // Telegram signs every field except "hash"; newer clients also add a "signature" field meant for third-party
  // verification, so accept the string both with and without it. Either way the HMAC needs the bot token.
  const matches = safeEqual(await check(["hash"]), given) || (params.has("signature") && safeEqual(await check(["hash", "signature"]), given));
  if (!matches) return { ok: false, reason: "bad_signature" };

  const authDate = Number(params.get("auth_date"));
  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (!Number.isInteger(authDate) || authDate <= 0) return { ok: false, reason: "malformed" };
  if (nowSeconds - authDate > maxAgeSeconds || authDate - nowSeconds > 300) return { ok: false, reason: "expired" };

  let user: unknown;
  try {
    user = JSON.parse(params.get("user") ?? "");
  } catch (_error) {
    return { ok: false, reason: "no_user" };
  }
  const candidate = user as { id?: unknown; first_name?: unknown; language_code?: unknown };
  if (!Number.isSafeInteger(candidate?.id) || (candidate.id as number) <= 0) return { ok: false, reason: "no_user" };
  return {
    ok: true,
    authDate,
    user: {
      id: candidate.id as number,
      first_name: typeof candidate.first_name === "string" ? candidate.first_name.slice(0, 64) : "",
      language_code: typeof candidate.language_code === "string" ? candidate.language_code.slice(0, 8) : "",
    },
  };
}
