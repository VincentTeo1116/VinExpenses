// Minimal helpers for talking to the project's database with the service key. Edge functions only.
// The service key bypasses row-level security, so each function filters by user id itself.

import { projectAccess } from "./guard.ts";

export async function rest(path: string, init: RequestInit = {}): Promise<Response> {
  const access = projectAccess();
  if (!access) throw new Error("Server is not configured.");
  return fetch(`${access.url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: access.serviceKey,
      Authorization: `Bearer ${access.serviceKey}`,
      "Content-Type": "application/json",
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

/** Percent-encodes a value for use inside a PostgREST filter (`column=eq.<value>`). */
export function q(value: string): string {
  return encodeURIComponent(value);
}

/** Reads every row of a query, a page at a time (the database returns at most 1,000 rows per request). */
export async function fetchAll<T>(path: string, pageSize = 1000, maxPages = 100): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; page < maxPages; page++) {
    const response = await rest(`${path}&limit=${pageSize}&offset=${page * pageSize}`);
    if (!response.ok) throw new Error(`Query failed with status ${response.status}`);
    const batch = (await response.json()) as T[];
    rows.push(...batch);
    if (batch.length < pageSize) return rows;
  }
  throw new Error("Too many rows to summarise.");
}
