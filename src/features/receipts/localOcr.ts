// OCR-02: the backup reader. When the online reader is busy, down, out of its daily allowance or the phone is offline, the photo is read on
// the device with Tesseract (English). Its code and language file come from this site's own /ocr folder, are downloaded only now, and the
// photo never leaves the device. It is slower and a little less exact than the online reader, so the person is told.
import type { createWorker as CreateWorker } from 'tesseract.js';
import type { OcrWord } from './highlight';

interface TessWord {
  text?: string;
  bbox?: { x0: number; y0: number; x1: number; y1: number };
}
interface TessData {
  text?: string;
  words?: TessWord[];
  blocks?: { paragraphs?: { lines?: { words?: TessWord[] }[] }[] }[];
}

const wordsOf = (data: TessData): TessWord[] => {
  if (Array.isArray(data.words) && data.words.length) return data.words;
  const out: TessWord[] = [];
  for (const block of data.blocks ?? []) for (const paragraph of block.paragraphs ?? []) for (const line of paragraph.lines ?? []) out.push(...(line.words ?? []));
  return out;
};

export interface LocalRead {
  text: string;
  words: OcrWord[];
}

/** Reads a photo (a data URL) on this device. Rejects if the reader cannot start (files missing, no WebAssembly, out of memory). */
export async function readOnDevice(imageData: string, timeoutMs = 90_000): Promise<LocalRead> {
  return ((await readOnDeviceModes(imageData, [null], timeoutMs)) as [LocalRead])[0];
}

/** Reads the same photo once for each page-layout mode (null = Tesseract's default), all on this device; the sparse-text mode (11) helps long, narrow receipts. */
export async function readOnDeviceModes(imageData: string, modes: (number | null)[] = [6, 11, 4], timeoutMs = 150_000): Promise<LocalRead[]> {
  const { createWorker } = await import('tesseract.js');
  let stop: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      stop?.(); // the worker is shut down, not left running in the background
      reject(new Error('on-device reading timed out'));
    }, timeoutMs);
  });
  try {
    return await Promise.race([run(createWorker, imageData, (fn) => (stop = fn), modes), limit]);
  } finally {
    clearTimeout(timer);
  }
}

async function run(createWorker: typeof CreateWorker, imageData: string, register: (stop: () => void) => void, modes: (number | null)[]): Promise<LocalRead[]> {
  const starting = createWorker('eng', 1, {
    workerPath: '/ocr/worker.min.js',
    corePath: '/ocr',
    langPath: '/ocr',
    workerBlobURL: false, // the worker file is loaded from this site directly, so it runs under its own /ocr policy (see scripts/headers.mts)
    gzip: true,
    cacheMethod: 'write',
  });
  register(() => void starting.then((w) => w.terminate()).catch(() => undefined));
  const worker = await starting;
  try {
    const reads: LocalRead[] = [];
    for (const mode of modes) {
      if (mode != null) await worker.setParameters({ tessedit_pageseg_mode: String(mode) as never });
      const result = await worker.recognize(imageData, {}, { text: true, blocks: true });
      const data = result.data as unknown as TessData;
      const words: OcrWord[] = [];
      for (const word of wordsOf(data)) {
        const t = String(word.text ?? '').trim().slice(0, 40);
        const b = word.bbox;
        if (!t || !b) continue;
        const [x, y, w, h] = [b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0].map((n) => Math.round(n));
        if ([x, y, w, h].every(Number.isFinite) && (w as number) > 0 && (h as number) > 0 && words.length < 800) words.push({ t, x: x as number, y: y as number, w: w as number, h: h as number });
      }
      reads.push({ text: String(data.text ?? '').trim(), words });
    }
    return reads;
  } finally {
    await worker.terminate().catch(() => undefined);
  }
}
