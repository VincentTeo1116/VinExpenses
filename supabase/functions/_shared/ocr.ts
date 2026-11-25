// Reads receipt text with OCR.space. Images and text are never logged or stored.

export const OCR_ENDPOINT = "https://api.ocr.space/parse/image";
export const MAX_IMAGE_BYTES = 1_000_000; // OCR.space's free limit

export type OcrResult =
  | { ok: true; text: string; words?: OcrWord[] }
  | { ok: false; reason: "too_large" | "bad_type" | "service" | "unreadable" | "busy" };

/** One word and where it sits on the image sent (pixels), so the app can show what it read. */
export interface OcrWord { t: string; x: number; y: number; w: number; h: number }

export function mimeFromBytes(bytes: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (bytes.length > 12 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length > 12 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length > 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45) return "image/webp";
  return null; // the real file type decides, never the name or what the sender claims
}

type RawLine = { Words?: { WordText?: string; Left?: number; Top?: number; Width?: number; Height?: number }[] };
function wordsOf(pages: { TextOverlay?: { Lines?: RawLine[] } }[]): OcrWord[] {
  const out: OcrWord[] = [];
  for (const page of pages.slice(0, 1)) {
    for (const line of page?.TextOverlay?.Lines ?? []) {
      for (const word of line.Words ?? []) {
        const t = String(word.WordText ?? "").slice(0, 40);
        const [x, y, w, h] = [word.Left, word.Top, word.Width, word.Height].map((n) => Math.round(Number(n)));
        if (!t || ![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) continue;
        if (out.length < 800) out.push({ t, x, y, w, h });
      }
    }
  }
  return out;
}

export async function runOcr(apiKey: string, bytes: Uint8Array, fetchImpl: typeof fetch = fetch): Promise<OcrResult> {
  if (bytes.length > MAX_IMAGE_BYTES) return { ok: false, reason: "too_large" };
  const mimeType = mimeFromBytes(bytes);
  if (!mimeType) return { ok: false, reason: "bad_type" };
  const extension = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
  const form = new FormData();
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  form.append("file", new Blob([copy], { type: mimeType }), `receipt.${extension}`);
  form.append("language", "auto");
  form.append("OCREngine", "2");
  form.append("scale", "true");
  form.append("detectOrientation", "true");
  form.append("isOverlayRequired", "true");
  try {
    let response = await fetchImpl(OCR_ENDPOINT, { method: "POST", headers: { apikey: apiKey }, body: form, signal: AbortSignal.timeout(25_000) });
    if (response.status === 429) {
      // Too many requests: wait a moment and try once more before telling the person the service is busy
      await new Promise((resolve) => setTimeout(resolve, 1500));
      response = await fetchImpl(OCR_ENDPOINT, { method: "POST", headers: { apikey: apiKey }, body: form, signal: AbortSignal.timeout(25_000) });
      if (response.status === 429) return { ok: false, reason: "busy" };
    }
    if (!response.ok) return { ok: false, reason: "service" };
    const result = await response.json();
    const pages = Array.isArray(result.ParsedResults) ? result.ParsedResults : [];
    const text = pages.map((page: { ParsedText?: string }) => page.ParsedText || "").join("\n").trim();
    if (result.IsErroredOnProcessing || !text) return { ok: false, reason: "unreadable" };
    const words = wordsOf(pages);
    return words.length ? { ok: true, text: text.slice(0, 30000), words } : { ok: true, text: text.slice(0, 30000) };
  } catch (_error) {
    return { ok: false, reason: "service" };
  }
}
