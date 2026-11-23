// Loads the app's own receipt reader. If it can't load, the bot asks the person to type the expense.

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
