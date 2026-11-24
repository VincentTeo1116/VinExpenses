import { useId } from 'react';
import { LANGS, isLang, useI18n } from '@/lib/i18n';
import styles from './LanguageSelect.module.css';

/** AC-06: the language choice. English is the default; the choice is kept on this device (and later with the account). */
export function LanguageSelect() {
  const { lang, setLang, t } = useI18n();
  const id = useId();
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{t('lang.label')}</label>
      <select id={id} value={lang} onChange={(event) => { const next = event.target.value; if (isLang(next)) setLang(next); }}>
        {LANGS.map((code) => (
          <option key={code} value={code} lang={code === 'zh' ? 'zh-Hans' : code}>
            {t(`lang.${code}` as const)}
          </option>
        ))}
      </select>
    </div>
  );
}
