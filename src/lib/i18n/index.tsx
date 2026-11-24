// I18N-01: three languages, English by default, every string from a catalogue. A missing key falls back to English.
// English is part of the first download; Malay and Chinese are fetched only when someone chooses them (PERF-01).
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { en, type MessageKey } from './en';

export type Lang = 'en' | 'ms' | 'zh';
export const LANGS: readonly Lang[] = ['en', 'ms', 'zh'];
export const LANG_STORAGE_KEY = 've_lang';

type Catalogue = Record<MessageKey, string>;
const loaded: Partial<Record<Lang, Catalogue>> = { en: en as Catalogue };
// English text that belongs to a later screen: added when that screen's code arrives
const englishExtra: Record<string, string> = {};
export function registerEnglish(extra: Record<string, string>): void {
  Object.assign(englishExtra, extra);
}
const loaders: Record<Lang, () => Promise<Catalogue>> = {
  en: () => Promise.resolve(en as Catalogue),
  ms: () => import('./ms').then((module) => module.ms),
  zh: () => import('./zh').then((module) => module.zh),
};
const htmlLang: Record<Lang, string> = { en: 'en', ms: 'ms', zh: 'zh-Hans' };

export function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && (LANGS as readonly string[]).includes(value);
}

/** Fetches a language if it is not here yet. Resolves when it can be used. Never rejects: a failed download keeps English. */
export async function loadLang(lang: Lang): Promise<boolean> {
  if (loaded[lang]) return true;
  try {
    loaded[lang] = await loaders[lang]();
    return true;
  } catch {
    return false;
  }
}

/** Looks a message up and fills {placeholders}. Values are plain text; nothing is ever turned into HTML. */
export function translate(lang: Lang, key: MessageKey, values?: Record<string, string | number>): string {
  const template = loaded[lang]?.[key] ?? (en as Record<string, string>)[key] ?? englishExtra[key] ?? key;
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in values ? String(values[name]) : match));
}

function readStoredLang(): Lang {
  try {
    const stored = localStorage.getItem(LANG_STORAGE_KEY);
    return isLang(stored) ? stored : 'en';
  } catch {
    return 'en'; // storage can be blocked (private mode): English still works
  }
}

interface I18nValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: MessageKey, values?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children, initial }: { children: ReactNode; initial?: Lang }) {
  const [lang, setLangState] = useState<Lang>(initial ?? readStoredLang());
  const [, setVersion] = useState(0);

  // Fetch the chosen language, then redraw. (English needs no fetch.)
  useEffect(() => {
    document.documentElement.lang = htmlLang[lang];
    if (loaded[lang]) return undefined;
    let cancelled = false;
    void loadLang(lang).then(() => {
      if (!cancelled) setVersion((value) => value + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [lang]);

  // The new language is fetched first and only then applied, so the screen (and anything half-typed in it) stays as it is
  const setLang = useCallback((next: Lang) => {
    if (!isLang(next)) return;
    void loadLang(next).then((ok) => {
      if (!ok) return; // the download failed: keep the current language
      setLangState(next);
      try {
        localStorage.setItem(LANG_STORAGE_KEY, next);
      } catch {
        /* the choice still applies for this visit */
      }
    });
  }, []);

  const value = useMemo<I18nValue>(() => ({ lang, setLang, t: (key, values) => translate(lang, key, values) }), [lang, setLang]);
  // While a chosen language is still arriving, show nothing rather than a mix of two languages
  if (!loaded[lang]) return null;
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside I18nProvider');
  return value;
}

export type { MessageKey };
