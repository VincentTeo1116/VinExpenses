// The language choice on the sign-in card: a small globe chip ("EN", "BM", "中文") at the top right. The chip is only the look;
// a real, invisible <select> sits on top of it, so tapping opens the phone's or browser's own menu with the full names,
// and screen readers and the keyboard get an ordinary labelled list.
import { useId } from 'react';
import { LANGS, isLang, useI18n } from '@/lib/i18n';
import styles from './LanguageChip.module.css';

const SHORT = { en: 'EN', ms: 'BM', zh: '中文' } as const;

export function LanguageChip() {
  const { lang, setLang, t } = useI18n();
  const id = useId();
  return (
    <div className={styles.chip}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18" />
        <path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18Z" />
      </svg>
      <span className={styles.code} aria-hidden="true">
        {SHORT[lang]}
      </span>
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m6 9 6 6 6-6" />
      </svg>
      <select
        id={id}
        className={styles.select}
        aria-label={t('lang.label')}
        value={lang}
        onChange={(event) => {
          const next = event.target.value;
          if (isLang(next)) setLang(next);
        }}
      >
        {LANGS.map((code) => (
          <option key={code} value={code} lang={code === 'zh' ? 'zh-Hans' : code}>
            {t(`lang.${code}` as const)}
          </option>
        ))}
      </select>
    </div>
  );
}
