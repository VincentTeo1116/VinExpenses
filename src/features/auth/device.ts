// AU-06 / AU-07: a random id for this browser (so a wrong-password pause applies to this device only) and the
// "remember me for 30 days" choice. Neither holds a password, a code or a token.
import { LIMITS } from './rules';

const DEVICE_KEY = 'et_device';
const REMEMBER_KEY = 'et_remember_until';
const TAB_KEY = 'et_tab_alive';
const DEVICE_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

let temporaryId = '';

export function deviceId(): string {
  try {
    const saved = localStorage.getItem(DEVICE_KEY);
    if (saved && DEVICE_PATTERN.test(saved)) return saved;
    const bytes = crypto.getRandomValues(new Uint8Array(18));
    const id = `d${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
    localStorage.setItem(DEVICE_KEY, id);
    return id;
  } catch {
    // storage blocked: an id for this visit only (the pause then follows the visit, not the browser)
    if (!temporaryId) temporaryId = `tmp${Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('')}`;
    return temporaryId;
  }
}

export function setRemember(on: boolean, now = Date.now()): void {
  try {
    localStorage.setItem(REMEMBER_KEY, on ? String(now + LIMITS.rememberDays * 86_400_000) : '0');
    sessionStorage.setItem(TAB_KEY, '1');
  } catch {
    /* storage blocked: the session lasts as long as the browser allows */
  }
}

/** True when this device was not asked to remember the person, or the 30 days are over, and the browser was closed since. */
export function shouldSignOutOnStart(now = Date.now()): boolean {
  try {
    const saved = localStorage.getItem(REMEMBER_KEY);
    if (saved === null) return false; // signed in before this feature existed: leave it
    const until = Number(saved);
    if (!Number.isFinite(until)) return false;
    if (until > now) return false; // still remembered
    return !sessionStorage.getItem(TAB_KEY); // not remembered: only while this browser session lasts
  } catch {
    return false;
  }
}

export function forgetDeviceChoices(): void {
  try {
    localStorage.removeItem(REMEMBER_KEY);
    sessionStorage.removeItem(TAB_KEY);
  } catch {
    /* nothing to clear */
  }
}
