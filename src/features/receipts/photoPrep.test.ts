// SP-08: straightening and contrast for receipt photos, checked on grey values made up in the test (no real photos).
import { describe, expect, it } from 'vitest';
import { bestTilt, levels, otsu, rotateGrey, stretch, toGrey, boxBlur, flatten, paperBox, sharpen } from './photoPrep';

/** A page of "text lines" (dark bars every 22 rows) tilted by `deg`: the line a point sits on follows y - x * tan(deg). */
function page(width: number, height: number, deg: number): Uint8Array {
  const grey = new Uint8Array(width * height).fill(235);
  const slope = Math.tan((deg * Math.PI) / 180);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const along = (((y - (x - width / 2) * slope) % 22) + 22) % 22;
      if (along < 7 && x % 9 < 6) grey[y * width + x] = 30; // gaps between "words"
    }
  }
  return grey;
}

describe('grey values and levels', () => {
  it('turns colour into grey with the usual weights', () => {
    expect([...toGrey([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255])]).toEqual([76, 150, 29, 255]);
  });
  it('finds the split between dark print and light paper', () => {
    const grey = new Uint8Array([...new Array(300).fill(40), ...new Array(700).fill(220)]);
    const t = otsu(grey);
    expect(t).toBeGreaterThanOrEqual(40);
    expect(t).toBeLessThan(220);
  });
  it('stretches faint print to full contrast, and leaves a flat image alone', () => {
    const faint = new Uint8Array([...new Array(100).fill(120), ...new Array(900).fill(200)]);
    const { low, high } = levels(faint);
    expect(low).toBe(120);
    expect(high).toBe(200);
    expect(stretch(120, low, high)).toBe(0);
    expect(stretch(200, low, high)).toBe(255);
    expect(levels(new Uint8Array(500).fill(180))).toEqual({ low: 0, high: 255 });
  });
});

describe('straightening', () => {
  it('a level page needs no turn', () => {
    expect(bestTilt(page(300, 220, 0), 300, 220)).toBe(0);
  });
  it('a tilted page gives the angle to turn it by, and turning it by that makes it level (both ways)', () => {
    for (const deg of [4, -3, 6]) {
      const grey = page(320, 240, deg);
      const turn = bestTilt(grey, 320, 240);
      expect(Math.abs(turn + deg), `tilt ${deg}`).toBeLessThanOrEqual(0.5);
      const level = bestTilt(rotateGrey(grey, 320, 240, turn), 320, 240);
      expect(Math.abs(level), `after turning ${deg}`).toBeLessThanOrEqual(1);
    }
  });
  it('a nearly empty picture is left as it is', () => {
    expect(bestTilt(new Uint8Array(100 * 100).fill(250), 100, 100)).toBe(0);
  });
});

/** A grey picture w x h where fn(x, y) gives each pixel. */
const picture = (w: number, h: number, fn: (x: number, y: number) => number) => {
  const g = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) g[y * w + x] = Math.max(0, Math.min(255, Math.round(fn(x, y))));
  return g;
};

describe('SP-08 shadows, sharpness and the paper edge', () => {
  it('blurring a flat picture changes nothing, and blurring a spike spreads it evenly', () => {
    const flat = boxBlur(Float32Array.from(new Array(100).fill(80)), 10, 10, 2);
    expect(Math.min(...flat)).toBeCloseTo(80, 3);
    expect(Math.max(...flat)).toBeCloseTo(80, 3);
    const spike = new Float32Array(121);
    spike[60] = 121; // the middle of an 11 x 11 picture
    expect(boxBlur(spike, 11, 11, 1)[60]).toBeCloseTo(121 / 9, 3);
  });

  it('flatten makes a page that fades from light to shadow evenly white and keeps the print dark', () => {
    const w = 800;
    const h = 800;
    const shade = (x: number) => 250 - (x / w) * 120; // 250 on the left down to 130 on the right
    const print = (x: number, y: number) => y % 40 < 3 && x > 80 && x < 720; // thin rows of print
    const page = picture(w, h, (x, y) => (print(x, y) ? shade(x) * 0.25 : shade(x)));
    const flat = flatten(page, w, h);
    const paperLeft = flat[20 * w + 20] as number;
    const paperRight = flat[20 * w + 780] as number;
    expect(paperLeft).toBeGreaterThan(235);
    expect(paperRight).toBeGreaterThan(235);
    expect(Math.abs(paperLeft - paperRight)).toBeLessThan(15);
    expect(flat[1 * w + 600] as number).toBeLessThan(110); // print stays dark even in the shadow
  });

  it('flatten leaves an already even white page white', () => {
    const flat = flatten(picture(120, 90, () => 245), 120, 90);
    expect(Math.min(...flat)).toBeGreaterThan(250);
  });

  it('sharpen keeps a flat area as it is and makes an edge steeper', () => {
    const w = 40;
    const h = 20;
    const edge = picture(w, h, (x) => (x < 20 ? 200 : 100));
    const sharp = sharpen(edge, w, h);
    expect(sharp[10 * w + 2]).toBe(200); // far from the edge: unchanged
    expect(sharp[10 * w + 19] as number).toBeGreaterThan(200); // the light side of the edge overshoots
    expect(sharp[10 * w + 20] as number).toBeLessThan(100); // the dark side undershoots
  });

  it('paperBox finds a bright sheet on a dark table and ignores print on it', () => {
    const w = 320;
    const h = 400;
    const page = picture(w, h, (x, y) => {
      const onSheet = x >= 90 && x < 250 && y >= 40 && y < 360;
      if (!onSheet) return 40;
      return y % 24 < 4 && x > 110 && x < 230 ? 60 : 235; // rows of print
    });
    const box = paperBox(page, w, h);
    expect(box).not.toBeNull();
    expect(box?.x0 as number).toBeGreaterThan(60);
    expect(box?.x0 as number).toBeLessThan(100);
    expect(box?.x1 as number).toBeGreaterThan(240);
    expect(box?.x1 as number).toBeLessThan(285);
    expect(box?.y0 as number).toBeLessThan(45);
    expect(box?.y1 as number).toBeGreaterThan(355);
  });

  it('paperBox returns nothing when the paper fills the picture or nothing stands out', () => {
    expect(paperBox(picture(200, 300, () => 240), 200, 300)).toBeNull();
    const nearlyAll = picture(200, 300, (x) => (x < 4 ? 30 : 235));
    expect(paperBox(nearlyAll, 200, 300)).toBeNull();
    expect(paperBox(picture(200, 300, () => 30), 200, 300)).toBeNull();
  });
});
