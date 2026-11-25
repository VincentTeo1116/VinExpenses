import { dailyLimit, json, preflight, requireUser, takeQuota } from "../_shared/guard.ts";
import { ringgitRate } from "../_shared/fx.ts";

// The ringgit rate of a foreign currency on a receipt's date. Signed-in people only, with a daily allowance.
Deno.serve(async (request: Request) => {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== "POST") return json(request, { error: "Use POST." }, 405);

  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;
  if (!(await takeQuota(`fx:${auth.userId}`, dailyLimit("FX_DAILY_LIMIT", 120)))) {
    return json(request, { error: "Too many rate look-ups today. Enter the ringgit amount yourself." }, 429);
  }

  try {
    const payload = await request.json();
    const result = await ringgitRate(payload.currency, payload.date);
    if (result.ok) return json(request, { rate: result.rate, date: result.date, fallback: result.fallback });
    if (result.reason === "bad_request") return json(request, { error: "That currency is not supported." }, 400);
    return json(request, { error: "The exchange-rate service could not be reached. Enter the ringgit amount yourself." }, 502);
  } catch (_error) {
    return json(request, { error: "Could not look up the rate." }, 400);
  }
});
