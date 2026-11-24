// PF-03: which dialogs are open, in the order they were opened. The last one is on top and the only one that can be used,
// so a newly opened sheet is never hidden behind an older one.
// The page behind is made inert and scroll-locked HERE, at the moment the stack changes (not in a later React effect),
// so focus can safely return to the button that opened a dialog as soon as it closes.
import { useSyncExternalStore } from 'react';

let stack: readonly string[] = [];
const listeners = new Set<() => void>();

function lockPage() {
  if (typeof document === 'undefined') return;
  const open = stack.length > 0;
  document.getElementById('root')?.toggleAttribute('inert', open);
  document.body.classList.toggle('scroll-locked', open);
}

function emit() {
  lockPage();
  for (const listener of listeners) listener();
}

export function pushSheet(id: string) {
  if (stack.includes(id)) return;
  stack = [...stack, id];
  emit();
}

export function popSheet(id: string) {
  if (!stack.includes(id)) return;
  stack = stack.filter((entry) => entry !== id);
  emit();
}

export function resetSheets() {
  stack = [];
  emit();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useSheetStack(): readonly string[] {
  return useSyncExternalStore(
    subscribe,
    () => stack,
    () => stack,
  );
}
