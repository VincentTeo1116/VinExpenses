// CP-04: the inbox kept on this phone, one list per signed-in person, shared by every screen that shows it.
import { useSyncExternalStore } from 'react';
import { pullNative } from './bridge';
import type { Candidate } from './engine';
import { addCandidate, dropOld, parseStored, removeCandidate } from './inbox';

const key = (userId: string) => `ve_capture_${userId}`;
let owner = '';
let items: Candidate[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

function save() {
  try {
    localStorage.setItem(key(owner), JSON.stringify(items));
  } catch {
    // storage full or blocked: the list still works until the page closes
  }
}

export function openInbox(userId: string): void {
  if (owner === userId) return;
  owner = userId;
  try {
    items = dropOld(parseStored(localStorage.getItem(key(userId))), Date.now());
  } catch {
    items = [];
  }
  emit();
}

export async function refreshInbox(): Promise<void> {
  if (!owner) return;
  const fresh = await pullNative();
  let next = items;
  for (const candidate of fresh) next = addCandidate(next, candidate);
  if (next === items) return;
  items = next;
  save();
  emit();
}

export function dismissCandidate(id: string): void {
  items = removeCandidate(items, id);
  save();
  emit();
}

export function useInbox(): Candidate[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => items,
  );
}
