// Calendar helpers. A "YMD" is a plain date written 2026-11-23 (no time, no time zone), which is how the database stores due dates.
// Money records keep a full timestamp; they are placed at noon on their day, so a time zone shift can never move them to another day.

const pad = (n: number) => String(n).padStart(2, '0');

export interface Ymd {
  y: number;
  m: number;
  d: number;
}

export function parseYmd(value: string): Ymd {
  const [y, m, d] = value.split('-').map(Number);
  return { y: y ?? 0, m: m ?? 1, d: d ?? 1 };
}

export const fmtYmd = ({ y, m, d }: Ymd): string => `${y}-${pad(m)}-${pad(d)}`;
export const isYmd = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`)) && fmtYmd(parseYmd(value)) === value && new Date(`${value}T12:00:00Z`).getUTCDate() === parseYmd(value).d;
export const daysInMonth = (y: number, m: number): number => new Date(y, m, 0).getDate();

/** Today's date on this device. */
export function todayYmd(now: Date = new Date()): string {
  return fmtYmd({ y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() });
}

export type Frequency = 'weekly' | 'monthly' | 'yearly';

/** The next due date after `due`. A monthly bill on the 31st lands on the last day of short months and goes back to the 31st after. */
export function advanceDue(due: string, frequency: Frequency, anchorDay: number): string {
  const { y, m, d } = parseYmd(due);
  if (frequency === 'weekly') {
    const next = new Date(y, m - 1, d + 7);
    return fmtYmd({ y: next.getFullYear(), m: next.getMonth() + 1, d: next.getDate() });
  }
  if (frequency === 'yearly') {
    const year = y + 1;
    return fmtYmd({ y: year, m, d: Math.min(anchorDay, daysInMonth(year, m)) });
  }
  let month = m + 1;
  let year = y;
  if (month > 12) {
    month = 1;
    year += 1;
  }
  return fmtYmd({ y: year, m: month, d: Math.min(anchorDay, daysInMonth(year, month)) });
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  const a = parseYmd(from);
  const b = parseYmd(to);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000);
}

/** A record's timestamp for a given day: noon, local time. */
export function ymdToNoonIso(value: string): string {
  const { y, m, d } = parseYmd(value);
  return new Date(y, m - 1, d, 12).toISOString();
}

/** The local calendar day of a stored timestamp. */
export function isoToYmd(iso: string): string {
  const date = new Date(iso);
  return fmtYmd({ y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate() });
}

export const monthKey = (ymd: string): string => ymd.slice(0, 7);
export const monthOf = (iso: string): string => monthKey(isoToYmd(iso));

export type DateFormat = 'dmy_short' | 'dmy' | 'ymd';
export const DATE_FORMATS: readonly DateFormat[] = ['dmy_short', 'dmy', 'ymd'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 19 Oct 2026, 19/10/2026 or 2026-10-19, as the person chose. */
export function formatDate(ymd: string, format: DateFormat = 'dmy_short'): string {
  const { y, m, d } = parseYmd(ymd);
  if (format === 'ymd') return ymd;
  if (format === 'dmy') return `${pad(d)}/${pad(m)}/${y}`;
  return `${d} ${MONTHS[m - 1] ?? ''} ${y}`;
}
