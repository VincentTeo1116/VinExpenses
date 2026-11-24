import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider, LANG_STORAGE_KEY, useI18n, translate, LANGS } from './index';
import { en as enCore } from './en';
import { enDash } from './enDash';
import { ms } from './ms';
import { zh } from './zh';

const en = { ...enCore, ...enDash };
const catalogues = { en, ms, zh };

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('I18N-01 catalogues', () => {
  it('Malay and Chinese have exactly the same keys as English', () => {
    const base = Object.keys(en).sort();
    for (const lang of LANGS) expect(Object.keys(catalogues[lang]).sort(), lang).toEqual(base);
  });

  it('every message keeps the same {placeholders} in every language', () => {
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      for (const lang of LANGS) expect(placeholders(catalogues[lang][key]), `${lang}:${key}`).toEqual(placeholders(en[key]));
    }
  });

  it('no message is empty or still in the other language by mistake (Malay/Chinese differ from English where words are translated)', () => {
    for (const lang of LANGS) for (const [key, value] of Object.entries(catalogues[lang])) expect(value.trim().length, `${lang}:${key}`).toBeGreaterThan(0);
    expect(catalogues.ms['nav.home']).not.toBe(en['nav.home']);
    expect(catalogues.zh['nav.home']).not.toBe(en['nav.home']);
  });

  it('fills placeholders with plain text and leaves unknown ones visible', () => {
    expect(translate('en', 'screen.soon.title', { screen: 'Plan' })).toBe('Plan is being rebuilt');
    expect(translate('en', 'screen.soon.title')).toContain('{screen}');
    // text is never treated as HTML
    expect(translate('en', 'screen.soon.title', { screen: '<b>x</b>' })).toBe('<b>x</b> is being rebuilt');
  });
});

function Probe() {
  const { lang, setLang, t } = useI18n();
  return (
    <div>
      <p data-testid="text">{t('nav.home')}</p>
      <p data-testid="lang">{lang}</p>
      <button onClick={() => setLang('ms')}>ms</button>
      <button onClick={() => setLang('zh')}>zh</button>
      <button onClick={() => setLang('xx' as never)}>bad</button>
    </div>
  );
}

describe('I18nProvider', () => {
  it('starts in English even when the browser prefers another language', () => {
    render(<I18nProvider><Probe /></I18nProvider>);
    expect(screen.getByTestId('lang')).toHaveTextContent('en');
    expect(document.documentElement.lang).toBe('en');
  });

  it('switches language, sets <html lang>, and remembers the choice', async () => {
    const user = userEvent.setup();
    render(<I18nProvider><Probe /></I18nProvider>);
    await user.click(screen.getByText('zh'));
    expect(screen.getByTestId('text')).toHaveTextContent('首页');
    expect(document.documentElement.lang).toBe('zh-Hans');
    expect(localStorage.getItem(LANG_STORAGE_KEY)).toBe('zh');
  });

  it('ignores an unknown language code', async () => {
    const user = userEvent.setup();
    render(<I18nProvider><Probe /></I18nProvider>);
    await user.click(screen.getByText('bad'));
    expect(screen.getByTestId('lang')).toHaveTextContent('en');
  });

  it('reads a saved choice, and a tampered saved value falls back to English', () => {
    localStorage.setItem(LANG_STORAGE_KEY, 'ms');
    const { unmount } = render(<I18nProvider><Probe /></I18nProvider>);
    expect(screen.getByTestId('lang')).toHaveTextContent('ms');
    unmount();
    localStorage.setItem(LANG_STORAGE_KEY, '<script>');
    render(<I18nProvider><Probe /></I18nProvider>);
    expect(screen.getByTestId('lang')).toHaveTextContent('en');
  });
});

describe('lazy languages (PERF-01)', () => {
  it('switching keeps the screen mounted: a half-typed field survives the change', async () => {
    const user = userEvent.setup();
    function Form() {
      const { setLang, t } = useI18n();
      return (
        <div>
          <label>
            note
            <input data-testid="note" />
          </label>
          <p data-testid="text">{t('nav.home')}</p>
          <button onClick={() => setLang('ms')}>to-ms</button>
        </div>
      );
    }
    render(<I18nProvider><Form /></I18nProvider>);
    await user.type(screen.getByTestId('note'), 'half typed');
    await user.click(screen.getByText('to-ms'));
    expect(await screen.findByText('Utama')).toBeInTheDocument();
    expect(screen.getByTestId('note')).toHaveValue('half typed');
  });
});
