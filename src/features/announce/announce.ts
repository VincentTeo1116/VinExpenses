// AN-01: the rules of the "what's new" announcement: which language a person sees, what the administrator is still missing, and what is remembered about who has read it.
import type { Lang } from '@/lib/i18n';

export const TITLE_MAX = 80;
export const BODY_MAX = 1500;

export interface Text {
  title: string;
  body: string;
}
export type Texts = Record<Lang, Text>;

/** One announcement as it is stored: English always, the other two languages only when written. */
export interface AnnouncementRow {
  id: string;
  title_en: string;
  body_en: string;
  title_ms: string | null;
  body_ms: string | null;
  title_zh: string | null;
  body_zh: string | null;
  status?: string;
  published_at?: string | null;
  created_at?: string;
}

export const emptyTexts = (): Texts => ({ en: { title: '', body: '' }, ms: { title: '', body: '' }, zh: { title: '', body: '' } });

export const textsOf = (row: AnnouncementRow | null | undefined): Texts =>
  row
    ? { en: { title: row.title_en, body: row.body_en }, ms: { title: row.title_ms ?? '', body: row.body_ms ?? '' }, zh: { title: row.title_zh ?? '', body: row.body_zh ?? '' } }
    : emptyTexts();

/** A language counts only when both its title and its message are written. */
export const filled = (text: Text): boolean => text.title.trim() !== '' && text.body.trim() !== '';

/** What a person reading in `lang` sees: their own language when it is complete, otherwise English as a whole (never half and half). */
export function pickText(texts: Texts, lang: Lang): Text & { language: Lang } {
  if (lang !== 'en' && filled(texts[lang])) return { ...texts[lang], language: lang };
  return { ...texts.en, language: 'en' };
}

export interface Gap {
  lang: 'ms' | 'zh';
  /** `empty`: nothing written. `partial`: only a title or only a message. */
  kind: 'empty' | 'partial';
}

/** The optional languages that will show English instead, with why. */
export function gaps(texts: Texts): Gap[] {
  const out: Gap[] = [];
  for (const lang of ['ms', 'zh'] as const) {
    const t = texts[lang];
    if (filled(t)) continue;
    out.push({ lang, kind: t.title.trim() === '' && t.body.trim() === '' ? 'empty' : 'partial' });
  }
  return out;
}

export interface Readiness {
  /** The English title and message are both written, and nothing is too long: it can be published. */
  ok: boolean;
  english: boolean;
  tooLong: Lang[];
}

export function readiness(texts: Texts): Readiness {
  const english = filled(texts.en);
  const tooLong = (['en', 'ms', 'zh'] as const).filter((lang) => texts[lang].title.length > TITLE_MAX || texts[lang].body.length > BODY_MAX);
  return { ok: english && tooLong.length === 0, english, tooLong };
}

// ---- what is remembered, so a closed announcement does not come straight back

const shownKey = (userId: string, id: string) => `et_ann_shown_${userId}_${id}`;
const readKey = (userId: string) => `et_ann_read_${userId}`;

/** Shown in this browser session already (a refresh in the same tab does not bring it back). */
export function shownThisSession(userId: string, id: string): boolean {
  try {
    return sessionStorage.getItem(shownKey(userId, id)) === '1';
  } catch {
    return false;
  }
}
export function markShownThisSession(userId: string, id: string): void {
  try {
    sessionStorage.setItem(shownKey(userId, id), '1');
  } catch {
    /* the person may see it once more; nothing breaks */
  }
}

/** "Don't show me again", kept on this device as well as on the account, so it holds even when the account copy could not be saved. */
export function readOnThisDevice(userId: string, id: string): boolean {
  try {
    return localStorage.getItem(readKey(userId)) === id;
  } catch {
    return false;
  }
}
export function rememberRead(userId: string, id: string): void {
  try {
    localStorage.setItem(readKey(userId), id);
  } catch {
    /* the account copy is enough */
  }
}
