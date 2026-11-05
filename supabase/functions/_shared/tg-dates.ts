// Finds a date inside a message such as "yesterday petrol 50", "3/11 coffee 6", "3 nov lunch 12" or "昨天 午餐 12"
// and removes it from the text. All dates are Kuala Lumpur calendar days (UTC+8).

const KL_MS = 8 * 60 * 60 * 1000;
const MAX_DAYS_BACK = 400;

export interface DateResult {
  /** Noon on that day in Kuala Lumpur, or null when no date was given (or it was "today"). */
  at: Date | null;
  text: string;
  error: "future" | "old" | null;
}

const MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, mac: 3, april: 4, apr: 4, may: 5, mei: 5,
  june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8, ogos: 8, september: 9, sept: 9, sep: 9,
  october: 10, oct: 10, okt: 10, november: 11, nov: 11, december: 12, dec: 12, dis: 12, disember: 12,
};
const MONTH_WORDS = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");

const klParts = (instant: Date) => {
  const local = new Date(instant.getTime() + KL_MS);
  return { y: local.getUTCFullYear(), m: local.getUTCMonth() + 1, d: local.getUTCDate() };
};
const dayNumber = (y: number, m: number, d: number) => Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
const noonKl = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, 12) - KL_MS);
const isRealDate = (y: number, m: number, d: number) => {
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
};

const tidy = (text: string) => text.replace(/\s+/g, " ").trim();

export function extractDate(input: string, now: Date): DateResult {
  const today = klParts(now);
  const todayNumber = dayNumber(today.y, today.m, today.d);
  const finish = (y: number, m: number, d: number, text: string): DateResult => {
    const diff = todayNumber - dayNumber(y, m, d);
    if (diff < 0) return { at: null, text, error: "future" };
    if (diff > MAX_DAYS_BACK) return { at: null, text, error: "old" };
    return { at: diff === 0 ? null : noonKl(y, m, d), text, error: null };
  };
  const without = (match: RegExpExecArray) => tidy(input.slice(0, match.index) + " " + input.slice(match.index + match[0].length));
  const shifted = (days: number) => {
    const back = klParts(new Date(now.getTime() - days * 86_400_000));
    return back;
  };

  // yesterday / today, in English, Malay and Chinese
  let match = /(^|\s)(yesterday|ytd|kelmarin|semalam)(?=\s|$)|昨天/i.exec(input);
  if (match) {
    const p = shifted(1);
    return finish(p.y, p.m, p.d, without(match));
  }
  match = /(^|\s)(today|hari ini)(?=\s|$)|今天/i.exec(input);
  if (match) return { at: null, text: without(match), error: null };

  // 2026-11-03
  match = /(^|\s)(\d{4})-(\d{1,2})-(\d{1,2})(?=\s|$)/.exec(input);
  if (match) {
    const [y, m, d] = [Number(match[2]), Number(match[3]), Number(match[4])];
    if (isRealDate(y, m, d)) return finish(y, m, d, without(match));
  }

  // 3/11 or 3/11/26 or 3/11/2026   (day first, as in Malaysia)
  match = /(^|\s)(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?(?=\s|$)/.exec(input);
  if (match) {
    const d = Number(match[2]);
    const m = Number(match[3]);
    const yearGiven = match[4] !== undefined;
    let y = yearGiven ? Number(match[4]) : today.y;
    if (yearGiven && match[4].length === 2) y += 2000;
    if (isRealDate(y, m, d)) {
      if (!yearGiven && dayNumber(y, m, d) > todayNumber + 7) y -= 1; // "28/12" typed in January means last December; a date just ahead is a mistake (refused below)
      if (isRealDate(y, m, d)) return finish(y, m, d, without(match));
    }
  }

  // 3 nov / 3 november / 3nov
  match = new RegExp(`(^|\\s)(\\d{1,2})\\s*(${MONTH_WORDS})(?=\\s|$|[.,])`, "i").exec(input);
  if (match) {
    const d = Number(match[2]);
    const m = MONTHS[match[3].toLowerCase()];
    let y = today.y;
    if (isRealDate(y, m, d)) {
      if (dayNumber(y, m, d) > todayNumber + 7) y -= 1;
      if (isRealDate(y, m, d)) return finish(y, m, d, without(match));
    }
  }

  return { at: null, text: tidy(input), error: null };
}
