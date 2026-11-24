// Helpers for the Mini App: money, dates (on the Kuala Lumpur calendar), colours. React escapes all text, so nothing here builds HTML.
import { EN, MS, ZH, type MiniKey } from './dict.ts';

export const KL_MS = 8 * 3600000;
export const DAY_MS = 86400000;
export type Lang = 'en' | 'ms' | 'zh';
const LOCALES: Record<Lang, string> = { en: 'en-MY', ms: 'ms-MY', zh: 'zh-CN' };

export const PALETTE = ['#ef4444', '#4f46e5', '#06b6d4', '#f59e0b', '#8b5cf6', '#10b981', '#0ea5e9', '#6b7280'];
export const COLORS: Record<string, string> = { food: '#ef4444', beverages: '#4f46e5', travel: '#06b6d4', entertain: '#f59e0b', work: '#10b981', shopping: '#8b5cf6', utilities: '#0ea5e9', car: '#f97316', health: '#ec4899', other: '#6b7280' };
export const EMOJI: Record<string, string> = { food: '🍜', beverages: '☕', travel: '✈️', entertain: '🎬', work: '💼', shopping: '🛍️', utilities: '💡', car: '🚗', health: '💊', other: '📦' };

/** Only a plain #rgb / #rrggbb / #rrggbbaa colour is ever used. */
export const safeColor = (value: unknown, fallback: string): string => (typeof value === 'string' && /^#[0-9a-f]{3,8}$/i.test(value) ? value : fallback);
export const emojiFor = (key: string): string => (Object.prototype.hasOwnProperty.call(EMOJI, key) ? (EMOJI[key] as string) : '🏷️');

export function asLang(value: unknown): Lang {
  const text = String(value ?? '').toLowerCase();
  if (text.startsWith('zh')) return 'zh';
  if (text === 'ms' || text.startsWith('ms-') || text === 'id') return 'ms';
  return 'en';
}

/** Looks a sentence up and fills {values}. Unknown key -> English -> the key itself (never throws). */
export function translate(lang: Lang, key: MiniKey, vars?: Record<string, string | number>): string {
  const dict = lang === 'ms' ? MS : lang === 'zh' ? ZH : undefined;
  const template = dict?.[key] ?? EN[key] ?? key;
  return String(template).replace(/\{(\w+)\}/g, (_m, name: string) => (vars && Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : ''));
}

export const toNumber = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

export function money(value: unknown): string {
  const n = toNumber(value);
  return new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR' }).format(n).replace(/\u00a0/g, ' ');
}
/** "RM 1.2k" for tight places. */
export function compactMoney(value: unknown): string {
  const n = toNumber(value);
  const abs = Math.abs(n);
  if (abs >= 1000000) return `RM ${(n / 1000000).toFixed(1).replace(/\.0$/, '')}M`;
  if (abs >= 1000) return `RM ${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `RM ${Math.round(n)}`;
}
export const percent = (ratio: unknown): string => `${Math.round(Math.max(0, toNumber(ratio)) * 100)}%`;

export interface Trend {
  arrow: string;
  text: string;
  up: boolean;
  flat: boolean;
}
/** How much now is above or below before, or null when there is nothing to compare with. */
export function trend(now: unknown, before: unknown): Trend | null {
  const a = toNumber(now);
  const b = toNumber(before);
  if (!(b > 0)) return null;
  const change = (a - b) / b;
  if (Math.abs(change) < 0.005) return { arrow: '＝', text: '0%', up: false, flat: true };
  return { arrow: change > 0 ? '▲' : '▼', text: `${Math.round(Math.abs(change) * 100)}%`, up: change > 0, flat: false };
}

/** "YYYY-MM-DD" on the Kuala Lumpur calendar for an ISO instant. */
export function dayKey(iso: string): string {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? new Date(t + KL_MS).toISOString().slice(0, 10) : '';
}
export function dayNumber(key: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || '');
  return m ? Math.floor(Date.UTC(+(m[1] as string), +(m[2] as string) - 1, +(m[3] as string)) / DAY_MS) : NaN;
}
export function formatKey(key: string, lang: Lang, options: Intl.DateTimeFormatOptions): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || '');
  if (!m) return String(key || '');
  return new Intl.DateTimeFormat(LOCALES[lang], { timeZone: 'UTC', ...options }).format(new Date(Date.UTC(+(m[1] as string), +(m[2] as string) - 1, +(m[3] as string), 12)));
}
export function dayLabel(key: string, todayKey: string, lang: Lang, words: { today: string; yesterday: string }): string {
  const diff = dayNumber(todayKey) - dayNumber(key);
  if (diff === 0) return words.today;
  if (diff === 1) return words.yesterday;
  return formatKey(key, lang, { weekday: 'short', day: 'numeric', month: 'short' });
}
const startKey = (startIso: string) => dayKey(new Date(new Date(startIso).getTime() + 12 * 3600000).toISOString());
export const monthTitle = (startIso: string, lang: Lang): string => formatKey(startKey(startIso), lang, { month: 'long', year: 'numeric' });
export const monthShort = (startIso: string, lang: Lang): string => formatKey(startKey(startIso), lang, { month: 'short' });
/** Weekday label for 0 = Monday ... 6 = Sunday. */
export const weekdayShort = (index: number, lang: Lang): string => new Intl.DateTimeFormat(LOCALES[lang], { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 1, 12) + index * DAY_MS));
export const keyOfMonthDay = (startIso: string, index: number): string => dayKey(new Date(new Date(startIso).getTime() + index * DAY_MS + 12 * 3600000).toISOString());

/** Colour step 0 to 4 for a day's spending, compared with the month's own busiest days. */
export function heatLevel(value: number, positivesSorted: number[]): number {
  if (!(value > 0)) return 0;
  if (positivesSorted.length === 1) return 2;
  let last = -1;
  positivesSorted.forEach((v, i) => {
    if (v === value) last = i;
  });
  const share = last / (positivesSorted.length - 1);
  return share <= 0.25 ? 1 : share <= 0.5 ? 2 : share <= 0.8 ? 3 : 4;
}
export function truncate(text: unknown, max: number): string {
  const chars = Array.from(String(text ?? ''));
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max - 1).join('')}…`;
}
/** "YYYY-MM-DD" a number of days before today. */
export const minDate = (todayKey: string, back: number): string => new Date((dayNumber(todayKey) - back) * DAY_MS).toISOString().slice(0, 10);
