// CP-01: turns one phone notification into a payment (amount, shop, date) and keeps none of the notification text.
import rulesFile from './rules.json';

export interface RawNotification {
  packageName: string;
  title: string;
  text: string;
  postedAt: number;
}

export interface AppRule {
  id: string;
  label: string;
  packages: string[];
  verified: boolean;
  spend: string[];
  amount?: string;
  merchant?: string;
}

export interface Rules {
  version: number;
  guards: { otp: string[]; security: string[]; promo: string[] };
  notSpend: { reason: 'refund' | 'topup' | 'transfer' | 'income'; patterns: string[] }[];
  apps: AppRule[];
}

export const RULES: Rules = rulesFile as Rules;

export interface Candidate {
  id: string;
  app: string;
  appLabel: string;
  amount: number;
  currency: 'MYR';
  merchant: string;
  date: string;
  postedAt: number;
  confidence: 'high' | 'low';
}

export type Skip = 'not-watched' | 'no-rule' | 'otp' | 'security' | 'promo' | 'refund' | 'topup' | 'transfer' | 'income' | 'not-payment' | 'ambiguous-amount' | 'no-amount';
export type Reading = { ok: true; candidate: Candidate } | { ok: false; reason: Skip };

const matches = (patterns: string[], text: string) => patterns.some((p) => new RegExp(p, 'i').test(text));

export function plain(text: unknown): string {
  return String(text ?? '')
    .normalize('NFKC')
    .replace(/[\u00a0\u2007\u202f]/g, ' ')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

const AMOUNT = /(?:RM|MYR)\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/gi;

export function amountsIn(text: string): number[] {
  const found = new Set<number>();
  for (const match of text.matchAll(AMOUNT)) {
    const whole = Number((match[1] as string).replace(/,/g, ''));
    const cents = match[2] ? Number(match[2].padEnd(2, '0')) : 0;
    found.add(whole * 100 + cents);
  }
  return [...found];
}

export function toCents(value: string): number | null {
  const clean = value.replace(/,/g, '').replace(/^(?:RM|MYR)\s?/i, '').trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(clean)) return null;
  const [whole, frac = ''] = clean.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

const pad = (n: number) => String(n).padStart(2, '0');

export function localDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const tidy = (name: string) => name.replace(/\s+/g, ' ').replace(/^[\s:.,;-]+|[\s:.,;-]+$/g, '').slice(0, 60);

// a stable id from the facts, so the same notification posted twice is one candidate
function idOf(app: string, cents: number, postedAt: number): string {
  let hash = 5381;
  for (const ch of `${app}|${cents}|${Math.floor(postedAt / 60000)}`) hash = ((hash << 5) + hash + ch.charCodeAt(0)) >>> 0;
  return hash.toString(36);
}

export function readNotification(raw: RawNotification, rules: Rules = RULES): Reading {
  const app = rules.apps.find((a) => a.packages.includes(raw.packageName));
  if (!app) return { ok: false, reason: 'not-watched' };
  if (!app.verified || app.spend.length === 0) return { ok: false, reason: 'no-rule' };

  const text = plain(`${raw.title}\n${raw.text}`);
  // the safety checks run first and always win
  if (matches(rules.guards.otp, text)) return { ok: false, reason: 'otp' };
  if (matches(rules.guards.security, text)) return { ok: false, reason: 'security' };
  if (matches(rules.guards.promo, text)) return { ok: false, reason: 'promo' };
  for (const group of rules.notSpend) if (matches(group.patterns, text)) return { ok: false, reason: group.reason };
  if (!matches(app.spend, text)) return { ok: false, reason: 'not-payment' };

  let cents: number | null = null;
  if (app.amount) {
    const found = new RegExp(app.amount, 'i').exec(text)?.groups?.amount;
    cents = found ? toCents(found) : null;
  } else {
    const all = amountsIn(text);
    if (all.length > 1) return { ok: false, reason: 'ambiguous-amount' };
    cents = all[0] ?? null;
  }
  if (cents === null || cents <= 0 || cents > 100_000_000) return { ok: false, reason: 'no-amount' };

  const shop = app.merchant ? new RegExp(app.merchant, 'i').exec(text)?.groups?.merchant : undefined;
  const merchant = shop ? tidy(shop) : '';
  return {
    ok: true,
    candidate: { id: idOf(app.id, cents, raw.postedAt), app: app.id, appLabel: app.label, amount: cents / 100, currency: 'MYR', merchant, date: localDate(raw.postedAt), postedAt: raw.postedAt, confidence: merchant ? 'high' : 'low' },
  };
}
