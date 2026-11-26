// CP-02: the review inbox: detected payments wait here until confirmed or dismissed, nothing is saved on its own.
import type { Candidate } from './engine';

export const MAX_ITEMS = 200;
export const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;
export const KEEP_MS = 30 * 24 * 60 * 60 * 1000;

const sameAmount = (a: Candidate, b: Candidate) => Math.round(a.amount * 100) === Math.round(b.amount * 100);

export function isDuplicate(item: Candidate, list: Candidate[]): boolean {
  return list.some((other) => other.id === item.id || (sameAmount(item, other) && Math.abs(item.postedAt - other.postedAt) <= DUPLICATE_WINDOW_MS));
}

export function addCandidate(list: Candidate[], item: Candidate): Candidate[] {
  if (isDuplicate(item, list)) return list;
  return [...list, item].sort((a, b) => b.postedAt - a.postedAt).slice(0, MAX_ITEMS);
}

export const removeCandidate = (list: Candidate[], id: string): Candidate[] => list.filter((item) => item.id !== id);

export const dropOld = (list: Candidate[], now: number): Candidate[] => list.filter((item) => now - item.postedAt <= KEEP_MS);

// stored data can be edited or damaged, so anything that is not a valid candidate is ignored
export function parseStored(value: unknown): Candidate[] {
  if (typeof value !== 'string') return [];
  try {
    const data: unknown = JSON.parse(value);
    if (!Array.isArray(data)) return [];
    return data.filter(
      (row): row is Candidate =>
        typeof row === 'object' &&
        row !== null &&
        typeof (row as Candidate).id === 'string' &&
        typeof (row as Candidate).amount === 'number' &&
        Number.isFinite((row as Candidate).amount) &&
        (row as Candidate).amount > 0 &&
        typeof (row as Candidate).postedAt === 'number' &&
        typeof (row as Candidate).merchant === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(String((row as Candidate).date)),
    );
  } catch {
    return [];
  }
}
