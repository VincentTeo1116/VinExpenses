const OCR_ENDPOINT = "https://api.ocr.space/parse/image";
const MAX_IMAGE_BYTES = 1_000_000;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Use POST to scan a receipt." }, 405);

  const apiKey = Deno.env.get("OCR_SPACE_API_KEY");
  if (!apiKey) return jsonResponse({ error: "Receipt scanning is not configured yet." }, 503);

  try {
    const payload = await request.json();
    const dataUrl = typeof payload.imageData === "string" ? payload.imageData : "";
    const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/i);
    if (!match) return jsonResponse({ error: "Choose a JPG, PNG, or WebP receipt image." }, 400);

    const mimeType = match[1].toLowerCase();
    const encoded = match[2];
    if (encoded.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 8) {
      return jsonResponse({ error: "Receipt image must be 1 MB or smaller." }, 413);
    }

    const binary = atob(encoded);
    if (binary.length > MAX_IMAGE_BYTES) {
      return jsonResponse({ error: "Receipt image must be 1 MB or smaller." }, 413);
    }
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const extension = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: mimeType }), `receipt.${extension}`);
    form.append("language", "auto");
    form.append("OCREngine", "2");
    form.append("scale", "true");
    form.append("detectOrientation", "true");
    form.append("isOverlayRequired", "false");

    const response = await fetch(OCR_ENDPOINT, {
      method: "POST",
      headers: { apikey: apiKey },
      body: form,
    });
    if (!response.ok) return jsonResponse({ error: "OCR.space could not process this receipt. Try again or enter it manually." }, 502);

    const result = await response.json();
    const parsed = Array.isArray(result.ParsedResults) ? result.ParsedResults : [];
    const text = parsed.map((page: { ParsedText?: string }) => page.ParsedText || "").join("\n").trim();
    if (result.IsErroredOnProcessing || !text) {
      return jsonResponse({ error: "I couldn’t read this receipt clearly. Try a sharper, well-lit photo or enter it manually." }, 422);
    }

    // Do not log or persist receipt images or OCR text.
    return jsonResponse({ text: text.slice(0, 30000) });
  } catch (_error) {
    return jsonResponse({ error: "Receipt scanning failed. Please try again or enter it manually." }, 500);
  }
});
