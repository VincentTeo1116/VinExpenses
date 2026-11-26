// SP-06: rebuilds the rows of a receipt from where each word sits on the photo, so a price stays on the same row as its item even when the photo is tilted.
export interface PlacedWord {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? (sorted[Math.floor((sorted.length - 1) / 2)] as number) : 0;
};

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface PlacedRow {
  text: string;
  box: Box;
}

interface Spot {
  word: PlacedWord;
  x: number;
  y: number;
}

/** Groups words into rows by height after turning the page flat; returns the rows top to bottom, each as text with a wider gap between columns. */
export function placedRows(words: PlacedWord[]): PlacedRow[] {
  const usable = words.filter((w) => w.text.trim() && w.x1 > w.x0 && w.y1 > w.y0);
  if (usable.length === 0) return [];
  const height = median(usable.map((w) => w.y1 - w.y0));
  const spots = (angle: number): Spot[] => {
    const cos = Math.cos(-angle);
    const sin = Math.sin(-angle);
    return usable.map((word) => {
      const cx = (word.x0 + word.x1) / 2;
      const cy = (word.y0 + word.y1) / 2;
      return { word, x: cx * cos - cy * sin, y: cx * sin + cy * cos };
    });
  };
  const cluster = (list: Spot[]): Spot[][] => {
    const sorted = [...list].sort((a, b) => a.y - b.y);
    const rows: Spot[][] = [];
    for (const spot of sorted) {
      const last = rows[rows.length - 1];
      const mean = last ? last.reduce((s, p) => s + p.y, 0) / last.length : 0;
      if (last && Math.abs(spot.y - mean) <= height * 0.6) last.push(spot);
      else rows.push([spot]);
    }
    return rows;
  };

  // the tilt of the page: the typical slope between two words far apart on the same row (words of other rows are too far down to pair)
  const slopes: number[] = [];
  const sample = usable.length > 400 ? usable.filter((_, i) => i % Math.ceil(usable.length / 400) === 0) : usable;
  for (let i = 0; i < sample.length; i += 1) {
    for (let j = i + 1; j < sample.length; j += 1) {
      const a = sample[i] as PlacedWord;
      const b = sample[j] as PlacedWord;
      const dx = (b.x0 + b.x1) / 2 - (a.x0 + a.x1) / 2;
      const dy = (b.y0 + b.y1) / 2 - (a.y0 + a.y1) / 2;
      if (Math.abs(dx) > height * 6 && Math.abs(dy) < height * 1.2) slopes.push(dy / dx);
    }
  }
  const tilt = slopes.length >= 3 ? Math.atan(median(slopes)) : 0;
  const rows = cluster(spots(Math.abs(tilt) < 0.4 ? tilt : 0));

  const charWidth = median(usable.map((w) => (w.x1 - w.x0) / Math.max(1, w.text.length)));
  return rows
    .map((row) => row.sort((a, b) => a.x - b.x))
    .map((row) => ({
      text: row
        .map((spot, i) => {
          const before = row[i - 1];
          const gap = before ? spot.word.x0 - before.word.x1 : 0;
          return `${i === 0 ? '' : gap > charWidth * 3 ? '  ' : ' '}${spot.word.text.trim()}`;
        })
        .join(''),
      // the box that holds the row's words, in the photo's own pixels
      box: { x0: Math.min(...row.map((s) => s.word.x0)), y0: Math.min(...row.map((s) => s.word.y0)), x1: Math.max(...row.map((s) => s.word.x1)), y1: Math.max(...row.map((s) => s.word.y1)) },
    }))
    .filter((row) => row.text.trim());
}

/** The rows as plain text, top to bottom. */
export const rowsFromWords = (words: PlacedWord[]): string[] => placedRows(words).map((row) => row.text);
