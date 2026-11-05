// Loads the app's own receipt reader (receipt-parser.js, copied here by tools/sync-shared.js), the same code the
// website uses to turn OCR text into merchant / total / date. If it cannot be loaded, the bot says so and asks the
// person to type the expense instead.

export interface ParsedReceipt {
  merchant: string;
  amount: number;
  bestGuess: number;
  amountConfidence: "high" | "medium" | "low" | "none";
  currency?: string;
  date: string; // YYYY-MM-DD or ""
  hints: { category?: string };
  warnings: string[];
}
export interface ReceiptParserApi {
  parseBest(texts: string[], options?: { now?: Date }): ParsedReceipt;
}

let cached: ReceiptParserApi | null | undefined;

export async function loadReceiptParser(): Promise<ReceiptParserApi | null> {
  if (cached !== undefined) return cached;
  try {
    // @ts-ignore the file is plain JavaScript without type declarations
    // deno-lint-ignore no-explicit-any
    const mod: any = await import("./receipt-parser.js");
    // deno-lint-ignore no-explicit-any
    const global: any = globalThis;
    const api = [mod?.default, mod, global.ReceiptParser].find((candidate) => typeof candidate?.parseBest === "function");
    cached = (api as ReceiptParserApi | undefined) ?? null;
  } catch (_error) {
    cached = null;
  }
  return cached;
}
