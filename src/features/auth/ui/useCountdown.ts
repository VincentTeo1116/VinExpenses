import { useSyncExternalStore } from 'react';

// One shared one-second clock for every countdown on the screen. The time is read when the clock ticks (not while rendering),
// so a countdown is always at most a second behind and no component has to set state from an effect.
let now = Date.now();
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  now = Date.now();
  if (!timer) {
    timer = setInterval(() => {
      now = Date.now();
      for (const notify of listeners) notify();
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

const snapshot = () => now;

/** Milliseconds left until `until` (a timestamp), refreshed every second. 0 when there is nothing to wait for. */
export function useCountdown(until: number | null): number {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);
  return until ? Math.max(0, until - current) : 0;
}
