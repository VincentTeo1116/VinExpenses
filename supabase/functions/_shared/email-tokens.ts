// Signed, expiring tokens for the links inside emails (confirm an address, unsubscribe).
//
// Why signed tokens and not random strings in the database:
//   - nothing to store, nothing to leak, and nothing to clean up;
//   - the token itself says WHAT it allows (purpose), for WHICH account, for WHICH address, and UNTIL WHEN;
//   - changing the address on the account silently kills every older link, because the address is inside the token;
//   - tampering with any character fails the signature check (HMAC-SHA-256, compared in constant time by the platform).
//
// Needs one secret, EMAIL_TOKEN_SECRET (at least 32 random characters). Rotating it invalidates every outstanding link.

export type TokenPurpose = "verify" | "unsub";

export interface TokenPayload {
  purpose: TokenPurpose;
  userId: string;
  email: string;
  expires: number; // epoch seconds
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TOKEN_LENGTH = 700;

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string) {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("EMAIL_TOKEN_SECRET must be at least 32 characters.");
  }
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signToken(
  secret: string,
  purpose: TokenPurpose,
  userId: string,
  email: string,
  ttlSeconds: number,
  nowMs = Date.now(),
): Promise<string> {
  if (!UUID.test(userId)) throw new Error("Invalid user id.");
  const payload = toBase64Url(encoder.encode(JSON.stringify({
    p: purpose,
    u: userId.toLowerCase(),
    e: email.trim().toLowerCase(),
    x: Math.floor(nowMs / 1000) + Math.floor(ttlSeconds),
  })));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(payload));
  return `${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

/** Returns the payload only if the token is genuine, for the expected purpose, and not expired. Anything else is null. */
export async function verifyToken(
  secret: string,
  token: unknown,
  purpose: TokenPurpose,
  nowMs = Date.now(),
): Promise<TokenPayload | null> {
  if (typeof token !== "string" || token.length < 10 || token.length > MAX_TOKEN_LENGTH) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  try {
    const genuine = await crypto.subtle.verify("HMAC", await hmacKey(secret), fromBase64Url(parts[1]), encoder.encode(parts[0]));
    if (!genuine) return null;
    const data = JSON.parse(decoder.decode(fromBase64Url(parts[0])));
    if (data?.p !== purpose) return null; // a confirm link can never be used as an unsubscribe link, or the other way round
    if (typeof data.u !== "string" || !UUID.test(data.u)) return null;
    if (typeof data.e !== "string" || data.e.length < 3 || data.e.length > 254) return null;
    if (typeof data.x !== "number" || !Number.isFinite(data.x) || data.x * 1000 <= nowMs) return null;
    return { purpose, userId: data.u, email: data.e, expires: data.x };
  } catch (_error) {
    return null; // malformed base64 / JSON / key: treat exactly like an invalid token
  }
}
