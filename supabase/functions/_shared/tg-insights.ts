// The "extras" behind the charts: daily totals, the calendar heat-strip, the 6-month mini trend, logging streaks,
// plain-language insights and aligned tables. Everything here is a pure function of its inputs (no database, no
// network, no clock), so it can be tested exactly. All days are Kuala Lumpur calendar days (UTC+8).

import type { Lang } from "./tg-format.ts";

export const KL_MS = 8 * 3600_000;
export const DAY_MS = 86_400_000;

/** Whole days since 1970 on the Kuala Lumpur calendar. Two instants on the same KL day give the same number. */
export const klDay = (instant: Date | string | number): number => Math.floor((new Date(instant).getTime() + KL_MS) / DAY_MS);

/** Day of the week on the KL calendar, Monday = 0 ... Sunday = 6, for a `klDay` number. */
export const mondayBased = (day: number): number => (((day + 3) % 7) + 7) % 7; // 1970-01-01 was a Thursday

export interface Dated {
  amount: string | number;
  created_at: string;
}

/** Spending per KL day. `start` must be a KL midnight; entries outside the `days` window are ignored. */
export function bucketByDay(rows: Dated[], start: Date, days: number): number[] {
  const cents = new Array<number>(days).fill(0);
  const first = klDay(start);
  for (const row of rows) {
    const index = klDay(row.created_at) - first;
    const value = Math.round(Number(row.amount) * 100);
    if (index >= 0 && index < days && Number.isFinite(value)) cents[index] += value;
  }
  return cents.map((c) => c / 100);
}

/** The set of KL days (as `klDay` numbers) that have at least one entry. */
export function daysWithEntries(rows: { created_at: string }[]): Set<number> {
  return new Set(rows.map((row) => klDay(row.created_at)));
}

/** Consecutive days with at least one entry, counted back from today (or from yesterday if today has none yet). */
export function streakDays(days: Set<number>, today: number): number {
  const from = days.has(today) ? today : today - 1;
  let count = 0;
  while (days.has(from - count)) count++;
  return count;
}

// ---------------------------------------------------------------- calendar heat-strip

const toFullWidth = (text: string) => text.replace(/[A-Za-z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0));
const INITIALS: Record<Lang, string> = {
  en: toFullWidth("MTWTFSS"),
  ms: toFullWidth("ISRKJSA"), // Isnin Selasa Rabu Khamis Jumaat Sabtu Ahad
  zh: "一二三四五六日",
};

export interface Heat {
  /** The header row of weekday initials, then one line per week. */
  lines: string[];
  /** The busiest day (0-based index into the month), or null when nothing was spent. */
  biggest: { index: number; amount: number } | null;
}

/**
 * One coloured square per day: ⬜ nothing, 🟩 light, 🟨 medium, 🟧 heavy, 🟥 the heaviest; ▫️ for days that have
 * not happened yet or are outside the month. Colours are relative to this month's own busiest days, and the busiest
 * day is also named in words, so the colours are never the only information.
 * `totals[i]` is the spending on day i+1 of the month. `todayIndex` is today's index, or null for a finished month.
 */
export function heatStrip(lang: Lang, monthStartDay: number, totals: number[], todayIndex: number | null): Heat {
  const known = todayIndex === null ? totals : totals.slice(0, todayIndex + 1);
  const positive = known.filter((v) => v > 0).sort((a, b) => a - b);
  // Rank-based tiers: the busiest days are always the hottest colour, however few days have spending.
  const lastRank = new Map<number, number>();
  positive.forEach((v, rank) => lastRank.set(v, rank));
  const tier = (value: number) => {
    if (positive.length === 1) return "🟨";
    const share = (lastRank.get(value) ?? 0) / (positive.length - 1);
    return share <= 0.25 ? "🟩" : share <= 0.5 ? "🟨" : share <= 0.8 ? "🟧" : "🟥";
  };

  const cells: string[] = new Array(mondayBased(monthStartDay)).fill("▫️");
  let biggest: Heat["biggest"] = null;
  totals.forEach((value, index) => {
    if (todayIndex !== null && index > todayIndex) cells.push("▫️");
    else if (!(value > 0)) cells.push("⬜");
    else {
      cells.push(tier(value));
      if (!biggest || value > biggest.amount) biggest = { index, amount: value };
    }
  });
  while (cells.length % 7 !== 0) cells.push("▫️");
  const lines = [INITIALS[lang]];
  for (let i = 0; i < cells.length; i += 7) lines.push(cells.slice(i, i + 7).join(""));
  // Weeks that have not started yet add nothing: drop them (always keep at least one week).
  while (lines.length > 2 && !lines[lines.length - 1].replace(/▫️/g, "")) lines.pop();
  return { lines, biggest };
}

// ---------------------------------------------------------------- mini trend

const BLOCKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

/** "▂▄▅▃▇▆": relative size of each value. A month with nothing is the lowest block. */
export function sparkline(values: number[]): string {
  const max = Math.max(0, ...values.filter((v) => Number.isFinite(v)));
  return values.map((v) => (max > 0 && v > 0 ? BLOCKS[Math.min(7, Math.max(0, Math.round((v / max) * 7)))] : BLOCKS[0])).join("");
}

