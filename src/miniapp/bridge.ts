// The link to the Telegram app: who the user is (signed), the theme colours and a few commands.
// The page never decides who someone is; it only forwards Telegram's signed launch data to the server, which checks the signature.
const STORAGE_KEY = 'vinexpenses.initData';
const TELEGRAM_ORIGINS = ['https://web.telegram.org', 'https://webk.telegram.org', 'https://webz.telegram.org', 'https://telegram.org'];
const COLOR = /^#[0-9a-f]{6}$/i;
// Telegram theme key -> the CSS variable this page uses
export const THEME_VARS: Record<string, string> = {
  bg_color: '--tg-bg',
  text_color: '--tg-text',
  hint_color: '--tg-hint',
  link_color: '--tg-link',
  button_color: '--tg-button',
  button_text_color: '--tg-button-text',
  secondary_bg_color: '--tg-secondary-bg',
  section_bg_color: '--tg-section-bg',
  section_separator_color: '--tg-separator',
  destructive_text_color: '--tg-destructive',
  accent_text_color: '--tg-accent',
};
type Theme = Record<string, string>;

export interface Launch {
  initData: string;
  themeParams: Theme;
  platform: string;
  version: string;
}

/** Reads the launch parameters out of the address fragment ("#tgWebAppData=...&tgWebAppThemeParams=..."). */
export function parseLaunch(hash: string): Launch {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  } catch {
    return { initData: '', themeParams: {}, platform: '', version: '' };
  }
  const theme: Theme = {};
  try {
    const parsed = JSON.parse(params.get('tgWebAppThemeParams') || '{}') as unknown;
    if (parsed && typeof parsed === 'object') {
      for (const key of Object.keys(THEME_VARS)) {
        const value = (parsed as Record<string, unknown>)[key];
        if (typeof value === 'string' && COLOR.test(value)) theme[key] = value.toLowerCase();
      }
    }
  } catch {
    /* no theme: the page's own light/dark colours are used */
  }
  return { initData: (params.get('tgWebAppData') || '').slice(0, 4096), themeParams: theme, platform: String(params.get('tgWebAppPlatform') || '').slice(0, 20), version: String(params.get('tgWebAppVersion') || '').slice(0, 10) };
}

/** "dark" or "light" for a background colour (by its brightness), or '' when unknown. */
export function schemeOf(hex: string | undefined): 'dark' | 'light' | '' {
  if (!hex || !COLOR.test(hex)) return '';
  const n = parseInt(hex.slice(1), 16);
  const luminance = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return luminance < 0.5 ? 'dark' : 'light';
}

/** The user object inside initData (for the language only). */
export function userOf(initData: string): { language_code?: string } | null {
  try {
    return (JSON.parse(new URLSearchParams(initData).get('user') || 'null') as { language_code?: string } | null) || null;
  } catch {
    return null;
  }
}

/** True unless the page is inside a frame that is not a Telegram web client (where it is meant to stay blank). */
export function frameAllowed(win: Window): boolean {
  try {
    if (win.self === win.top) return true;
    const ancestors = win.location.ancestorOrigins;
    if (!ancestors || !ancestors.length) return true; // browsers without ancestorOrigins: the page has no data anyway without a launch
    for (let i = 0; i < ancestors.length; i++) if (TELEGRAM_ORIGINS.includes(ancestors[i] as string)) return true;
    return false;
  } catch {
    return true;
  }
}

export interface Bridge {
  initData: string;
  user: { language_code?: string } | null;
  platform: string;
  version: string;
  isTelegram: boolean;
  themeParams: () => Theme;
  applyTheme: (root: HTMLElement) => void;
  onTheme: (listener: (theme: Theme) => void) => void;
  start: () => void;
  setColors: (hex: string) => void;
  haptic: (kind: 'success' | 'error' | 'warning' | 'select' | 'light') => void;
  close: () => void;
  openLink: (url: string) => void;
}

