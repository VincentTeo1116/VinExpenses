// SP-08: gets a receipt photo ready to be read: straightens a tilted page and stretches the contrast so faint print stands out.
// The maths works on plain grey values (testable without a screen); only prepare() touches a canvas.

/** Grey value of each pixel, 0 (black) to 255 (white), from RGBA data. */
export function toGrey(rgba: Uint8ClampedArray | number[]): Uint8Array {
  const out = new Uint8Array(rgba.length / 4);
  for (let i = 0; i < out.length; i += 1) out[i] = Math.round((rgba[i * 4] as number) * 0.299 + (rgba[i * 4 + 1] as number) * 0.587 + (rgba[i * 4 + 2] as number) * 0.114);
  return out;
}

/** Otsu's threshold: the grey value that best splits dark print from light paper. */
export function otsu(grey: Uint8Array): number {
  const hist = new Array<number>(256).fill(0);
  for (const g of grey) hist[g] = (hist[g] as number) + 1;
  const total = grey.length;
  let sum = 0;
  for (let t = 0; t < 256; t += 1) sum += t * (hist[t] as number);
  let sumB = 0;
  let weightB = 0;
  let best = 0;
  let threshold = 127;
  for (let t = 0; t < 256; t += 1) {
    weightB += hist[t] as number;
    if (weightB === 0) continue;
    const weightF = total - weightB;
    if (weightF === 0) break;
    sumB += t * (hist[t] as number);
    const between = weightB * weightF * (sumB / weightB - (sum - sumB) / weightF) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

/** The tilt, in degrees, that makes the rows of print line up best: the angle where the row-by-row ink totals vary the most. */
export function bestTilt(grey: Uint8Array, width: number, height: number, maxDegrees = 8, step = 0.5): number {
  const cut = otsu(grey);
  const ink: [number, number][] = [];
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) if ((grey[y * width + x] as number) <= cut) ink.push([x - width / 2, y - height / 2]);
  if (ink.length < 50) return 0;
  const sample = ink.length > 20000 ? ink.filter((_, i) => i % Math.ceil(ink.length / 20000) === 0) : ink;
  let best = 0;
  let bestScore = -1;
  for (let deg = -maxDegrees; deg <= maxDegrees + 1e-9; deg += step) {
    const a = (deg * Math.PI) / 180;
    const sin = Math.sin(a);
    const cos = Math.cos(a);
    const rows = new Map<number, number>();
    for (const [x, y] of sample) {
      const rowKey = Math.round(x * sin + y * cos);
      rows.set(rowKey, (rows.get(rowKey) ?? 0) + 1);
    }
    let score = 0;
    for (const count of rows.values()) score += count * count;
    if (score > bestScore) {
      bestScore = score;
      best = deg;
    }
  }
  return Math.abs(best) < step ? 0 : best;
}

/** The lowest and highest grey that matter (ignoring the extreme 1%), used to stretch faint print to full contrast. */
export function levels(grey: Uint8Array): { low: number; high: number } {
  const hist = new Array<number>(256).fill(0);
  for (const g of grey) hist[g] = (hist[g] as number) + 1;
  const cut = grey.length * 0.01;
  let low = 0;
  let seen = 0;
  while (low < 255 && seen + (hist[low] as number) < cut) seen += hist[low++] as number;
  let high = 255;
  seen = 0;
  while (high > 0 && seen + (hist[high] as number) < cut) seen += hist[high--] as number;
  return high - low < 40 ? { low: 0, high: 255 } : { low, high };
}

/** Turns grey values by `deg` about the centre exactly as a canvas does (clockwise positive); the corners left empty are white. */
export function rotateGrey(grey: Uint8Array, width: number, height: number, deg: number): Uint8Array {
  const out = new Uint8Array(grey.length).fill(255);
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - width / 2;
      const dy = y - height / 2;
      const sx = Math.round(dx * cos + dy * sin + width / 2);
      const sy = Math.round(-dx * sin + dy * cos + height / 2);
      if (sx >= 0 && sx < width && sy >= 0 && sy < height) out[y * width + x] = grey[sy * width + sx] as number;
    }
  }
  return out;
}

export const stretch = (value: number, low: number, high: number): number => Math.max(0, Math.min(255, Math.round(((value - low) / (high - low)) * 255)));

