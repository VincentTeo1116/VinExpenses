// AN-01: which language people see, what the administrator is warned about, and what is remembered.
import { beforeEach, describe, expect, it } from 'vitest';
import { emptyTexts, gaps, markShownThisSession, pickText, readiness, readOnThisDevice, rememberRead, shownThisSession, textsOf } from './announce';

const texts = () => ({ en: { title: 'New', body: 'Body' }, ms: { title: 'Baharu', body: 'Isi' }, zh: { title: '', body: '' } });

describe('pickText', () => {
  it('uses the reader language when it is complete', () => expect(pickText(texts(), 'ms')).toMatchObject({ title: 'Baharu', language: 'ms' }));
  it('falls back to English as a whole when the language is empty or half written', () => {
    expect(pickText(texts(), 'zh')).toMatchObject({ title: 'New', body: 'Body', language: 'en' });
    const half = { ...texts(), zh: { title: 'Only a title', body: '' } };
    expect(pickText(half, 'zh')).toMatchObject({ title: 'New', language: 'en' });
  });
});

describe('gaps and readiness', () => {
  it('names the languages that will show English, and why', () => {
    expect(gaps(texts())).toEqual([{ lang: 'zh', kind: 'empty' }]);
    expect(gaps({ ...texts(), ms: { title: 'x', body: '' } })).toEqual([
      { lang: 'ms', kind: 'partial' },
      { lang: 'zh', kind: 'empty' },
    ]);
  });
  it('needs English title and message, and nothing too long', () => {
    expect(readiness(emptyTexts()).ok).toBe(false);
    expect(readiness(texts()).ok).toBe(true);
    const long = { ...texts(), ms: { title: 'x'.repeat(81), body: 'ok' } };
    expect(readiness(long)).toMatchObject({ ok: false, tooLong: ['ms'] });
  });
  it('rebuilds the editor from a stored row', () => {
    expect(textsOf({ id: '1', title_en: 'T', body_en: 'B', title_ms: null, body_ms: null, title_zh: 'A', body_zh: 'B' }).zh).toEqual({ title: 'A', body: 'B' });
    expect(textsOf(null)).toEqual(emptyTexts());
  });
});

describe('what is remembered', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });
  it('remembers per person and per announcement', () => {
    expect(shownThisSession('u1', 'a1')).toBe(false);
    markShownThisSession('u1', 'a1');
    expect(shownThisSession('u1', 'a1')).toBe(true);
    expect(shownThisSession('u2', 'a1')).toBe(false);
    expect(shownThisSession('u1', 'a2')).toBe(false);
    rememberRead('u1', 'a1');
    expect(readOnThisDevice('u1', 'a1')).toBe(true);
    expect(readOnThisDevice('u1', 'a2')).toBe(false);
  });
});
