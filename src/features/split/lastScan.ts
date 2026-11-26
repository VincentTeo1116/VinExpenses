// SP-10: the receipt just scanned in the Add sheet, kept in memory only (never stored) so the split page can pick it up without a second upload.
import type { PlacedWord } from './rows';

export interface RememberedScan {
  text: string;
  words: PlacedWord[];
  merchant: string;
  date: string;
  /** The photo that was read (a data URL), kept in memory only. */
  image?: string;
  at: number;
}

const FRESH_MS = 30 * 60 * 1000;
let last: RememberedScan | null = null;

export const rememberScan = (scan: Omit<RememberedScan, 'at'>): void => {
  last = { ...scan, at: Date.now() };
};

/** The remembered scan if it is still fresh; it is left in place so going back and forth keeps it. */
export function recentScan(now = Date.now()): RememberedScan | null {
  return last && now - last.at <= FRESH_MS ? last : null;
}

export const forgetScan = (): void => {
  last = null;
};

/** The reader's word boxes (x, y, width, height) as placed words. */
export const placedWords = (words: { t: string; x: number; y: number; w: number; h: number }[]): PlacedWord[] => words.map((w) => ({ text: w.t, x0: w.x, y0: w.y, x1: w.x + w.w, y1: w.y + w.h }));
