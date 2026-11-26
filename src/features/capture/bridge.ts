// CP-03: the link to the Android plugin; it is absent in a browser, so every call is safe to make anywhere.
import type { Candidate } from './engine';
import { parseStored } from './inbox';

interface NativePlugin {
  status(): Promise<{ enabled: boolean }>;
  pull(): Promise<{ items: unknown[] }>;
  openSettings(): Promise<void>;
}

const plugin = (): NativePlugin | null => (window as unknown as { Capacitor?: { Plugins?: { NotificationCapture?: NativePlugin } } }).Capacitor?.Plugins?.NotificationCapture ?? null;

export const captureAvailable = (): boolean => plugin() !== null;

export async function captureEnabled(): Promise<boolean> {
  try {
    return Boolean((await plugin()?.status())?.enabled);
  } catch {
    return false;
  }
}

export async function pullNative(): Promise<Candidate[]> {
  try {
    const result = await plugin()?.pull();
    return parseStored(JSON.stringify(result?.items ?? []));
  } catch {
    return [];
  }
}

export async function openCaptureSettings(): Promise<void> {
  try {
    await plugin()?.openSettings();
  } catch {
    // nothing to open
  }
}
