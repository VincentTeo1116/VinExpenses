// RX-01: reading a receipt file. A PDF with text is read on the device (nothing leaves it); a photo or a scanned PDF goes to the
// signed-in OCR service, which keeps nothing. Every step has a time limit, so the button is never left spinning.
import type * as PdfJs from 'pdfjs-dist';
import { ApiError, callFunction } from '@/lib/api';
import type { OcrWord } from './highlight';
import { readOnDevice } from './localOcr';
import { prepare } from './photoPrep';
import { parseBest, pdfContentOrderToText, pdfItemsToText, type ParsedReceipt } from './receiptParser';

export type ScanProblem = 'pdfTooBig' | 'pdfPassword' | 'pdfBad' | 'pdfSlow' | 'pdfLoad' | 'ocrSlow' | 'noText' | 'offlinePhoto' | 'badType' | 'imageOpen' | 'noCompress' | 'tooLarge' | 'prepSlow' | 'service';

export class ScanError extends Error {
  readonly problem: ScanProblem;
  /** Words from the server (daily limit reached, service not set up) shown as they are. */
  readonly serverText: string;
  /** The online reader could not help for a passing reason (busy, down, over its allowance, no connection): the backup reader may try. */
  readonly transient: boolean;
  constructor(problem: ScanProblem, serverText = '', transient = false) {
    super(problem);
    this.name = 'ScanError';
    this.problem = problem;
    this.serverText = serverText;
    this.transient = transient;
  }
}

const PDF_MAX_BYTES = 10 * 1024 * 1024;
const IMAGE_MAX_BYTES = 900_000;

export const isPdf = (file: File): boolean => file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');

function withTimeout<T>(promise: Promise<T>, ms: number, problem: ScanProblem): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ScanError(problem, '', problem === 'ocrSlow')), ms);
  });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new ScanError('imageOpen'));
    reader.readAsDataURL(blob);
  });
}

function whiteCanvas(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new ScanError('noCompress');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return { canvas, ctx };
}

/** Keep a canvas as a JPEG under the size limit, shrinking until it fits. */
async function canvasToJpeg(canvas: HTMLCanvasElement): Promise<string> {
  let current = canvas;
  for (let attempt = 0; attempt < 8; attempt++) {
    const quality = [0.86, 0.76, 0.66, 0.56][Math.min(attempt, 3)] as number;
    const blob = await new Promise<Blob | null>((resolve) => current.toBlob(resolve, 'image/jpeg', quality));
    if (blob && blob.size <= IMAGE_MAX_BYTES) return readAsDataUrl(blob);
    const { canvas: smaller, ctx } = whiteCanvas(current.width * 0.82, current.height * 0.82);
    ctx.drawImage(current, 0, 0, smaller.width, smaller.height);
    current = smaller;
  }
  throw new ScanError('tooLarge');
}

/** Trim empty white margins so the receipt text is bigger and clearer for OCR. */
function trimMargins(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const w = canvas.width;
  const h = canvas.height;
  const k = Math.min(1, 500 / Math.max(w, h));
  const pw = Math.max(1, Math.round(w * k));
  const ph = Math.max(1, Math.round(h * k));
  const probe = document.createElement('canvas');
  probe.width = pw;
  probe.height = ph;
  const pctx = probe.getContext('2d', { willReadFrequently: true });
  if (!pctx) return canvas;
  pctx.drawImage(canvas, 0, 0, pw, ph);
  const px = pctx.getImageData(0, 0, pw, ph).data;
  const rowInk = new Array<number>(ph).fill(0);
  const colInk = new Array<number>(pw).fill(0);
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      const i = (y * pw + x) * 4;
      if ((px[i + 3] as number) > 0 && (px[i] as number) * 0.299 + (px[i + 1] as number) * 0.587 + (px[i + 2] as number) * 0.114 < 225) {
        rowInk[y] = (rowInk[y] as number) + 1;
        colInk[x] = (colInk[x] as number) + 1;
      }
    }
  }
  const rowMin = Math.max(1, pw * 0.008);
  const colMin = Math.max(1, ph * 0.008);
  const top = rowInk.findIndex((n) => n >= rowMin);
  const left = colInk.findIndex((n) => n >= colMin);
  let bottom = -1;
  let right = -1;
  for (let y = ph - 1; y >= 0; y--) if ((rowInk[y] as number) >= rowMin) { bottom = y; break; }
  for (let x = pw - 1; x >= 0; x--) if ((colInk[x] as number) >= colMin) { right = x; break; }
  if (top < 0 || left < 0 || bottom < 0 || right < 0) return canvas;
  const pad = Math.round(Math.max(pw, ph) * 0.02);
  const x0 = Math.max(0, Math.floor((left - pad) / k));
  const y0 = Math.max(0, Math.floor((top - pad) / k));
  const x1 = Math.min(w, Math.ceil((right + pad) / k));
  const y1 = Math.min(h, Math.ceil((bottom + pad) / k));
  const cw = x1 - x0;
  const ch = y1 - y0;
  if (cw * ch > 0.85 * w * h || cw < w * 0.15 || ch < h * 0.15) return canvas; // nothing worth cropping
  const { canvas: out, ctx } = whiteCanvas(cw, ch);
  ctx.drawImage(canvas, x0, y0, cw, ch, 0, 0, cw, ch);
  return out;
}

