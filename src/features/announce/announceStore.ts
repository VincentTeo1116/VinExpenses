// AN-02: a tiny shared switch: true while the announcement is being fetched or is on screen, so the guided tour waits its turn and starts after it.
import { useSyncExternalStore } from 'react';

let busy = false;
const listeners = new Set<() => void>();

export function setAnnouncementBusy(next: boolean): void {
  if (busy === next) return;
  busy = next;
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useAnnouncementBusy = (): boolean =>
  useSyncExternalStore(
    subscribe,
    () => busy,
    () => false,
  );