/** Blurs each row then each column with a window of 2r+1 (running sums, edges repeat). */
export function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const n = 2 * r + 1;
  for (let y = 0; y < h; y += 1) {
    const row = y * w;
    let sum = 0;
    for (let k = -r; k <= r; k += 1) sum += src[row + Math.min(w - 1, Math.max(0, k))] as number;
    for (let x = 0; x < w; x += 1) {
      tmp[row + x] = sum / n;
      sum += (src[row + Math.min(w - 1, x + r + 1)] as number) - (src[row + Math.max(0, x - r)] as number);
    }
  }
  for (let x = 0; x < w; x += 1) {
    let sum = 0;
    for (let k = -r; k <= r; k += 1) sum += tmp[Math.min(h - 1, Math.max(0, k)) * w + x] as number;
    for (let y = 0; y < h; y += 1) {
      out[y * w + x] = sum / n;
      sum += (tmp[Math.min(h - 1, y + r + 1) * w + x] as number) - (tmp[Math.max(0, y - r) * w + x] as number);
    }
  }
  return out;
}

/** Evens out shadows and glare: divides each pixel by the paper brightness around it, so the paper goes white and the print stays dark. */
export function flatten(grey: Uint8Array, width: number, height: number): Uint8Array {
  const b = Math.max(1, Math.ceil(Math.max(width, height) / 160));
  const sw = Math.ceil(width / b);
  const sh = Math.ceil(height / b);
  let paper: Float32Array = new Float32Array(sw * sh);
  for (let by = 0; by < sh; by += 1) {
    for (let bx = 0; bx < sw; bx += 1) {
      let top = 0;
      for (let y = by * b; y < Math.min(height, (by + 1) * b); y += 1) for (let x = bx * b; x < Math.min(width, (bx + 1) * b); x += 1) top = Math.max(top, grey[y * width + x] as number);
      paper[by * sw + bx] = top;
    }
  }
  paper = boxBlur(paper, sw, sh, Math.max(2, Math.round(Math.min(sw, sh) / 10)));
  const out = new Uint8Array(grey.length);
  for (let y = 0; y < height; y += 1) {
    const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) / b - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(sh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < width; x += 1) {
      const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) / b - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(sw - 1, x0 + 1);
      const tx = fx - x0;
      const top = (paper[y0 * sw + x0] as number) * (1 - tx) + (paper[y0 * sw + x1] as number) * tx;
      const bottom = (paper[y1 * sw + x0] as number) * (1 - tx) + (paper[y1 * sw + x1] as number) * tx;
      const bg = Math.max(40, top * (1 - ty) + bottom * ty);
      out[y * width + x] = Math.min(255, Math.round(((grey[y * width + x] as number) * 255) / bg));
    }
  }
  return out;
}

/** Unsharp mask: pushes each pixel away from its blurred surroundings so thin strokes stand out. */
export function sharpen(grey: Uint8Array, width: number, height: number, amount = 0.6, radius = 2): Uint8Array {
  const blur = boxBlur(Float32Array.from(grey), width, height, radius);
  const out = new Uint8Array(grey.length);
  for (let i = 0; i < grey.length; i += 1) {
    const g = grey[i] as number;
    out[i] = Math.max(0, Math.min(255, Math.round(g + amount * (g - (blur[i] as number)))));
  }
  return out;
}

