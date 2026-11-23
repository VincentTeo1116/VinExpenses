// Loads the app's own category guesser. If it can't load, the category falls back to "other".

export interface CategoryChoice {
  key: string;
  label: string;
  active?: boolean;
}
export interface SmartEntryApi {
  buildMerchantMemory(expenses: { merchant?: string | null; category?: string | null }[]): unknown;
  suggestCategory(input: { merchant?: string; text?: string; memory?: unknown; categories?: CategoryChoice[] }): { key: string; label: string; reason: string } | null;
}

let cached: SmartEntryApi | null | undefined;

export async function loadSmartEntry(): Promise<SmartEntryApi | null> {
  if (cached !== undefined) return cached;
  try {
    // deno-lint-ignore no-explicit-any
    // @ts-ignore the file is plain JavaScript without type declarations
    const mod: any = await import("./smart-entry.js");
    // deno-lint-ignore no-explicit-any
    const global: any = globalThis;
    const api = [mod?.default, mod, global.SmartEntry].find((candidate) => typeof candidate?.suggestCategory === "function");
    cached = (api as SmartEntryApi | undefined) ?? null;
  } catch (_error) {
    cached = null;
  }
  return cached;
}
