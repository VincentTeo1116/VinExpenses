// TX-02, CT-01: suggests a category (with a plain-English reason) from the person's own history, built-in merchant lists, receipt
// clues, and their own category names. A typed port of legacy/smart-entry.js (checked against it in tests/ports-parity.test.js).
// The caller must never override a category the person chose themselves.
import { KNOWN } from './knownMerchants.ts';

export { KNOWN };

export interface CategoryLite {
  key: string;
  label: string;
  active?: boolean;
  is_builtin?: boolean;
}
export interface Suggestion {
  key: string;
  label: string;
  confidence: 'high' | 'medium' | 'low';
  source: 'history' | 'receipt' | 'known' | 'name';
  reason: string;
}
interface MemoryEntry {
  counts: Record<string, number>;
  total: number;
  label: string;
}
export type MerchantMemory = Map<string, MemoryEntry>;

/** One tidy form for matching: lower case, accents removed (café = cafe), curly quotes straight, "h & m" = "h&m", "GRAB*FOOD" = "grab food". */
const MARKS = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g');
const CURLY = new RegExp('[' + String.fromCharCode(0x2018, 0x2019, 0x60, 0xb4) + ']', 'g');
function fold(value: unknown): string {
  return String(value ?? '').normalize('NFKD').replace(MARKS, '').toLowerCase().replace(CURLY, "'").replace(/\s*&\s*/g, '&').replace(/[*_]+/g, ' ');
}
/** A note this short is the person's own words (not a receipt), so ordinary words in it count too. */
const SHORT_NOTE = 120;

// Merchant names: "99 SPEEDMART KL 1234" and "99 Speedmart" are the same place.
const NOISE_WORDS = /\b(?:sdn|bhd|berhad|enterprise|trading|resources|plt|ltd|co|inc|corp|the|branch|outlet|kl|pj|jb)\b/g;

export function normalizeMerchant(name: unknown): string {
  let s = String(name ?? '').toLowerCase();
  s = s.replace(/\[[^\]]*\]/g, ' ').replace(/\([^)]*\)/g, ' '); // [Non-Halal], (Whole Cakes)
  s = s.split(/\s+-\s+|\s+@\s+/)[0] as string; // branch after " - "
  s = s.replace(/[^a-z0-9一-鿿& ]+/g, ' ').replace(NOISE_WORDS, ' ');
  const tokens = s.split(/\s+/).filter(Boolean);
  while (tokens.length > 1 && /^\d+$/.test(tokens[tokens.length - 1] as string)) tokens.pop(); // store / branch numbers
  return tokens.slice(0, 3).join(' ');
}

const isPrefix = (shorter: string, longer: string) => longer === shorter || longer.startsWith(`${shorter} `);

/** Learn from the person's own history: which category each merchant usually gets. */
export function buildMerchantMemory(expenses: { merchant?: string | null; category?: string | null }[]): MerchantMemory {
  const memory: MerchantMemory = new Map();
  for (const e of expenses) {
    if (!e || !e.merchant || !e.category) continue;
    const key = normalizeMerchant(e.merchant);
    if (!key) continue;
    let entry = memory.get(key);
    if (!entry) {
      entry = { counts: {}, total: 0, label: String(e.merchant).trim() };
      memory.set(key, entry);
    }
    entry.counts[e.category] = (entry.counts[e.category] ?? 0) + 1;
    entry.total += 1;
  }
  return memory;
}

export function lookupMemory(memory: MerchantMemory | null, merchant: string): { entry: MemoryEntry; key: string } | null {
  if (!memory || !merchant) return null;
  const key = normalizeMerchant(merchant);
  if (!key) return null;
  // Pool names where one starts with the other, so branches count as one place.
  const related: [string, MemoryEntry][] = [];
  for (const [k, entry] of memory) {
    if (k === key || (k.length >= 4 && key.length >= 4 && (isPrefix(k, key) || isPrefix(key, k)))) related.push([k, entry]);
  }
  const first = related[0];
  if (!first) return null;
  if (related.length === 1) return { entry: first[1], key: first[0] };
  const pooled: MemoryEntry = { counts: {}, total: 0, label: '' };
  let biggest = -1;
  for (const [, entry] of related) {
    for (const [cat, n] of Object.entries(entry.counts)) pooled.counts[cat] = (pooled.counts[cat] ?? 0) + n;
    pooled.total += entry.total;
    if (entry.total > biggest) {
      biggest = entry.total;
      pooled.label = entry.label;
    }
  }
  return { entry: pooled, key };
}

const BUILTIN_KEYS = ['food', 'beverages', 'travel', 'entertain', 'work', 'shopping', 'utilities', 'car', 'health', 'other'];

