// Draws the bot's charts as PNG images, with no outside libraries (so nothing to pay for, nothing to download,
// and your friends' spending numbers never leave your own server).
//
// The pictures contain NO text on purpose: names, amounts and percentages are in the message caption, which means
// no fonts are needed (Malay and Chinese work exactly like English) and screen readers read the caption.
// The slice colours match the coloured emoji squares used in the caption legend (🟦🟧🟩🟨🟪🟥🟫⬛⬜), in the same order.

export type RGB = [number, number, number];

/** Colours in the same order as SQUARES. The last one (light grey) is used for "Others". */
export const PALETTE: RGB[] = [
  [47, 111, 208], // 🟦
  [242, 140, 40], // 🟧
  [59, 165, 93], // 🟩
  [242, 194, 48], // 🟨
  [142, 92, 200], // 🟪
  [214, 69, 69], // 🟥
  [139, 94, 60], // 🟫
  [51, 51, 51], // ⬛
  [190, 196, 208], // ⬜
];
export const SQUARES = ["🟦", "🟧", "🟩", "🟨", "🟪", "🟥", "🟫", "⬛", "⬜"];

const BACKGROUND: RGB = [247, 248, 252];
const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);

// ---------------------------------------------------------------- a tiny canvas

class Canvas {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
  constructor(width: number, height: number, background: RGB) {
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height * 3);
    for (let i = 0; i < this.data.length; i += 3) {
      this.data[i] = background[0];
      this.data[i + 1] = background[1];
      this.data[i + 2] = background[2];
    }
  }
  /** Mixes `color` into the pixel by `alpha` (0..1): this is what makes edges smooth. */
  blend(x: number, y: number, color: RGB, alpha: number): void {
    if (alpha <= 0 || x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const a = alpha > 1 ? 1 : alpha;
    const i = (y * this.width + x) * 3;
    this.data[i] = Math.round(this.data[i] * (1 - a) + color[0] * a);
    this.data[i + 1] = Math.round(this.data[i + 1] * (1 - a) + color[1] * a);
    this.data[i + 2] = Math.round(this.data[i + 2] * (1 - a) + color[2] * a);
  }
}

// ---------------------------------------------------------------- PNG encoding

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** zlib stream made only of "stored" blocks: bigger, but needs nothing from the runtime. Used if compression is unavailable. */
export function zlibStored(raw: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(raw.length / 65535));
  const out = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  out[0] = 0x78;
  out[1] = 0x01;
  let offset = 2;
  for (let i = 0; i < blocks; i++) {
    const start = i * 65535;
    const length = Math.min(65535, raw.length - start);
    out[offset++] = i === blocks - 1 ? 1 : 0;
    out[offset++] = length & 0xff;
    out[offset++] = (length >>> 8) & 0xff;
    out[offset++] = ~length & 0xff;
    out[offset++] = (~length >>> 8) & 0xff;
    out.set(raw.subarray(start, start + length), offset);
    offset += length;
  }
  const sum = adler32(raw);
  out[offset++] = (sum >>> 24) & 0xff;
  out[offset++] = (sum >>> 16) & 0xff;
  out[offset++] = (sum >>> 8) & 0xff;
  out[offset++] = sum & 0xff;
  return out;
}

