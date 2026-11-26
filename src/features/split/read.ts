// SP-07: reads a scanned receipt both ways (rows rebuilt from word positions, and the reader's own text lines) and keeps the one that reconciles better.
import { audit, type Audit } from './audit';
import { parseReceipt, type ParsedReceipt } from './parse';
import { placedRows, type Box, type PlacedRow, type PlacedWord } from './rows';

export interface Reading {
  parsed: ParsedReceipt;
  audit: Audit;
  /** Which way of reading won. */
  from: 'positions' | 'text';
  /** Where each line (by its id) sits on the photo; empty when the reading came from text alone. */
  boxes: Record<string, Box>;
  /** The four areas worth showing on the photo: shop name, date, all the items, and the total. */
  regions: Regions;
}

export interface Regions {
  merchant?: Box;
  date?: Box;
  items?: Box;
  total?: Box;
}

export interface Hints {
  merchant?: string;
}

const DATE_ROW = /\b(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}[/.-]\d{1,2}[/.-]\d{1,2}|\d{1,2}[ -](?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[ ,-]*\d{2,4})\b/i;
const TOTAL_WORD = /total|jumlah|grand|payable|amount due|合计|总计|总额|应付/i;
const NOT_TOTAL = /sub ?-?total|cash|tender|change|visa|master|card|debit|credit|tng|touch|duit|paid|baki|tunai/i;
const plain = (s: string) => s.toLowerCase().replace(/[^a-z0-9一-鿿]/g, '');
const union = (boxes: Box[]): Box | undefined => (boxes.length ? boxes.reduce((a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) })) : undefined);
const centsIn = (text: string): number[] => (text.replace(/,/g, '').match(/\d+\.\d{2}/g) ?? []).map((m) => Math.round(parseFloat(m) * 100));

/** Finds the shop name, the date, the whole items area and the total among the rows (each is left out when it cannot be told). */
function regionsFor(rows: PlacedRow[], parsed: ParsedReceipt, boxes: Record<string, Box>, hints: Hints): Regions {
  const out: Regions = {};
  const shop = plain(hints.merchant ?? '');
  const head = rows.slice(0, 10);
  const named = shop.length >= 3 ? head.filter((r) => plain(r.text).length >= 3 && (shop.includes(plain(r.text)) || plain(r.text).includes(shop))) : [];
  const first = named.length ? named : head.filter((r) => /[A-Za-z一-鿿]{3}/.test(r.text) && !DATE_ROW.test(r.text) && centsIn(r.text).length === 0).slice(0, 1);
  const merchant = union(first.map((r) => r.box));
  if (merchant) out.merchant = merchant;
  const dated = rows.find((r) => DATE_ROW.test(r.text));
  if (dated) out.date = dated.box;
  const items = union(Object.values(boxes));
  if (items) out.items = items;
  const total = parsed.bill.totalCents;
  if (total != null) {
    const hit = rows.filter((r) => centsIn(r.text).includes(total) && !NOT_TOTAL.test(r.text));
    const named = hit.filter((r) => TOTAL_WORD.test(r.text));
    const pick = (named.length ? named : hit).at(-1);
    if (pick) out.total = pick.box;
  }
  return out;
}

/** Pairs each line with the row it was read from, in order, so two identical rows are not mixed up. */
function boxesFor(parsed: ParsedReceipt, rows: { text: string; box: Box }[]): Record<string, Box> {
  const used = new Set<number>();
  const found: Record<string, Box> = {};
  for (const line of parsed.bill.lines) {
    const same = (x: string) => x.replace(/\s+/g, ' ').trim();
    const at = rows.findIndex((row, i) => !used.has(i) && same(row.text) === same(line.raw ?? ''));
    if (at >= 0) {
      used.add(at);
      found[line.id] = (rows[at] as { box: Box }).box;
    }
  }
  return found;
}

const RANK = { verified: 2, check: 1, unverified: 0 } as const;

/** A higher score is a better reading: verified first, then more passing checks, then more lines found. */
export function scoreOf(a: Audit, lines: number): number {
  return RANK[a.status] * 1000 + a.checks.filter((c) => c.ok).length * 20 + Math.min(lines, 40);
}

/** The best reading among several passes over the same photo (same pixel space, so the boxes still fit). */
export function bestReading(reads: { text: string; words: PlacedWord[] }[], hints: Hints = {}): Reading {
  const all = reads.map((r) => readReceipt(r.text, r.words, hints));
  return all.reduce((best, next) => (scoreOf(next.audit, next.parsed.bill.lines.length) > scoreOf(best.audit, best.parsed.bill.lines.length) ? next : best));
}

export function readReceipt(text: string, words: PlacedWord[] = [], hints: Hints = {}): Reading {
  const candidates: Reading[] = [];
  if (words.length >= 6) {
    const rows = placedRows(words);
    const parsed = parseReceipt(rows.map((r) => r.text).join('\n'));
    const boxes = boxesFor(parsed, rows);
    candidates.push({ parsed, audit: audit(parsed.bill), from: 'positions', boxes, regions: regionsFor(rows, parsed, boxes, hints) });
  }
  const parsed = parseReceipt(text);
  candidates.push({ parsed, audit: audit(parsed.bill), from: 'text', boxes: {}, regions: {} });
  return candidates.reduce((best, next) => (scoreOf(next.audit, next.parsed.bill.lines.length) > scoreOf(best.audit, best.parsed.bill.lines.length) ? next : best));
}