// Words that, together, say "this is a restaurant bill"
const RESTAURANT_CLUES = [
  /\bservice\s*charge\b/,
  /\btable\s*#?\s*\d*\b/,
  /\b(?:dine[- ]?in|take\s*-?\s*away|takeaway|cover\s*charge)\b/,
  /\b(?:starters?|mains?|desserts?|a\s*la\s*carte|set\s*(?:lunch|dinner|meal))\b/,
  /\b(?:lunch|dinner|breakfast|brunch)\b/,
  /\b(?:soup|pasta|steak|fries|burger|noodles?|nasi|mee|beverages?|drinks?)\b/,
];

export interface Hint {
  category?: string;
  reason?: string;
}

const categoryLabel = (categories: CategoryLite[], key: string): string => categories.find((x) => x.key === key)?.label ?? key;
const isUsable = (categories: CategoryLite[], key: string): boolean => categories.some((c) => c.key === key && c.active !== false);

export interface SuggestInput {
  merchant?: string;
  text?: string;
  memory?: MerchantMemory | null;
  categories?: CategoryLite[];
  hint?: Hint | null;
}

/** Suggests a category with a reason, or null when unsure. */
export function suggestCategory({ merchant = '', text = '', memory = null, categories = [], hint = null }: SuggestInput = {}): Suggestion | null {
  const result = (key: string, confidence: Suggestion['confidence'], source: Suggestion['source'], reason: string): Suggestion | null => (isUsable(categories, key) ? { key, label: categoryLabel(categories, key), confidence, source, reason } : null);

  // 1. Your own habits beat everything: you filed this place before
  const found = lookupMemory(memory, merchant);
  if (found) {
    const { entry } = found;
    const top = Object.entries(entry.counts).sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] / entry.total >= 0.6) {
      const [topKey, topCount] = top;
      const label = categoryLabel(categories, topKey);
      const shown = String(merchant).trim() || entry.label; // quote the name the person typed, not another branch's
      const reason = entry.total === 1 ? `Last time you logged "${shown}" as ${label}` : `You've logged "${shown}" as ${label} ${topCount} of ${entry.total} times`;
      const r = result(topKey, entry.total >= 3 ? 'high' : 'medium', 'history', reason);
      if (r) return r;
    }
  }

  // 2. The receipt itself says what it is (Grab food, Grab ride...)
  if (hint && hint.category) {
    const r = result(hint.category, 'high', 'receipt', hint.reason || 'This receipt is a Grab food order');
    if (r) return r;
  }

  // 3. Built-in merchants and keywords: the merchant name first, then the rest of the text
  const name = fold(merchant);
  const body = fold(text).slice(0, 4000);
  const shortNote = body.length <= SHORT_NOTE;
  for (const [key, confidence, pattern] of KNOWN) {
    const m = name.match(pattern);
    if (m) {
      const r = result(key, confidence, 'known', `"${m[0].trim()}" is usually ${categoryLabel(categories, key)}`);
      if (r) return r;
    }
  }
  for (const [key, confidence, pattern] of KNOWN) {
    if (confidence !== 'high') continue; // loose words in a long receipt are too noisy
    const m = body.match(pattern);
    if (m) { const r = result(key, 'medium', 'known', `${shortNote ? 'Your note mentions' : 'The receipt mentions'} "${m[0].trim()}"`); if (r) return r; }
  }
  if (shortNote) {
    for (const [key, confidence, pattern] of KNOWN) {
      if (confidence !== 'medium') continue;
      const m = body.match(pattern);
      if (m) { const r = result(key, 'medium', 'known', `Your note mentions "${m[0].trim()}"`); if (r) return r; }
    }
  }
  for (const [key, confidence, pattern] of KNOWN) {
    if (confidence !== 'medium') continue;
    const m = name.match(pattern);
    if (m) {
      const r = result(key, 'low', 'known', `"${m[0].trim()}" suggests ${categoryLabel(categories, key)}`);
      if (r) return r;
    }
  }

  // 3b. Looks like a restaurant bill (needs two clues, so one stray word is not enough).
  if (RESTAURANT_CLUES.filter((re) => re.test(body)).length >= 2) {
    const r = result('food', 'medium', 'known', 'The receipt looks like a restaurant bill (service charge, table, menu items)');
    if (r) return r;
  }

  // 4. The person's own category names. Built-in names are skipped so receipt small print can't mislead.
  const haystack = `${name} ${body.slice(0, 200)}`;
  for (const c of categories) {
    if (c.active === false || c.key === 'other' || c.is_builtin === true || BUILTIN_KEYS.includes(c.key)) continue;
    const label = String(c.label || '').toLowerCase().trim();
    if (label.length < 4) continue;
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\b${escaped}\\b`).test(haystack)) return { key: c.key, label: c.label, confidence: 'medium', source: 'name', reason: `Matches your "${c.label}" category` };
  }
  return null;
}
