// FX-01: a receipt in another currency is turned into ringgit at the rate of the receipt's own day (the app's server asks the European
// Central Bank's published rates). The original amount and the rate are kept in the Note, and the person is told to check the real spend.
import { ApiError, callFunction } from '@/lib/api';
import type { OcrContext } from './scan';

export interface FxQuote {
  rate: number;
  /** The day the rate is from (the last business day, if the receipt day was a weekend or holiday). */
  date: string;
  /** True when the receipt day's rate was not available and today's was used instead. */
  fallback: boolean;
}

/** Null when no rate could be had (offline, busy, not allowed): the caller then asks the person for the ringgit amount. */
export async function lookupRate(context: OcrContext, currency: string, date: string): Promise<FxQuote | null> {
  try {
    const reply = await callFunction<{ rate?: number; date?: string; fallback?: boolean; error?: string }>('fx-rate', { currency, date }, { ...context, timeoutMs: 12_000 });
    if (reply.error || typeof reply.rate !== 'number' || !(reply.rate > 0) || typeof reply.date !== 'string') return null;
    return { rate: reply.rate, date: reply.date, fallback: Boolean(reply.fallback) };
  } catch (error) {
    if (error instanceof ApiError) return null;
    return null;
  }
}

/** Ringgit to the sen. */
export const toRinggit = (amount: number, rate: number): number => Math.round(amount * rate * 100) / 100;

/** A rate with five significant digits, so a small one (IDR is about 0.00027) is not shown as 0.0003. */
export const formatRate = (rate: number): string => rate.toPrecision(5);

/** The line kept in the Note, e.g. "Original: USD 25.00 at 4.2000 (rate of 2026-10-12)". */
export const originalNote = (currency: string, amount: number, quote: FxQuote): string => `Original: ${currency} ${amount.toFixed(2)} at ${formatRate(quote.rate)} (rate of ${quote.date})`;

const NOTE_MAX = 200;

/** Adds the original-amount line to a note: any earlier one is replaced (a re-scan never doubles it), and the result always fits the note limit. */
export function withOriginal(note: string, original: string): string {
  const rest = note
    .split(' · ')
    .filter((part) => !part.trim().startsWith('Original:'))
    .join(' · ')
    .trim();
  if (!rest) return original.slice(0, NOTE_MAX);
  const joined = `${rest} · ${original}`;
  return joined.length <= NOTE_MAX ? joined : `${rest.slice(0, Math.max(0, NOTE_MAX - original.length - 3))} · ${original}`.slice(0, NOTE_MAX);
}
