// Shared protection for every function the website calls: who is calling, how often, and from which website.
//
// Why this exists: "verify_jwt = true" only checks that the request carries a valid token, and the public
// anon key in config.js is one. So without this, anyone who copies the anon key from the website could
// call these functions and use up your quota (or, for AI and email, your money and your sender reputation).
//
// Secrets (Supabase -> Edge Functions -> Secrets):
//   ALLOWED_ORIGINS   REQUIRED. Comma-separated website origins allowed to call the functions,
//                     e.g. https://yourname.github.io   (unset = every browser call is refused: fail closed)
//   SCAN_DAILY_LIMIT  receipt photo scans per user per day   (default 30)
//   AI_DAILY_LIMIT    AI helper calls per user per day       (default 10)

// deno-lint-ignore no-explicit-any
const runtime = (): any => (globalThis as any).Deno;

export function env(name: string): string | undefined {
  try {
    return runtime()?.env?.get(name) ?? undefined;
  } catch (_error) {
    return undefined; // permission denied or no runtime: behave as "not set"
  }
}

export function allowedOrigins(): string[] {
  return (env("ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

/** True when the request is not a browser call, or comes from an allowed website. */
export function originAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // server-to-server calls (cron, mail providers) carry no Origin header
  return allowedOrigins().includes(origin.replace(/\/$/, ""));
}

export function corsHeaders(request: Request): Record<string, string> {
  const origin = (request.headers.get("origin") ?? "").replace(/\/$/, "");
  const headers: Record<string, string> = {
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
  };
  // Only an allowed website ever gets this header. Never "*", and never a guess.
  if (origin && allowedOrigins().includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

export function json(request: Request, body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), "Content-Type": "application/json" },
  });
}

/** Answers CORS preflights, and refuses browser calls from websites that are not on the list. */
export function preflight(request: Request): Response | null {
  if (!originAllowed(request)) {
    if (allowedOrigins().length === 0) console.warn("ALLOWED_ORIGINS is not set: browser calls are refused. Set it to your website address.");
    return new Response(JSON.stringify({ error: "This website is not allowed to use this service." }), {
      status: 403,
      headers: { ...corsHeaders(request), "Content-Type": "application/json" },
    });
  }
  return request.method === "OPTIONS" ? new Response(null, { status: 204, headers: corsHeaders(request) }) : null;
}

export function projectAccess(): { url: string; serviceKey: string } | null {
  const url = env("SUPABASE_URL");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  return url && serviceKey ? { url, serviceKey } : null;
}

export interface SignedInUser {
  userId: string;
  email: string;
  emailConfirmed: boolean;
}

// Resolves the signed-in user from the request's token. Returns a ready-made error response if there is none.
export async function requireUser(request: Request): Promise<SignedInUser | Response> {
  const access = projectAccess();
  if (!access) return json(request, { error: "Server is not configured." }, 503);

  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token || token.length > 4096) return json(request, { error: "Please sign in first." }, 401);

  try {
    const response = await fetch(`${access.url}/auth/v1/user`, {
      headers: { apikey: access.serviceKey, Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return json(request, { error: "Please sign in first." }, 401);
    const user = await response.json();
    // The public anon key is a valid JWT too, but it has no user id: that is what we reject here.
    if (!user?.id) return json(request, { error: "Please sign in first." }, 401);
    return {
      userId: String(user.id),
      email: typeof user.email === "string" ? user.email.trim().toLowerCase() : "",
      emailConfirmed: Boolean(user.email_confirmed_at || user.confirmed_at),
    };
  } catch (_error) {
    return json(request, { error: "Could not verify your sign-in. Try again." }, 503);
  }
}

export function dailyLimit(name: string, fallback: number): number {
  const value = Number(env(name));
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback;
}

// Counts one use against today's allowance. Returns a response when the user is over the limit.
export async function consumeQuota(
  request: Request,
  userId: string,
  kind: "ocr" | "ai",
  limit: number,
  noun: string,
): Promise<Response | null> {
  const access = projectAccess();
  if (!access) return json(request, { error: "Server is not configured." }, 503);

  try {
    const response = await fetch(`${access.url}/rest/v1/rpc/consume_receipt_quota`, {
      method: "POST",
      headers: {
        apikey: access.serviceKey,
        Authorization: `Bearer ${access.serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_user: userId, p_kind: kind, p_limit: limit }),
    });
    if (!response.ok) {
      const detail = await response.text();
      // Migration not run yet: keep working (unlimited) rather than break scanning, but say so in the logs.
      if (/could not find the function|does not exist|PGRST202|42883/i.test(detail)) {
        console.warn("consume_receipt_quota is missing: run the receipt_scan_usage part of supabase-schema.sql to enforce daily limits.");
        return null;
      }
      return json(request, { error: "Could not check your daily limit. Try again." }, 503);
    }
    const allowed = await response.json();
    if (allowed === true) return null;
    return json(request, { error: `Daily ${noun} limit reached (${limit}). It resets at midnight UTC.` }, 429);
  } catch (_error) {
    return json(request, { error: "Could not check your daily limit. Try again." }, 503);
  }
}

/**
 * Generic daily counter for any named scope ("nearby:<user>", "email:global", ...). Fails CLOSED:
 * if the counter cannot be reached or the SQL is missing, the action is refused, because these
 * counters protect things that cost money or can annoy other people.
 * Returns true when the action may go ahead.
 */
export async function takeQuota(scope: string, limit: number, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const access = projectAccess();
  if (!access) return false;
  try {
    const response = await fetchImpl(`${access.url}/rest/v1/rpc/consume_quota`, {
      method: "POST",
      headers: { apikey: access.serviceKey, Authorization: `Bearer ${access.serviceKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_scope: scope, p_limit: limit }),
    });
    if (!response.ok) {
      console.error("consume_quota failed with status", response.status, "- has supabase-schema.sql been run?");
      return false;
    }
    return (await response.json()) === true;
  } catch (_error) {
    return false;
  }
}

/**
 * Counts one receipt scan against the person's daily scan allowance (the SAME allowance as scanning in the app).
 * Fails closed: if the counter cannot be reached, no scan is allowed. Returns true when the scan may go ahead.
 */
export async function takeReceiptQuota(userId: string, limit: number, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const access = projectAccess();
  if (!access) return false;
  try {
    const response = await fetchImpl(`${access.url}/rest/v1/rpc/consume_receipt_quota`, {
      method: "POST",
      headers: { apikey: access.serviceKey, Authorization: `Bearer ${access.serviceKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_user: userId, p_kind: "ocr", p_limit: limit }),
    });
    return response.ok && (await response.json()) === true;
  } catch (_error) {
    return false;
  }
}

/** Constant-time string comparison (does not stop early at the first wrong character). */
export function safeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index++) difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return difference === 0;
}

/** SHA-256 hex of a string, used so personal values (email addresses) never appear in counter names. */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
