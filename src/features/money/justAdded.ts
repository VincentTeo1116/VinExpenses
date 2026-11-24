// Which record was saved a moment ago, so its row can flash once where it lands (History and Home's recent list).
import { useSyncExternalStore } from 'react';

let current = '';
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const tell = () => listeners.forEach((listener) => listener());

export function markJustAdded(id: string): void {
  current = id;
  tell();
  clearTimeout(timer);
  timer = setTimeout(() => {
    current = '';
    tell();
  }, 1200);
}

export function useJustAdded(): string {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    () => '',
  );
}
