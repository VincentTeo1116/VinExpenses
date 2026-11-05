// Small building blocks that make the bot's messages look good: progress bars, emoji per category, trend arrows,
// dates in the person's language. Everything returns plain strings; callers escape user text with escapeHtml.

import { escapeHtml, ringgit } from "./email-templates.ts";

export { escapeHtml, ringgit };
export type Lang = "en" | "ms" | "zh";

export const RULE = "┄┄┄┄┄┄┄┄┄┄┄┄";

const CATEGORY_EMOJI: Record<string, string> = {
  food: "🍜", beverages: "☕", travel: "✈️", entertain: "🎬", work: "💼", shopping: "🛍️",
  utilities: "💡", car: "🚗", health: "💊", other: "📦",
};
/** The emoji for a category key; people's own categories get a neutral tag. */
export const emojiFor = (key: string): string => CATEGORY_EMOJI[key] ?? "🏷️";

/** ▰▰▰▰▰▱▱▱▱▱  : ratio 0..1 (anything above 1 shows full). */
export function bar(ratio: number, width = 10): string {
  const safe = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0;
  // A tiny but non-zero amount still shows one block, so "almost nothing" is visibly different from "nothing".
  const filled = safe > 0 ? Math.max(1, Math.round(safe * width)) : 0;
  return "▰".repeat(filled) + "▱".repeat(width - filled);
}

export const pct = (ratio: number): string => `${Math.round(Math.max(0, ratio) * 100)}%`;

/** "▲ 12%" / "▼ 8%" / "＝" comparing now with before. */
export function trend(now: number, before: number): { arrow: string; text: string; up: boolean } {
  if (!(before > 0)) return { arrow: "", text: "", up: false };
  const change = (now - before) / before;
  if (Math.abs(change) < 0.005) return { arrow: "＝", text: "0%", up: false };
  return change > 0
    ? { arrow: "▲", text: `${Math.round(change * 100)}%`, up: true }
    : { arrow: "▼", text: `${Math.round(-change * 100)}%`, up: false };
}

const LOCALE: Record<Lang, string> = { en: "en-MY", ms: "ms-MY", zh: "zh-CN" };

/** A date shown in Kuala Lumpur terms. `date` is any instant; the KL calendar day is what gets printed. */
export function formatDay(date: Date, lang: Lang, style: "short" | "long" = "short"): string {
  try {
    const options: Intl.DateTimeFormatOptions = style === "long"
      ? { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kuala_Lumpur" }
      : { day: "numeric", month: "short", timeZone: "Asia/Kuala_Lumpur" };
    return new Intl.DateTimeFormat(LOCALE[lang], options).format(date);
  } catch (_error) {
    return date.toISOString().slice(0, 10); // a runtime without that locale: plain ISO date
  }
}

export function formatMonth(date: Date, lang: Lang): string {
  try {
    return new Intl.DateTimeFormat(LOCALE[lang], { month: "long", year: "numeric", timeZone: "Asia/Kuala_Lumpur" }).format(date);
  } catch (_error) {
    return date.toISOString().slice(0, 7);
  }
}

export function truncate(text: string, max: number): string {
  const chars = [...text];
  return chars.length <= max ? text : chars.slice(0, max - 1).join("") + "…";
}

/** One category row for reports: "🍜 Food  ▰▰▰▰▰▱▱▱▱▱ 52%  RM 120.00" (name escaped). */
export function categoryRow(key: string, label: string, amount: number, total: number): string {
  const share = total > 0 ? amount / total : 0;
  return `${emojiFor(key)} ${escapeHtml(truncate(label, 16))}  ${bar(share)} ${pct(share)}  <b>${escapeHtml(ringgit(amount))}</b>`;
}