export interface PaperBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The rectangle holding the paper (the largest bright patch), or null when it fills the picture or cannot be told apart from the background. */
export function paperBox(grey: Uint8Array, width: number, height: number): PaperBox | null {
  const b = Math.max(1, Math.ceil(Math.max(width, height) / 160));
  const sw = Math.ceil(width / b);
  const sh = Math.ceil(height / b);
  const mean = new Uint8Array(sw * sh);
  for (let by = 0; by < sh; by += 1) {
    for (let bx = 0; bx < sw; bx += 1) {
      let sum = 0;
      let count = 0;
      for (let y = by * b; y < Math.min(height, (by + 1) * b); y += 1) {
        for (let x = bx * b; x < Math.min(width, (bx + 1) * b); x += 1) {
          sum += grey[y * width + x] as number;
          count += 1;
        }
      }
      mean[by * sw + bx] = Math.round(sum / count);
    }
  }
  const cut = otsu(mean);
  let mask: Uint8Array = new Uint8Array(sw * sh);
  for (let i = 0; i < mask.length; i += 1) mask[i] = (mean[i] as number) > cut ? 1 : 0;
  const grow = (m: Uint8Array, want: number): Uint8Array => {
    const next = new Uint8Array(m.length);
    for (let y = 0; y < sh; y += 1) {
      for (let x = 0; x < sw; x += 1) {
        let hit = want === 1 ? 0 : 1;
        for (let dy = -2; dy <= 2; dy += 1) {
          for (let dx = -2; dx <= 2; dx += 1) {
            const xx = x + dx;
            const yy = y + dy;
            const v = xx < 0 || yy < 0 || xx >= sw || yy >= sh ? (want === 1 ? 0 : 1) : (m[yy * sw + xx] as number);
            if (want === 1 && v === 1) hit = 1;
            if (want === 0 && v === 0) hit = 0;
          }
        }
        next[y * sw + x] = hit;
      }
    }
    return next;
  };
  mask = grow(grow(mask, 1), 0); // close small gaps left by print
  const seen = new Uint8Array(mask.length);
  let best: { area: number; x0: number; y0: number; x1: number; y1: number } | null = null;
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || seen[start]) continue;
    const stack = [start];
    seen[start] = 1;
    let area = 0;
    let x0 = sw;
    let y0 = sh;
    let x1 = 0;
    let y1 = 0;
    while (stack.length) {
      const at = stack.pop() as number;
      const x = at % sw;
      const y = Math.floor(at / sw);
      area += 1;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
      for (const next of [at - 1, at + 1, at - sw, at + sw]) {
        const nx = next % sw;
        if (next < 0 || next >= mask.length || Math.abs(nx - x) > 1 || !mask[next] || seen[next]) continue;
        seen[next] = 1;
        stack.push(next);
      }
    }
    if (!best || area > best.area) best = { area, x0, y0, x1, y1 };
  }
  if (!best) return null;
  const pad = Math.round(Math.max(width, height) * 0.02);
  const box = { x0: Math.max(0, best.x0 * b - pad), y0: Math.max(0, best.y0 * b - pad), x1: Math.min(width, (best.x1 + 1) * b + pad), y1: Math.min(height, (best.y1 + 1) * b + pad) };
  const share = ((box.x1 - box.x0) * (box.y1 - box.y0)) / (width * height);
  return share < 0.15 || share > 0.88 ? null : box;
}

const probeOf = (source: HTMLCanvasElement, longSide: number) => {
  const k = Math.min(1, longSide / Math.max(source.width, source.height));
  const probe = document.createElement('canvas');
  probe.width = Math.max(1, Math.round(source.width * k));
  probe.height = Math.max(1, Math.round(source.height * k));
  const pctx = probe.getContext('2d', { willReadFrequently: true });
  if (!pctx) return null;
  pctx.drawImage(source, 0, 0, probe.width, probe.height);
  return { k, width: probe.width, height: probe.height, data: pctx.getImageData(0, 0, probe.width, probe.height).data };
};

/** Cuts away the table, hand or wall around the paper; returns the same canvas when the paper fills the picture. */
function cropToPaper(source: HTMLCanvasElement): HTMLCanvasElement {
  const probe = probeOf(source, 480);
  if (!probe) return source;
  const box = paperBox(toGrey(probe.data), probe.width, probe.height);
  if (!box) return source;
  const x0 = Math.floor(box.x0 / probe.k);
  const y0 = Math.floor(box.y0 / probe.k);
  const w = Math.min(source.width - x0, Math.ceil((box.x1 - box.x0) / probe.k));
  const h = Math.min(source.height - y0, Math.ceil((box.y1 - box.y0) / probe.k));
  const out = document.createElement('canvas');
  out.width = Math.max(1, w);
  out.height = Math.max(1, h);
  const ctx = out.getContext('2d');
  if (!ctx) return source;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(source, x0, y0, w, h, 0, 0, w, h);
  return out;
}

/** Crops to the paper, straightens, evens out the light, stretches the contrast and sharpens; returns a new canvas (or the same one when nothing can be done). */
export function prepare(original: HTMLCanvasElement): HTMLCanvasElement {
  const source = cropToPaper(original);
  const probe = probeOf(source, 480);
  if (!probe) return source;
  const tilt = bestTilt(toGrey(probe.data), probe.width, probe.height);

  const out = document.createElement('canvas');
  out.width = source.width;
  out.height = source.height;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  if (!ctx) return source;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out.width, out.height);
  if (tilt !== 0) {
    ctx.translate(out.width / 2, out.height / 2);
    ctx.rotate((tilt * Math.PI) / 180);
    ctx.translate(-out.width / 2, -out.height / 2);
  }
  ctx.drawImage(source, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  const image = ctx.getImageData(0, 0, out.width, out.height);
  const even = flatten(toGrey(image.data), out.width, out.height);
  const { low, high } = levels(even);
  const crisp = sharpen(even.map((g) => stretch(g, low, high)), out.width, out.height);
  for (let i = 0; i < crisp.length; i += 1) {
    const v = crisp[i] as number;
    image.data[i * 4] = v;
    image.data[i * 4 + 1] = v;
    image.data[i * 4 + 2] = v;
  }
  ctx.putImageData(image, 0, 0);
  return out;
}