async function zlibCompress(raw: Uint8Array): Promise<Uint8Array> {
  try {
    // deno-lint-ignore no-explicit-any
    const Compression = (globalThis as any).CompressionStream;
    if (typeof Compression !== "function") return zlibStored(raw);
    const stream = new Blob([raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer]).stream().pipeThrough(new Compression("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch (_error) {
    return zlibStored(raw);
  }
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

export async function encodePng(width: number, height: number, rgb: Uint8Array): Promise<Uint8Array> {
  const stride = width * 3;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type 0: none
    raw.set(rgb.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: RGB (no transparency, so Telegram's JPEG conversion can not turn it black)
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", await zlibCompress(raw)),
    chunk("IEND", new Uint8Array(0)),
  ];
  const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) { png.set(part, at); at += part.length; }
  return png;
}

// ---------------------------------------------------------------- donut

export interface DonutOptions {
  width?: number;
  height?: number;
}

/**
 * A ring split into slices, clockwise from the top, biggest first. Slices are separated by a thin gap.
 * `values` that are zero, negative or not numbers are ignored. All-zero data draws an empty grey ring.
 */
export async function renderDonutPng(values: number[], options: DonutOptions = {}): Promise<Uint8Array> {
  const width = options.width ?? 720;
  const height = options.height ?? 440;
  const canvas = new Canvas(width, height, BACKGROUND);
  const cx = width / 2;
  const cy = height / 2;
  const outer = Math.min(width, height) / 2 - 24;
  const inner = outer * 0.6;
  const gap = 5; // pixels between slices

  const clean = values.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const total = clean.reduce((a, b) => a + b, 0);
  const slices: { start: number; end: number; color: RGB }[] = [];
  let angle = 0;
  clean.forEach((value, index) => {
    if (value <= 0) return;
    const sweep = (value / total) * Math.PI * 2;
    slices.push({ start: angle, end: angle + sweep, color: PALETTE[index % PALETTE.length] });
    angle += sweep;
  });

  const x0 = Math.max(0, Math.floor(cx - outer - 2));
  const x1 = Math.min(width - 1, Math.ceil(cx + outer + 2));
  const y0 = Math.max(0, Math.floor(cy - outer - 2));
  const y1 = Math.min(height - 1, Math.ceil(cy + outer + 2));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const distance = Math.hypot(dx, dy);
      const ring = clamp01(outer + 0.5 - distance) * clamp01(distance - inner + 0.5);
      if (ring <= 0) continue;
      if (!slices.length) { canvas.blend(x, y, [226, 229, 238], ring); continue; }
      let theta = Math.atan2(dx, -dy); // 0 at the top, increasing clockwise
      if (theta < 0) theta += Math.PI * 2;
      const slice = slices.find((s) => theta >= s.start && theta < s.end) ?? slices[slices.length - 1];
      let coverage = ring;
      if (slices.length > 1) {
        const toEdge = Math.min((theta - slice.start) * distance, (slice.end - theta) * distance);
        coverage *= clamp01(toEdge - gap / 2 + 0.5);
      }
      canvas.blend(x, y, slice.color, coverage);
    }
  }
  return encodePng(width, height, canvas.data);
}

// ---------------------------------------------------------------- bars

export interface BarsOptions {
  width?: number;
  height?: number;
  /** The tallest bar gets the accent colour. */
  highlight?: number;
  /** A dot under this bar (today). */
  marker?: number;
  /** Bars that have not happened yet: drawn very faint. */
  muted?: boolean[];
}

const BAR: RGB = [91, 141, 239];
const BAR_HIGH: RGB = [242, 140, 40];
const BAR_MUTED: RGB = [222, 226, 238];
const GRID: RGB = [232, 235, 243];
const BASELINE: RGB = [205, 210, 225];
const DOT: RGB = [51, 51, 51];

/** Coverage (0..1) of a rectangle whose TOP corners are rounded, anti-aliased. */
function topRounded(px: number, py: number, left: number, top: number, right: number, bottom: number, radius: number): number {
  let signed: number;
  const r = Math.min(radius, (right - left) / 2, bottom - top);
  if (py < top + r && (px < left + r || px > right - r)) {
    const cx = px < left + r ? left + r : right - r;
    signed = Math.hypot(px - cx, py - (top + r)) - r;
  } else {
    signed = Math.max(left - px, px - right, top - py, py - bottom);
  }
  return clamp01(0.5 - signed);
}

export async function renderBarsPng(values: number[], options: BarsOptions = {}): Promise<Uint8Array> {
  const width = options.width ?? 720;
  const height = options.height ?? 380;
  const canvas = new Canvas(width, height, BACKGROUND);
  const clean = values.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const count = Math.max(1, clean.length);
  const left = 36;
  const right = width - 36;
  const top = 28;
  const baseline = height - 64;
  const plotHeight = baseline - top;
  const slot = (right - left) / count;
  const barWidth = slot * 0.58;
  const max = Math.max(0, ...clean);

  for (const share of [0.25, 0.5, 0.75, 1]) { // faint guide lines
    const y = Math.round(baseline - plotHeight * share);
    for (let x = left; x < right; x++) canvas.blend(x, y, GRID, 1);
  }
  for (let x = left; x < right; x++) { canvas.blend(x, baseline, BASELINE, 1); canvas.blend(x, baseline + 1, BASELINE, 1); }

  clean.forEach((value, index) => {
    const x0 = left + slot * index + (slot - barWidth) / 2;
    const x1 = x0 + barWidth;
    const muted = options.muted?.[index] === true;
    const heightPx = max > 0 && value > 0 ? Math.max(6, (value / max) * plotHeight) : 0;
    const colour = muted ? BAR_MUTED : index === options.highlight ? BAR_HIGH : BAR;
    if (heightPx > 0) {
      const y0 = baseline - heightPx;
      for (let y = Math.floor(y0) - 1; y <= baseline; y++) {
        for (let x = Math.floor(x0) - 1; x <= Math.ceil(x1) + 1; x++) {
          canvas.blend(x, y, colour, topRounded(x + 0.5, y + 0.5, x0, y0, x1, baseline, 10));
        }
      }
    } else {
      // an empty day is a small dot on the baseline, so "nothing" is visibly different from "missing"
      const centerX = (x0 + x1) / 2;
      for (let y = baseline - 7; y <= baseline + 1; y++) {
        for (let x = Math.floor(centerX) - 8; x <= Math.ceil(centerX) + 8; x++) {
          canvas.blend(x, y, muted ? BAR_MUTED : BASELINE, clamp01(5 - Math.hypot(x + 0.5 - centerX, y + 0.5 - baseline)));
        }
      }
    }
    if (options.marker === index) {
      const centerX = (x0 + x1) / 2;
      const centerY = baseline + 30;
      for (let y = Math.floor(centerY) - 8; y <= Math.ceil(centerY) + 8; y++) {
        for (let x = Math.floor(centerX) - 8; x <= Math.ceil(centerX) + 8; x++) {
          canvas.blend(x, y, DOT, clamp01(7 - Math.hypot(x + 0.5 - centerX, y + 0.5 - centerY)));
        }
      }
    }
  });
  return encodePng(width, height, canvas.data);
}

// ---------------------------------------------------------------- budget progress bars

const TRACK: RGB = [229, 232, 241];
const OK: RGB = [59, 165, 93]; // under 80%
const WATCH: RGB = [242, 194, 48]; // 80% to 100%
const OVER: RGB = [214, 69, 69]; // over budget
const OVER_CAP: RGB = [140, 38, 38];
const TICK: RGB = [186, 192, 208];

/** Coverage (0..1) of a rounded rectangle (all four corners), anti-aliased. */
function rounded(px: number, py: number, left: number, top: number, right: number, bottom: number, radius: number): number {
  const r = Math.min(radius, (right - left) / 2, (bottom - top) / 2);
  const dx = Math.max(left + r - px, 0, px - (right - r));
  const dy = Math.max(top + r - py, 0, py - (bottom - r));
  const outside = Math.hypot(dx, dy) - r;
  const edge = Math.max(left - px, px - right, top - py, py - bottom); // straight edges
  return clamp01(0.5 - (dx > 0 || dy > 0 ? outside : edge));
}

export interface ProgressOptions {
  width?: number;
}

/**
 * One horizontal bar per budget (top to bottom, in the order given): green under 80%, amber to 100%, red when over,
 * with a faint tick at 80% and a dark cap on the end of bars that went over. `ratios` are used / limit (1 = 100%).
 * At most 10 bars are drawn. Like the other charts it has no text: the caption names every bar.
 */
export async function renderProgressPng(ratios: number[], options: ProgressOptions = {}): Promise<Uint8Array> {
  const clean = ratios.slice(0, 10).map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const rows = Math.max(1, clean.length);
  const width = options.width ?? 720;
  const rowHeight = 58;
  const height = 24 + rows * rowHeight + 8;
  const canvas = new Canvas(width, height, BACKGROUND);
  const left = 36;
  const right = width - 36;
  const trackWidth = right - left;
  const barHeight = 26;

  clean.forEach((ratio, index) => {
    const top = 24 + index * rowHeight + (rowHeight - barHeight) / 2;
    const bottom = top + barHeight;
    const fillRight = left + Math.max(barHeight, Math.min(1, ratio) * trackWidth); // never thinner than a dot
    const colour = ratio > 1 ? OVER : ratio >= 0.8 ? WATCH : OK;
    const tickX = left + trackWidth * 0.8;
    for (let y = Math.floor(top) - 1; y <= Math.ceil(bottom) + 1; y++) {
      for (let x = left - 1; x <= right + 1; x++) {
        canvas.blend(x, y, TRACK, rounded(x + 0.5, y + 0.5, left, top, right, bottom, barHeight / 2));
        if (ratio > 0 && x + 0.5 <= fillRight + 1) canvas.blend(x, y, colour, rounded(x + 0.5, y + 0.5, left, top, fillRight, bottom, barHeight / 2));
        if (Math.abs(x + 0.5 - tickX) < 1.1 && y >= top && y <= bottom && x + 0.5 > fillRight) canvas.blend(x, y, TICK, 0.9);
        if (ratio > 1 && x + 0.5 > right - 16 && x + 0.5 < right - 10 && y >= top + 5 && y <= bottom - 5) canvas.blend(x, y, OVER_CAP, 0.95);
      }
    }
  });
  return encodePng(width, height, canvas.data);
}
