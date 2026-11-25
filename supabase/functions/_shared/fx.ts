// The ringgit value of one unit of a foreign currency on a given day, from the European Central Bank's published rates (Frankfurter).
// Weekends and holidays have no new rate: the service answers with the last business day before, and says which day it used.
// If the day cannot be found at all, today's rate is used and the answer says it was a fallback. Nothing personal is sent: only a currency and a date.

export const FX_ENDPOINT = "https://api.frankfurter.dev/v1";
/** The currencies the receipt reader can name that the ECB also publishes. */
export const FX_CURRENCIES = ["USD", "EUR", "GBP", "JPY", "AUD", "SGD", "CNY", "HKD", "THB", "IDR", "KRW", "INR", "NZD", "CAD", "CHF", "PHP"] as const;

export type FxResult =
  | { ok: true; rate: number; date: string; fallback: boolean }
  | { ok: false; reason: "bad_request" | "service" };

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

export function validYmd(value: unknown, today: Date = new Date()): value is string {
  if (typeof value !== "string") return false;
  const m = YMD.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return false;
  return y >= 1999 && date.getTime() <= today.getTime() + 2 * 24 * 3600 * 1000;
}

async function ask(path: string, currency: string, fetchImpl: typeof fetch): Promise<{ rate: number; date: string } | null> {
  try {
    const response = await fetchImpl(`${FX_ENDPOINT}/${path}?base=${currency}&symbols=MYR`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(6000) });
    if (!response.ok) return null;
    const body = await response.json();
    const rate = Number(body?.rates?.MYR);
    const date = typeof body?.date === "string" ? body.date : "";
    if (!Number.isFinite(rate) || rate <= 0 || rate > 100000 || !YMD.test(date)) return null;
    return { rate, date };
  } catch (_error) {
    return null;
  }
}

export async function ringgitRate(currency: unknown, date: unknown, fetchImpl: typeof fetch = fetch, today: Date = new Date()): Promise<FxResult> {
  const code = typeof currency === "string" ? currency.toUpperCase() : "";
  if (!(FX_CURRENCIES as readonly string[]).includes(code)) return { ok: false, reason: "bad_request" };
  const day = validYmd(date, today) ? date : null;
  if (day) {
    const found = await ask(day, code, fetchImpl);
    if (found) return { ok: true, rate: found.rate, date: found.date, fallback: false };
  }
  // the day was not available (or none was given): today's rate is the fallback, and it is marked as one
  const latest = await ask("latest", code, fetchImpl);
  if (latest) return { ok: true, rate: latest.rate, date: latest.date, fallback: true };
  return { ok: false, reason: "service" };
}