async function compressImage(file: File): Promise<string> {
  if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) throw new ScanError('badType');
  if (file.size <= IMAGE_MAX_BYTES) return readAsDataUrl(file);
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new ScanError('imageOpen'));
      img.src = objectUrl;
    });
    const scale = Math.min(1, 2000 / image.width, 2000 / image.height);
    const { canvas, ctx } = whiteCanvas(image.width * scale, image.height * scale);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await canvasToJpeg(canvas);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** A photo straightened and sharpened for reading: for receipts with many small lines (the split page). */
async function prepareImage(file: File): Promise<string> {
  if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) throw new ScanError('badType');
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new ScanError('imageOpen'));
      img.src = objectUrl;
    });
    const scale = Math.min(1, 1600 / Math.max(image.width, image.height)); // the lab found 1200 to 1600 px reads as well as larger and is faster
    const { canvas, ctx } = whiteCanvas(image.width * scale, image.height * scale);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await canvasToJpeg(trimMargins(prepare(canvas)));
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

type PdfLib = typeof PdfJs;
let pdfJs: Promise<PdfLib> | null = null;
/** pdf.js is only downloaded when someone picks a PDF. It comes from this site, never from elsewhere. */
function loadPdfJs(): Promise<PdfLib> {
  if (!pdfJs) {
    pdfJs = Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')])
      .then(([lib, worker]) => {
        lib.GlobalWorkerOptions.workerSrc = worker.default;
        return lib;
      })
      .catch(() => {
        pdfJs = null;
        throw new ScanError('pdfLoad');
      });
  }
  return pdfJs;
}

async function readPdf(file: File): Promise<{ texts: string[] } | { imageData: string }> {
  if (file.size > PDF_MAX_BYTES) throw new ScanError('pdfTooBig');
  const pdfjs = await loadPdfJs();
  let task: ReturnType<PdfLib['getDocument']>;
  let pdf;
  try {
    // Safer settings for files from strangers: no form scripts, capped image size (this version never uses eval).
    task = pdfjs.getDocument({ data: await file.arrayBuffer(), enableXfa: false, maxImageSize: 32 * 1024 * 1024 });
    pdf = await task.promise;
  } catch (error) {
    if (error && (error as { name?: string }).name === 'PasswordException') throw new ScanError('pdfPassword');
    throw new ScanError('pdfBad');
  }
  try {
    const pages = Math.min(pdf.numPages, 4);
    const contentOrder: string[] = [];
    const visualRows: string[] = [];
    for (let n = 1; n <= pages; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      const items = content.items.flatMap((item) => ('str' in item ? [{ str: item.str, x: item.transform[4] as number, y: item.transform[5] as number, width: item.width, height: item.height || Math.abs(item.transform[3] as number), hasEOL: Boolean(item.hasEOL) }] : []));
      // Read the page two ways and let the parser keep the one it trusts more.
      contentOrder.push(pdfContentOrderToText(items));
      visualRows.push(pdfItemsToText(items));
    }
    const texts = [contentOrder.join('\n'), visualRows.join('\n')];
    if (texts.some((text) => text.replace(/\s/g, '').length >= 30)) return { texts };

    // No text layer: it is a scan. Render page 1, crop the empty margins, and send it to OCR.
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(3, 2600 / Math.max(base.width, base.height)) });
    const { canvas, ctx } = whiteCanvas(viewport.width, viewport.height);
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    return { imageData: await canvasToJpeg(trimMargins(canvas)) };
  } finally {
    try {
      await task.destroy();
    } catch {
      /* already closed */
    }
  }
}

