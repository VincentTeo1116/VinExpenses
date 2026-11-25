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

/** Boxes as fractions of the image, so they follow it at any size. Hidden if they do not fit inside the image. */
export function toFractions(boxes: Box[], width: number, height: number): Box[] {
  if (!width || !height) return [];
  const out = boxes.map((b) => ({ x: b.x / width, y: b.y / height, w: b.w / width, h: b.h / height }));
  return out.every((b) => b.x >= 0 && b.y >= 0 && b.x + b.w <= 1.02 && b.y + b.h <= 1.02) ? out : [];
}
