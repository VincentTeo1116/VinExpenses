// The security headers and Content-Security-Policy the build writes. Kept apart from the Vite config so tests can read them.

/** Builds the Content-Security-Policy for the production page. Nothing is allowed that the app does not use. */
/** `meta: true` leaves out frame-ancestors, which browsers ignore (and warn about) inside a <meta> tag. */
export const TELEGRAM_ORIGINS = ['https://web.telegram.org', 'https://webk.telegram.org', 'https://webz.telegram.org', 'https://telegram.org'];

/** `ancestors` lists the only sites allowed to put the page in a frame (the Mini App lives inside Telegram). */
/** The two public map services the browser asks for places near the person ("Find places near me"). Allowed for the website only, never for the Mini App. */
export const MAP_ORIGINS = ['https://photon.komoot.io', 'https://overpass-api.de'];

/** Google Analytics, for the public pages only (see src/features/analytics). The signed-in app's own headers never list these. */
export const ANALYTICS_SCRIPT = ['https://www.googletagmanager.com'];
export const ANALYTICS_CONNECT = ['https://www.googletagmanager.com', 'https://www.google-analytics.com', 'https://*.google-analytics.com', 'https://*.analytics.google.com'];
export const ANALYTICS_IMG = ['https://www.googletagmanager.com', 'https://www.google-analytics.com', 'https://*.google-analytics.com'];
/**
 * The pages that may load analytics (after a Yes). The front page is listed under every name Cloudflare may match it by: it answers "/" from the file
 * index.html, and live the stricter policy came back on "/" alone (two policy headers, so the stricter one won) until all of these were listed.
 */
export const ANALYTICS_PAGES = ['/', '/index', '/index/', '/index.html', '/welcome', '/privacy', '/terms'];

/** `maps` lets the page ask those map services directly (see MAP_ORIGINS). `analytics` adds Google Analytics (only the public pages get it in the headers). */
export function buildCsp(supabaseUrl: string, turnstile: boolean, meta = false, ancestors: string[] = [], maps = false, analytics = false): string {
  let origin = '';
  try {
    origin = new URL(supabaseUrl).origin;
  } catch {
    origin = '';
  }
  const connect = ["'self'", origin, ...(maps ? MAP_ORIGINS : []), ...(analytics ? ANALYTICS_CONNECT : [])].filter(Boolean).join(' ');
  const scripts = ["'self'", turnstile ? 'https://challenges.cloudflare.com' : '', ...(analytics ? ANALYTICS_SCRIPT : [])].filter(Boolean).join(' ');
  const frames = turnstile ? 'https://challenges.cloudflare.com' : "'none'";
  return [
    "default-src 'none'",
    `script-src ${scripts}`,
    "style-src 'self'",
    `img-src 'self' data: blob:${analytics ? ` ${ANALYTICS_IMG.join(' ')}` : ''}`,
    "font-src 'self'",
    `connect-src ${connect}`,
    `frame-src ${frames}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    ...(meta ? [] : [`frame-ancestors ${ancestors.length ? ancestors.join(' ') : "'none'"}`]),
  ].join('; ');
}

/** The security headers for Cloudflare Pages (served from a `_headers` file). Also used by the tests. */
export function headersFile(csp: string, miniCsp = '', analyticsCsp = ''): string {
  return `/*
  Content-Security-Policy: ${csp}
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(self), microphone=(), geolocation=(self), payment=(), usb=()
  Strict-Transport-Security: max-age=63072000; includeSubDomains
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Resource-Policy: same-origin

/assets/*
  Cache-Control: public, max-age=31536000, immutable
${
  analyticsCsp
    ? `
# Only the public pages may load Google Analytics (after a Yes). The app, sign-in and everything else keep the stricter policy above.
${ANALYTICS_PAGES.map((page) => `${page}\n  ! Content-Security-Policy\n  Content-Security-Policy: ${analyticsCsp}`).join('\n')}
`
    : ''
}
# The sitemap is a plain data file. Without this rule the page policy blocks the browser's own XML viewer from styling it, and it looks like unformatted text.
/sitemap.xml
  ! Content-Security-Policy

# The on-device receipt reader runs in its own worker, which needs WebAssembly. Only these files get that permission (not the page), and they may only
# fetch from this site.
/ocr/*
  ! Content-Security-Policy
  Content-Security-Policy: default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'
  Cache-Control: public, max-age=86400

# The app and its sign-in are private: search engines must not list them (the welcome, privacy and terms pages may be listed)
/app
  X-Robots-Tag: noindex, nofollow
/app/*
  X-Robots-Tag: noindex, nofollow
/auth
  X-Robots-Tag: noindex, nofollow
/auth/*
  X-Robots-Tag: noindex, nofollow
# the emailed link is /email-action.html; Cloudflare answers it at the clean address /email-action, so both are listed
/email-action.html
  X-Robots-Tag: noindex, nofollow
/email-action
  X-Robots-Tag: noindex, nofollow
${
  miniCsp
    ? `
# The Telegram Mini App is the one page that may be framed, and only by Telegram's own web apps
/miniapp/*
  ! X-Frame-Options
  ! Content-Security-Policy
  Content-Security-Policy: ${miniCsp}
  Referrer-Policy: no-referrer
  Cache-Control: no-cache
  X-Robots-Tag: noindex, nofollow
`
    : ''
}
/index.html
  Cache-Control: no-cache

/sw.js
  Cache-Control: no-cache

/404.html
  Cache-Control: no-cache
  X-Robots-Tag: noindex
`;
}

