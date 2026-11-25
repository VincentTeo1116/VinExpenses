// RX-03: which words on the receipt photo the total came from, so the app can mark them for the person to confirm at a glance.

export interface OcrWord { t: string; x: number; y: number; w: number; h: number }
export interface Box { x: number; y: number; w: number; h: number }

const valueOf = (raw: string): number => {
  const s = raw.replace(/^(?:RM|MYR|R\.M\.?)/i, '').replace(/[^\d.,]/g, '');
  if (!s) return NaN;
  if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(s)) return Number(s.replace(/,/g, ''));
  if (/^\d+,\d{2}$/.test(s)) return Number(s.replace(',', '.'));
  if (/^\d+(\.\d{1,2})?$/.test(s)) return Number(s);
  return NaN;
};

/** The words that read as this amount (the lowest one on the page last, since totals sit near the bottom). Up to two are returned. */
export function findAmountBoxes(words: OcrWord[], amount: number): Box[] {
  if (!amount || !words.length) return [];
  const hits = words.filter((word) => Math.abs(valueOf(word.t) - amount) < 0.005 && /\d[.,]\d{2}$/.test(word.t.replace(/[^\d.,]/g, '')));
  return hits.sort((a, b) => a.y - b.y).slice(-2).map(({ x, y, w, h }) => ({ x, y, w, h }));
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** The words of one receipt line (the shop name, the date line), as a single box. A line is found by its words in order, so a few misread words still match. */
export function findPhraseBox(words: OcrWord[], phrase: string): Box[] {
  const tokens = phrase.split(/\s+/).map(norm).filter(Boolean).slice(0, 8);
  if (!tokens.length || !words.length) return [];
  const need = Math.min(tokens.length, 2);
  let best: OcrWord[] = [];
  for (let i = 0; i < words.length; i += 1) {
    if (norm((words[i] as OcrWord).t) !== tokens[0]) continue;
    const run: OcrWord[] = [words[i] as OcrWord];
    let next = 1;
    for (let j = i + 1; j < words.length && next < tokens.length && j < i + tokens.length + 3; j += 1) {
      if (norm((words[j] as OcrWord).t) === tokens[next]) {
        run.push(words[j] as OcrWord);
        next += 1;
      }
    }
    if (run.length >= need && run.length > best.length) best = run;
  }
  if (!best.length) return [];
  const x = Math.min(...best.map((w) => w.x));
  const y = Math.min(...best.map((w) => w.y));
  const right = Math.max(...best.map((w) => w.x + w.w));
  const bottom = Math.max(...best.map((w) => w.y + w.h));
  return [{ x, y, w: right - x, h: bottom - y }];
}

/** Boxes as fractions of the image, so they follow it at any size. Hidden if they do not fit inside the image. */
export function toFractions(boxes: Box[], width: number, height: number): Box[] {
  if (!width || !height) return [];
  const out = boxes.map((b) => ({ x: b.x / width, y: b.y / height, w: b.w / width, h: b.h / height }));
  return out.every((b) => b.x >= 0 && b.y >= 0 && b.x + b.w <= 1.02 && b.y + b.h <= 1.02) ? out : [];
}
