// Proves a request really comes from the Mini App inside Telegram, by checking Telegram's signature.

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

/* Checks the launch data against the bot token and its age. Returns the user, or why it was refused. */
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
  // Newer Telegram clients add a "signature" field, so accept the string with and without it.
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
