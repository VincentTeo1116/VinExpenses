// Loads the app's own deposit / loan maths (finance-calc.js, copied here by tools/sync-shared.js), so the reminder
// function works out due dates and amounts exactly the way the website does.
// It is a browser/Node "UMD" file, so depending on the runtime it appears as the module's default export (Node) or
// as the global FinanceCalc (Deno). If it cannot be loaded, the caller reports "not ready" and sends nothing.

export interface DueReminder {
  kind: "fd" | "loan";
  id: string;
  name: string;
  dueDate: string;
  daysLeft: number;
  group: "overdue" | "today" | "soon";
  milestone: number;
  amount: number;
  count?: number;
}
export interface FinanceCalcApi {
  dueReminders(
    deposits: Record<string, unknown>[],
    loans: Record<string, unknown>[],
    today: string,
    options?: { lateDays?: number; autoPaidLoanIds?: string[] },
  ): DueReminder[];
  relativeDay(daysLeft: number): string;
  /** The latest due date of a loan row before `date`, or "" when there is none. */
  lastDueBefore(loan: Record<string, unknown>, date: string): string;
}

let cached: FinanceCalcApi | null | undefined;

export async function loadFinanceCalc(): Promise<FinanceCalcApi | null> {
  if (cached !== undefined) return cached;
  try {
    // deno-lint-ignore no-explicit-any
    // @ts-ignore the file is plain JavaScript without type declarations
    const mod: any = await import("./finance-calc.js");
    // deno-lint-ignore no-explicit-any
    const global: any = globalThis;
    const api = [mod?.default, mod, global.FinanceCalc].find((candidate) => typeof candidate?.dueReminders === "function");
    cached = (api as FinanceCalcApi | undefined) ?? null;
  } catch (_error) {
    cached = null;
  }
  return cached;
}