export interface OcrContext {
  baseUrl: string;
  anonKey: string;
  accessToken: string | undefined;
}

async function ocr(imageData: string, context: OcrContext): Promise<{ text: string; words: OcrWord[] }> {
  if (!navigator.onLine) throw new ScanError('offlinePhoto', '', true);
  try {
    const reply = await callFunction<{ text?: string; words?: OcrWord[]; error?: string }>('receipt-ocr', { imageData }, { ...context, timeoutMs: 45_000 });
    if (reply.error) throw new ScanError('service', reply.error);
    return { text: reply.text ?? '', words: Array.isArray(reply.words) ? reply.words : [] };
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.code === 'offline') throw new ScanError('offlinePhoto', '', true);
      if (error.code === 'timeout') throw new ScanError('ocrSlow', '', true);
      throw new ScanError('service', error.message, error.code === 'server' || error.code === 'rate_limited' || error.code === 'not_configured');
    }
    throw error;
  }
}

export interface Scanned extends ParsedReceipt {
  text: string;
  /** Where each word sits on the image that was read (photos and scans only). */
  words: OcrWord[];
  source: 'pdf-text' | 'ocr' | 'ocr-device';
  /** Where the time went, in milliseconds: getting the file ready, the OCR call, and everything together. Stays on the device. */
  timings: { prepMs: number; ocrMs: number; totalMs: number };
}

/** Reads a receipt file and works out merchant, amount and date. Throws a ScanError with what went wrong. */
export async function scanReceipt(file: File, context: OcrContext, onStep?: (step: 'pdf' | 'scan' | 'image' | 'text' | 'local') => void, onPreview?: (image: string) => void, options: { prepare?: boolean } = {}): Promise<Scanned> {
  let texts: string[] = [];
  let source: Scanned['source'] = 'ocr';
  const started = performance.now();
  let ocrMs = 0;
  let prepMs = 0;
  let words: OcrWord[] = [];
  let readOnThisDevice = false;
  const timedOcr = async (imageData: string): Promise<string> => {
    prepMs = performance.now() - started;
    onPreview?.(imageData); // the photo stays on screen even if reading it fails, so the person can copy from it
    const t = performance.now();
    try {
      try {
        const reply = await withTimeout(ocr(imageData, context), 45_000, 'ocrSlow');
        words = reply.words;
        return reply.text;
      } catch (error) {
        // The online reader could not help (busy, down, over its daily allowance, or no connection): read the photo on this device instead.
        // A photo it simply could not make out ('noText') is not retried: the backup is not better at that.
        if (!(error instanceof ScanError) || !error.transient) throw error;
        onStep?.('local');
        try {
          const local = await withTimeout(readOnDevice(imageData, 90_000), 100_000, 'ocrSlow');
          // nothing readable on the device either: say why the online reader was not used (busy, limit, offline) rather than a vague "no text"
          if (!local.text.trim()) throw error;
          words = local.words;
          readOnThisDevice = true;
          return local.text;
        } catch {
          throw error; // the backup failed too: say what went wrong with the online one
        }
      }
    } finally {
      ocrMs = performance.now() - t;
    }
  };
  if (isPdf(file)) {
    onStep?.('pdf');
    const pdf = await withTimeout(readPdf(file), 40_000, 'pdfSlow');
    if ('texts' in pdf) {
      texts = pdf.texts;
      source = 'pdf-text';
    } else {
      onStep?.('scan');
      texts = [await timedOcr(pdf.imageData)];
    }
  } else {
    onStep?.('image');
    const imageData = await withTimeout(options.prepare ? prepareImage(file) : compressImage(file), 30_000, 'prepSlow');
    onStep?.('text');
    texts = [await timedOcr(imageData)];
  }
  if (!texts.join('').trim()) throw new ScanError('noText');
  const best = parseBest(texts);
  const totalMs = performance.now() - started;
  if (!prepMs) prepMs = totalMs;
  const timings = { prepMs: Math.round(prepMs), ocrMs: Math.round(ocrMs), totalMs: Math.round(totalMs) };
  if (import.meta.env.DEV) console.debug('[scan] timings (ms)', timings);
  return { ...best, source: readOnThisDevice ? 'ocr-device' : source, timings, words };
}
