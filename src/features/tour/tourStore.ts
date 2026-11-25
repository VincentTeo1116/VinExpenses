// ON-01: whether the guided tour is showing. A tiny shared switch so Account can replay it and the app frame can show it.
import { useSyncExternalStore } from 'react';

export const TOUR_SEEN_KEY = 'et_tour_seen';

let active = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export function startTour() {
  if (active) return;
  active = true;
  emit();
}
export function stopTour() {
  if (!active) return;
  active = false;
  emit();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const useTourActive = (): boolean =>
  useSyncExternalStore(
    subscribe,
    () => active,
    () => false,
  );

export function seenOnThisDevice(): boolean {
  try {
    return localStorage.getItem(TOUR_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}
export function rememberOnThisDevice() {
  try {
    localStorage.setItem(TOUR_SEEN_KEY, '1');
  } catch {
    /* the account copy is enough */
  }
}

/** Only accounts made in the last two weeks are welcomed with the tour; older ones can replay it from Account. */
export function isNewAccount(createdAt: string | undefined, now = Date.now()): boolean {
  const made = createdAt ? Date.parse(createdAt) : NaN;
  return Number.isFinite(made) && now - made < 14 * 24 * 3600 * 1000;
}