export function createBridge(win: Window): Bridge {
  const launch = parseLaunch(win.location.hash);
  let store: Storage | null = null;
  try {
    store = win.sessionStorage;
  } catch {
    store = null;
  }
  let initData = launch.initData;
  // A reload can lose the fragment: keep the last launch for this tab only (cleared when the tab closes).
  if (initData && store) {
    try {
      store.setItem(STORAGE_KEY, initData);
    } catch {
      /* ignore */
    }
  }
  if (!initData && store) {
    try {
      initData = (store.getItem(STORAGE_KEY) || '').slice(0, 4096);
    } catch {
      initData = '';
    }
  }

  const themeListeners: ((theme: Theme) => void)[] = [];
  let themeParams = launch.themeParams;
  const webview = (win as unknown as { TelegramWebviewProxy?: { postEvent?: (type: string, data: string) => void } }).TelegramWebviewProxy;

  function post(type: string, data?: unknown): boolean {
    try {
      if (webview && typeof webview.postEvent === 'function') {
        webview.postEvent(type, JSON.stringify(data || {}));
        return true;
      }
      if (win.parent && win.parent !== win) {
        // The messages carry no private data (ready / expand / vibrate), so any parent origin is fine.
        win.parent.postMessage(JSON.stringify({ eventType: type, eventData: data || {} }), '*');
        return true;
      }
    } catch {
      /* not inside Telegram, or Telegram refused: harmless */
    }
    return false;
  }

  function receive(type: unknown, data: unknown) {
    if (type !== 'theme_changed' || !data || typeof data !== 'object') return;
    const incoming = (data as { theme_params?: Record<string, unknown> }).theme_params;
    if (!incoming) return;
    const next: Theme = {};
    for (const key of Object.keys(THEME_VARS)) {
      const value = incoming[key];
      if (typeof value === 'string' && COLOR.test(value)) next[key] = value.toLowerCase();
    }
    themeParams = next;
    for (const listener of themeListeners) {
      try {
        listener(next);
      } catch {
        /* ignore */
      }
    }
  }

  // Telegram calls this on phones and desktop; the web client sends a "message" instead.
  try {
    const target = win as unknown as { Telegram?: { WebView?: { receiveEvent?: (type: unknown, data: unknown) => void } } };
    target.Telegram = target.Telegram ?? {};
    target.Telegram.WebView = target.Telegram.WebView ?? {};
    target.Telegram.WebView.receiveEvent = (type, data) => receive(type, data);
    win.addEventListener('message', (event) => {
      if (event.source !== win.parent) return;
      try {
        const message = JSON.parse(String(event.data)) as { eventType?: unknown; eventData?: unknown };
        receive(message.eventType, message.eventData);
      } catch {
        /* not a Telegram message */
      }
    });
  } catch {
    /* ignore */
  }

  return {
    initData,
    user: userOf(initData),
    platform: launch.platform,
    version: launch.version,
    isTelegram: Boolean(initData),
    themeParams: () => themeParams,
    applyTheme(root) {
      for (const [key, variable] of Object.entries(THEME_VARS)) {
        const value = themeParams[key];
        if (value) root.style.setProperty(variable, value);
        else root.style.removeProperty(variable);
      }
      const scheme = schemeOf(themeParams.bg_color || themeParams.secondary_bg_color);
      if (scheme) root.setAttribute('data-scheme', scheme);
      else root.removeAttribute('data-scheme');
    },
    onTheme: (listener) => {
      themeListeners.push(listener);
    },
    /** Tells Telegram the page is ready (hides its loading spinner) and asks for the full screen height. */
    start() {
      post('web_app_ready');
      post('web_app_expand');
      post('web_app_setup_swipe_behavior', { allow_vertical_swipe: false }); // scrolling must not close the app
    },
    setColors(hex) {
      if (COLOR.test(hex || '')) {
        post('web_app_set_header_color', { color: hex });
        post('web_app_set_background_color', { color: hex });
      }
    },
    haptic(kind) {
      if (kind === 'success' || kind === 'error' || kind === 'warning') post('web_app_trigger_haptic_feedback', { type: 'notification', notification_type: kind });
      else if (kind === 'select') post('web_app_trigger_haptic_feedback', { type: 'selection_change' });
      else post('web_app_trigger_haptic_feedback', { type: 'impact', impact_style: 'light' });
    },
    close() {
      post('web_app_close');
    },
    openLink(url) {
      if (!/^https:\/\//i.test(url || '')) return;
      if (!post('web_app_open_link', { url })) {
        try {
          win.open(url, '_blank', 'noopener');
        } catch {
          /* ignore */
        }
      }
    },
  };
}
