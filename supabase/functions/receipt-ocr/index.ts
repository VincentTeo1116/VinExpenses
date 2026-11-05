import { consumeQuota, dailyLimit, json, preflight, requireUser } from "../_shared/guard.ts";
import { MAX_IMAGE_BYTES, runOcr } from "../_shared/ocr.ts";

Deno.serve(async (request: Request) => {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== "POST") return json(request, { error: "Use POST to scan a receipt." }, 405);

  const apiKey = Deno.env.get("OCR_SPACE_API_KEY");
  if (!apiKey) return json(request, { error: "Receipt scanning is not configured yet." }, 503);

  // Only signed-in users, and a daily allowance each, so the shared OCR quota can't be drained by anyone else
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;
  const limited = await consumeQuota(request, auth.userId, "ocr", dailyLimit("SCAN_DAILY_LIMIT", 30), "scan");
  if (limited) return limited;

  try {
    const payload = await request.json();
    const dataUrl = typeof payload.imageData === "string" ? payload.imageData : "";
    const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/i);
    if (!match) return json(request, { error: "Choose a JPG, PNG, WebP or PDF receipt." }, 400);

    const encoded = match[2];
    if (encoded.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 8) {
      return json(request, { error: "Receipt image must be 1 MB or smaller." }, 413);
    }
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));

    const result = await runOcr(apiKey, bytes);
    if (result.ok) {
      // Do not log or persist receipt images or OCR text.
      return json(request, { text: result.text });
    }
    if (result.reason === "too_large") return json(request, { error: "Receipt image must be 1 MB or smaller." }, 413);
    if (result.reason === "bad_type") return json(request, { error: "Choose a JPG, PNG, WebP or PDF receipt." }, 400);
    if (result.reason === "unreadable") {
      return json(request, { error: "I couldn’t read this receipt clearly. Try a sharper, well-lit photo or enter it manually." }, 422);
    }
    return json(request, { error: "OCR.space could not process this receipt. Try again or enter it manually." }, 502);
  } catch (_error) {
    return json(request, { error: "Receipt scanning failed. Please try again or enter it manually." }, 500);
  }
});
