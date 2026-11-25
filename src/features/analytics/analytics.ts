// AN-01: Google Analytics (GA4) for the PUBLIC pages only (welcome, privacy, terms), so the owner can see how people find the site.
// It is never loaded inside the signed-in app, never before the visitor says yes, and never when the browser says "do not track".
// Ad features are switched off. The measurement ID is a public value, set at build time with VITE_GA_ID (nothing is loaded when it is empty).

const RAW = import.meta.env.VITE_GA_ID as string | undefined;
/** The measurement ID, or '' when none is set or it does not look like one. */
export const GA_ID = /^G-[A-Z0-9]{6,14}$/.test(RAW ?? '') ? (RAW as string) : '';

const KEY = 've_analytics';
export type Choice = 'yes' | 'no' | null;

/** The browser's own "do not track" signal counts as a No, and the question is not even asked. */
export function doNotTrack(): boolean {
  const nav = typeof navigator === 'undefined' ? null : (navigator as Navigator & { globalPrivacyControl?: boolean });
  return Boolean(nav && (nav.doNotTrack === '1' || nav.globalPrivacyControl === true));
}

export function readChoice(): Choice {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'yes' || value === 'no' ? value : null;
  } catch {
    return null;
  }
}
export function saveChoice(choice: 'yes' | 'no'): void {
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    /* the choice just lasts until the page is closed */
  }
}

interface GaWindow {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
}
let loaded = false;

/** Loads Google's script once. Call only after a Yes. */
export function loadAnalytics(): void {
  if (!GA_ID || loaded || typeof document === 'undefined') return;
  loaded = true;
  const w = window as unknown as GaWindow;
  w.dataLayer = w.dataLayer || [];
  // gtag.js needs the "arguments" object itself to be queued (an array is not understood)
  w.gtag = function () {
    // eslint-disable-next-line prefer-rest-params
    w.dataLayer?.push(arguments);
  };
  w.gtag('js', new Date());
  w.gtag('config', GA_ID, {
    send_page_view: false, // the page views are sent by trackPage, because the pages change without a reload
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    cookie_flags: 'SameSite=Lax;Secure',
  });
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_ID)}`;
  document.head.appendChild(script);
}

/** One page view for a public address. Does nothing until analytics has been loaded. */
export function trackPage(path: string): void {
  const w = window as unknown as GaWindow;
  if (!loaded || !w.gtag) return;
  w.gtag('event', 'page_view', { page_path: path, page_location: `${window.location.origin}${path}`, page_title: document.title });
}