// ---------------------------------------------------------------- insights

export type Insight =
  | { kind: "cat"; key: string; up: boolean; pct: number }
  | { kind: "weekend"; ratio: number; weekendHeavy: boolean }
  | { kind: "pace"; key: string; projected: number; used: number; day: number; warn: boolean };

/** The category that changed the most versus the previous period (only meaningful changes: 15% and RM 20 or more). */
export function categoryMover(current: [string, number][], previous: [string, number][]): Insight | null {
  const before = new Map(previous);
  const now = new Map(current);
  let best: { key: string; delta: number; pct: number } | null = null;
  for (const key of new Set([...before.keys(), ...now.keys()])) {
    const prev = before.get(key) ?? 0;
    const cur = now.get(key) ?? 0;
    const delta = cur - prev;
    if (!(prev > 0) || !(cur > 0) || Math.abs(delta) < 20 || Math.abs(delta) / prev < 0.15) continue; // a category that vanished is noise, not a trend
    if (!best || Math.abs(delta) > Math.abs(best.delta)) best = { key, delta, pct: Math.round((Math.abs(delta) / prev) * 100) };
  }
  return best ? { kind: "cat", key: best.key, up: best.delta > 0, pct: best.pct } : null;
}

/** Weekend days versus weekdays, per day, over the days that have passed. Needs at least 3 weekend and 5 week days. */
export function weekendInsight(monthStartDay: number, totals: number[], passedDays: number): Insight | null {
  let weekend = 0, weekendDays = 0, week = 0, weekDays = 0;
  for (let i = 0; i < Math.min(passedDays, totals.length); i++) {
    if (mondayBased(monthStartDay + i) >= 5) { weekend += totals[i]; weekendDays++; } else { week += totals[i]; weekDays++; }
  }
  if (weekendDays < 3 || weekDays < 5 || !(weekend > 0) || !(week > 0)) return null;
  const a = weekend / weekendDays;
  const b = week / weekDays;
  const ratio = Math.max(a, b) / Math.min(a, b);
  return ratio >= 1.5 ? { kind: "weekend", ratio: Math.round(ratio * 10) / 10, weekendHeavy: a > b } : null;
}

/**
 * Where a budget is heading at the current pace this month. Warns when the projection passes 100%; otherwise says
 * "on track" for the budget that is closest to its limit. Needs at least 7 days of data.
 */
export function paceInsight(budgets: { key: string; limit: number; used: number }[], day: number, daysInMonth: number): Insight | null {
  if (day < 7 || !budgets.length) return null; // too early in the month for a projection to mean anything
  const scored = budgets
    .filter((b) => b.limit > 0 && b.used / b.limit < 1) // already over: the over-budget alert covers that
    .map((b) => ({ ...b, projected: (b.used / day) * daysInMonth / b.limit, usedRatio: b.used / b.limit }))
    .sort((a, b) => b.projected - a.projected);
  const worst = scored[0];
  if (!worst) return null;
  if (worst.projected >= 1) return { kind: "pace", key: worst.key, projected: worst.projected, used: worst.usedRatio, day, warn: true };
  if (worst.projected < 0.9) return { kind: "pace", key: worst.key, projected: worst.projected, used: worst.usedRatio, day, warn: false };
  return null;
}

// ---------------------------------------------------------------- aligned tables

/** Printed width: CJK and emoji take two columns, accents and joiners none. */
export function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    const cp = char.codePointAt(0) as number;
    if (cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0x300 && cp <= 0x36f)) continue;
    const wide = (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe6f) || (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x1f300 && cp <= 0x1faff) || (cp >= 0x20000 && cp <= 0x3fffd);
    width += wide ? 2 : 1;
  }
  return width;
}

/** Cuts text to a printed width, adding "…" when something was removed. */
export function clipWidth(text: string, max: number): string {
  if (displayWidth(text) <= max) return text;
  let out = "";
  for (const char of text) {
    if (displayWidth(out + char) > max - 1) break;
    out += char;
  }
  return out + "…";
}

/** Lines of equal-width columns for a <pre> block. `aligns` is "l" or "r" per column. Cells are clipped to `maxWidths`. */
export function alignTable(rows: string[][], aligns: ("l" | "r")[], maxWidths: number[] = []): string[] {
  const clipped = rows.map((row) => row.map((cell, c) => (maxWidths[c] ? clipWidth(cell, maxWidths[c]) : cell)));
  const widths = aligns.map((_, c) => Math.max(0, ...clipped.map((row) => displayWidth(row[c] ?? ""))));
  return clipped.map((row) =>
    aligns.map((align, c) => {
      const cell = row[c] ?? "";
      const pad = " ".repeat(Math.max(0, widths[c] - displayWidth(cell)));
      return align === "r" ? pad + cell : cell + pad;
    }).join("  ").trimEnd()
  );
}
