/* miniapp/bridge.js
 *
 * The thin layer between this page and the Telegram app that is showing it.
 *
 * Telegram gives a Mini App three things: (1) who the user is, as a SIGNED string called initData (the server checks the
 * signature, this page never trusts it), (2) the app's colours, so the page can match the user's theme, and (3) a few
 * commands such as "expand to full height" and "vibrate lightly". All of it arrives in the page address after the "#".
 *
 * This file implements that small protocol itself instead of loading Telegram's script from telegram.org: the site's
 * security policy allows only its own files, and a script from another website could otherwise change what runs here.
 * If anything about the bridge fails, the page still works: it only loses polish (full height, matching colours, haptics).
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.MiniBridge = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var STORAGE_KEY = 'vinexpenses.initData';
    var TELEGRAM_ORIGINS = ['https://web.telegram.org', 'https://webk.telegram.org', 'https://webz.telegram.org', 'https://telegram.org'];
    var COLOR = /^#[0-9a-f]{6}$/i;
    // Telegram theme key -> the CSS variable this page uses
    var THEME_VARS = {
        bg_color: '--tg-bg', text_color: '--tg-text', hint_color: '--tg-hint', link_color: '--tg-link',
        button_color: '--tg-button', button_text_color: '--tg-button-text', secondary_bg_color: '--tg-secondary-bg',
        section_bg_color: '--tg-section-bg', section_separator_color: '--tg-separator', destructive_text_color: '--tg-destructive',
        accent_text_color: '--tg-accent',
    };

    /** Reads the launch parameters out of the address fragment ("#tgWebAppData=...&tgWebAppThemeParams=..."). */
    function parseLaunch(hash) {
        var params;
        try {
            params = new URLSearchParams(String(hash || '').replace(/^#/, ''));
        } catch (_) {
            return { initData: '', themeParams: {}, platform: '', version: '' };
        }
        var theme = {};
        try {
            var parsed = JSON.parse(params.get('tgWebAppThemeParams') || '{}');
            if (parsed && typeof parsed === 'object') {
                Object.keys(THEME_VARS).forEach(function (key) {
                    if (typeof parsed[key] === 'string' && COLOR.test(parsed[key])) theme[key] = parsed[key].toLowerCase();
                });
            }
        } catch (_) { /* no theme: the page's own light/dark colours are used */ }
        return {
            initData: (params.get('tgWebAppData') || '').slice(0, 4096),
            themeParams: theme,
            platform: String(params.get('tgWebAppPlatform') || '').slice(0, 20),
            version: String(params.get('tgWebAppVersion') || '').slice(0, 10),
        };
    }

    /** "dark" or "light" for a background colour (by its brightness). */
    function schemeOf(hex) {
        if (!COLOR.test(hex || '')) return '';
        var n = parseInt(hex.slice(1), 16);
        var luminance = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
        return luminance < 0.5 ? 'dark' : 'light';
    }

    /** The user object inside initData (for the language only: the server is the one that decides who someone is). */
    function userOf(initData) {
        try {
            return JSON.parse(new URLSearchParams(initData).get('user') || 'null') || null;
        } catch (_) {
            return null;
        }
    }

    function safeStorage(win) {
        try { return win.sessionStorage; } catch (_) { return null; }
    }

    /** True unless the page is inside a frame that is not a Telegram web client (where it is meant to be blank). */
    function frameAllowed(win) {
        try {
            if (win.self === win.top) return true;
            var ancestors = win.location && win.location.ancestorOrigins;
            if (!ancestors || !ancestors.length) return true; // browsers without ancestorOrigins: the page has no data anyway without a launch
            for (var i = 0; i < ancestors.length; i++) if (TELEGRAM_ORIGINS.indexOf(ancestors[i]) !== -1) return true;
            return false;
        } catch (_) {
            return true;
        }
    }

    function create(win) {
        var launch = parseLaunch(win.location && win.location.hash);
        var store = safeStorage(win);
        var initData = launch.initData;
        // A reload can lose the fragment: keep the last launch for this tab only (cleared when the tab closes).
        if (initData && store) { try { store.setItem(STORAGE_KEY, initData); } catch (_) { /* ignore */ } }
        if (!initData && store) { try { initData = (store.getItem(STORAGE_KEY) || '').slice(0, 4096); } catch (_) { initData = ''; } }

        var themeListeners = [];
        var themeParams = launch.themeParams;

        function post(type, data) {
            try {
                if (win.TelegramWebviewProxy && typeof win.TelegramWebviewProxy.postEvent === 'function') {
                    win.TelegramWebviewProxy.postEvent(type, JSON.stringify(data || {}));
                    return true;
                }
                if (win.parent && win.parent !== win) {
                    // The messages carry no private data (ready / expand / vibrate), so any parent origin is fine.
                    win.parent.postMessage(JSON.stringify({ eventType: type, eventData: data || {} }), '*');
                    return true;
                }
            } catch (_) { /* not inside Telegram, or Telegram refused: harmless */ }
            return false;
        }

        function applyTheme(rootElement) {
            Object.keys(THEME_VARS).forEach(function (key) {
                if (themeParams[key]) rootElement.style.setProperty(THEME_VARS[key], themeParams[key]);
                else rootElement.style.removeProperty(THEME_VARS[key]);
            });
            var scheme = schemeOf(themeParams.bg_color || themeParams.secondary_bg_color);
            if (scheme) rootElement.setAttribute('data-scheme', scheme); else rootElement.removeAttribute('data-scheme');
        }

        function receive(type, data) {
            if (type === 'theme_changed' && data && typeof data === 'object' && data.theme_params) {
                var next = {};
                Object.keys(THEME_VARS).forEach(function (key) {
                    if (typeof data.theme_params[key] === 'string' && COLOR.test(data.theme_params[key])) next[key] = data.theme_params[key].toLowerCase();
                });
                themeParams = next;
                themeListeners.forEach(function (listener) { try { listener(next); } catch (_) { /* ignore */ } });
            }
        }

        // Telegram calls this on phones and desktop; the web client sends a "message" instead.
        try {
            win.Telegram = win.Telegram || {};
            win.Telegram.WebView = win.Telegram.WebView || {};
            win.Telegram.WebView.receiveEvent = function (type, data) { receive(type, data); };
            if (typeof win.addEventListener === 'function') {
                win.addEventListener('message', function (event) {
                    if (event.source !== win.parent) return;
                    try {
                        var message = JSON.parse(event.data);
                        receive(message.eventType, message.eventData);
                    } catch (_) { /* not a Telegram message */ }
                });
            }
        } catch (_) { /* ignore */ }

        return {
            initData: initData,
            user: userOf(initData),
            platform: launch.platform,
            version: launch.version,
            isTelegram: Boolean(initData),
            themeParams: function () { return themeParams; },
            applyTheme: applyTheme,
            onTheme: function (listener) { themeListeners.push(listener); },
            /** Tells Telegram the page is ready (hides its loading spinner) and asks for the full screen height. */
            start: function () {
                post('web_app_ready');
                post('web_app_expand');
                post('web_app_setup_swipe_behavior', { allow_vertical_swipe: false }); // scrolling must not close the app
            },
            setColors: function (hex) {
                if (COLOR.test(hex || '')) {
                    post('web_app_set_header_color', { color: hex });
                    post('web_app_set_background_color', { color: hex });
                }
            },
            haptic: function (kind) {
                if (kind === 'success' || kind === 'error' || kind === 'warning') post('web_app_trigger_haptic_feedback', { type: 'notification', notification_type: kind });
                else if (kind === 'select') post('web_app_trigger_haptic_feedback', { type: 'selection_change' });
                else post('web_app_trigger_haptic_feedback', { type: 'impact', impact_style: 'light' });
            },
            close: function () { post('web_app_close'); },
            openLink: function (url) {
                if (!/^https:\/\//i.test(url || '')) return;
                if (!post('web_app_open_link', { url: url })) { try { win.open(url, '_blank', 'noopener'); } catch (_) { /* ignore */ } }
            },
        };
    }

    return { create: create, parseLaunch: parseLaunch, schemeOf: schemeOf, userOf: userOf, frameAllowed: frameAllowed, THEME_VARS: THEME_VARS, STORAGE_KEY: STORAGE_KEY };
});
