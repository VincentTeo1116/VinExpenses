// MON-01: counts and timings of receipt scans, so the administrator can see how reliable scanning is. Only the engine, whether it worked,
// the kind of failure and how long it took are kept: never a receipt image, its text, an amount or who scanned it.
import { rest } from "./db.ts";

export interface ScanEvent {
  at?: string;
  engine: string;
  ok: boolean;
  reason?: string | null;
  ms?: number | null;
}

/** Fire and forget: a failure to record can never break a scan (and a missing table is simply ignored). */
export async function recordScan(event: ScanEvent): Promise<void> {
  try {
    const response = await rest("scan_events", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ engine: String(event.engine).slice(0, 20), ok: Boolean(event.ok), reason: event.reason ? String(event.reason).slice(0, 30) : null, ms: Number.isFinite(event.ms) ? Math.round(Number(event.ms)) : null }),
    });
    if (!response.ok) await response.body?.cancel();
  } catch (_error) {
    /* monitoring must never stop a scan */
  }
}

export interface ScanSummary {
  total: number;
  worked: number;
  successPercent: number;
  medianMs: number | null;
  p90Ms: number | null;
  failures: { reason: string; count: number }[];
  byEngine: { engine: string; total: number; ok: number }[];
}

const percentile = (sorted: number[], p: number): number | null => (sorted.length ? (sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] as number) : null);

export function summariseScans(rows: ScanEvent[]): ScanSummary {
  const total = rows.length;
  const okRows = rows.filter((r) => r.ok);
  const times = okRows.map((r) => Number(r.ms)).filter((n) => Number.isFinite(n) && n >= 0).sort((a, b) => a - b);
  const reasons = new Map<string, number>();
  for (const r of rows) if (!r.ok) reasons.set(r.reason || "unknown", (reasons.get(r.reason || "unknown") ?? 0) + 1);
  const engines = new Map<string, { total: number; ok: number }>();
  for (const r of rows) {
    const e = engines.get(r.engine) ?? { total: 0, ok: 0 };
    e.total += 1;
    if (r.ok) e.ok += 1;
    engines.set(r.engine, e);
  }
  return {
    total,
    worked: okRows.length,
    successPercent: total ? Math.round((okRows.length / total) * 100) : 0,
    medianMs: percentile(times, 0.5),
    p90Ms: percentile(times, 0.9),
    failures: [...reasons.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    byEngine: [...engines.entries()].map(([engine, v]) => ({ engine, ...v })),
  };
}
