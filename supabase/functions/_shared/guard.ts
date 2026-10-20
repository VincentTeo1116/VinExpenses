// Shared protection for the receipt functions: who is calling, how often, and from which website.
//
// Why this exists: "verify_jwt = true" only checks that the request carries a valid token, and the public
// anon key in config.js is one. So without this, anyone who copies the anon key from the website could
// call these functions and use up your OCR / AI quota (or, for AI, your money).
//
// Secrets (Supabase -> Edge Functions -> Secrets), all optional:
//   ALLOWED_ORIGINS   comma-separated website origins allowed to call the functions,
//                     e.g. https://yourname.github.io   (unset = any website, the old behaviour)
//   SCAN_DAILY_LIMIT  receipt photo scans per user per day   (default 30)
//   AI_DAILY_LIMIT    AI helper calls per user per day       (default 10)

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((origin) => origin.trim().replace(/\/$/, ""))
  .filter(Boolean);

export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin") ?? "";
  const allow = ALLOWED_ORIGINS.length === 0
    ? "*"
    : ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

export function json(request: Request, body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), "Content-Type": "application/json" },
  });
}

export function preflight(request: Request): Response | null {
  return request.method === "OPTIONS" ? new Response("ok", { headers: corsHeaders(request) }) : null;
}

function projectAccess(): { url: string; serviceKey: string } | null {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  return url && serviceKey ? { url, serviceKey } : null;
}

// Resolves the signed-in user from the request's token. Returns a ready-made error response if there is none.
export async function requireUser(request: Request): Promise<{ userId: string } | Response> {
  const access = projectAccess();
  if (!access) return json(request, { error: "Server is not configured." }, 503);

  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json(request, { error: "Please sign in first." }, 401);

  try {
    const response = await fetch(`${access.url}/auth/v1/user`, {
      headers: { apikey: access.serviceKey, Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return json(request, { error: "Please sign in first." }, 401);
    const user = await response.json();
    // The public anon key is a valid JWT too, but it has no user id: that is what we reject here.
    if (!user?.id) return json(request, { error: "Please sign in first." }, 401);
    return { userId: String(user.id) };
  } catch (_error) {
    return json(request, { error: "Could not verify your sign-in. Try again." }, 503);
  }
}

export function dailyLimit(name: string, fallback: number): number {
  const value = Number(Deno.env.get(name));
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
