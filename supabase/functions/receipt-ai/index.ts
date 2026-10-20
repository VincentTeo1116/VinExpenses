// Optional AI helper for receipts the normal reader is unsure about.
//
// It is OFF until you add a key, and the app only calls it when the user switches "Let AI help" on.
// Only the receipt TEXT is sent (never the photo), and nothing is stored here.
//
// Setup (Supabase -> Edge Functions -> Secrets):
//   GEMINI_API_KEY    key from https://aistudio.google.com/apikey   (required to enable this function)
//   GEMINI_MODEL      default "gemini-2.5-flash-lite" (cheap and fast; change if Google renames it)
//   AI_DAILY_LIMIT    calls per user per day, default 10
//
// Privacy note: on Google's free tier, prompts may be used to improve Google's products. Enable billing on the
// Google project if receipts should not be used that way.
import { consumeQuota, dailyLimit, json, preflight, requireUser } from "../_shared/guard.ts";
import {
  buildPrompt,
  cleanCategories,
  parseJsonLoosely,
  SYSTEM_INSTRUCTION,
  validateAiResult,
} from "../_shared/ai-validate.ts";

const MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-2.5-flash-lite";

Deno.serve(async (request: Request) => {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== "POST") return json(request, { error: "Use POST." }, 405);

  // Checked first, so an unconfigured server never spends a user's allowance
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) return json(request, { error: "not_configured" }, 503);

  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  let payload: { text?: unknown; categories?: unknown; today?: unknown };
  try {
    payload = await request.json();
  } catch (_error) {
    return json(request, { error: "Invalid request." }, 400);
  }
  const text = typeof payload.text === "string" ? payload.text.slice(0, 12000) : "";
  if (text.replace(/\s/g, "").length < 20) return json(request, { error: "There is not enough receipt text to read." }, 400);
  const today = typeof payload.today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(payload.today)
    ? payload.today
    : new Date().toISOString().slice(0, 10);
  const categories = cleanCategories(payload.categories);

  const limited = await consumeQuota(request, auth.userId, "ai", dailyLimit("AI_DAILY_LIMIT", 10), "AI help");
  if (limited) return limited;

  const keys = categories.map((c) => c.key);
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        contents: [{ role: "user", parts: [{ text: buildPrompt(text, categories, today) }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 300,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              merchant: { type: "STRING", nullable: true },
              total: { type: "NUMBER", nullable: true },
              currency: { type: "STRING", nullable: true },
              date: { type: "STRING", nullable: true },
              category: keys.length
                ? { type: "STRING", enum: keys, nullable: true }
                : { type: "STRING", nullable: true },
            },
          },
        },
      }),
    });
    if (!response.ok) {
      console.error("Gemini request failed with status", response.status);
      return json(request, { error: "The AI service is unavailable right now." }, 502);
    }
    const result = await response.json();
    const answer = result?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof answer !== "string") return json(request, { error: "The AI service gave no answer." }, 502);

    // Never trust the AI's output: every field is validated (see _shared/ai-validate.ts)
    const checked = validateAiResult(parseJsonLoosely(answer), categories, today);
    return json(request, { ...checked, source: "ai" });
  } catch (_error) {
    return json(request, { error: "The AI service is unavailable right now." }, 502);
  }
});
