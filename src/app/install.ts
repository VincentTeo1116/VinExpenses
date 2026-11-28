// Install support. Chrome and Edge announce "this site can be installed" once, early, with a `beforeinstallprompt` event.
// This file listens from the first moment (it is imported by main.tsx) and keeps the event, so the Install page can use it
// later no matter how quickly the person got there. Nothing is sent anywhere; it only remembers the browser's own offer.
import { useSyncExternalStore } from 'react';

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let offer: InstallEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const tell = () => listeners.forEach((l) => l());

export function listenForInstall(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault(); // keep the offer for our own button instead of the browser's mini bar
    offer = event as InstallEvent;
    tell();
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    offer = null;
    tell();
  });
}

/** True when the page is already running as an installed app (home-screen icon), not in a browser tab. */
export function runsAsApp(): boolean {
  try {
    return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}

export type Platform = 'android' | 'iphone' | 'computer';

/** A best guess at the device, only used to open the right tab first. The person can always switch. */
export function guessPlatform(ua = navigator.userAgent, touchPoints = navigator.maxTouchPoints): Platform {
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && touchPoints > 1)) return 'iphone';
  if (/Android/i.test(ua)) return 'android';
  return 'computer';
}

/** Asks the browser to show its install dialog. Returns whether the person said yes. */
export async function askToInstall(): Promise<boolean> {
  if (!offer) return false;
  const current = offer;
  offer = null; // the browser allows each offer to be used once
  tell();
  try {
    await current.prompt();
    const choice = await current.userChoice;
    return choice.outcome === 'accepted';
  } catch {
    return false;
  }
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Can the one-tap install button work right now? */
export function useCanInstall(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => offer !== null,
    () => false,
  );
}

export function useInstalled(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => installed || runsAsApp(),
    () => false,
  );
}
