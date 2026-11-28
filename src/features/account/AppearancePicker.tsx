// Account > Appearance: Auto (follow the phone), Light or Dark, as one slider whose pill glides to the chosen option.
// A radio group underneath: arrow keys move the choice, and each option is a labelled, full-size tap target.
import { useRef, type KeyboardEvent, type ReactElement } from 'react';
import { useI18n, type MessageKey } from '@/lib/i18n';
import { MODES, type Mode } from './theme';
import styles from './AppearancePicker.module.css';

const ICON: Record<Mode, ReactElement> = {
  auto: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5v17a8.5 8.5 0 0 0 0-17Z" fill="currentColor" />
    </>
  ),
  light: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" />
    </>
  ),
  dark: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />,
};

export function AppearancePicker({ mode, onPick }: { mode: Mode; onPick: (next: Mode) => void }) {
  const { t } = useI18n();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = MODES.indexOf(mode);

  const onKey = (event: KeyboardEvent) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + MODES.length) % MODES.length;
    const target = MODES[next];
    if (target) {
      onPick(target);
      refs.current[next]?.focus();
    }
  };

  return (
    <fieldset className={styles.field}>
      <legend>{t('account.mode')}</legend>
      <p className={styles.hint}>{t('account.modeHint')}</p>
      <div className={styles.track} role="radiogroup" aria-label={t('account.mode')} data-mode-value={mode}>
        <span className={styles.pill} aria-hidden="true" />
        {MODES.map((item, i) => (
          <button
            key={item}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={mode === item}
            tabIndex={mode === item ? 0 : -1}
            className={styles.option}
            data-mode-option={item}
            onClick={() => onPick(item)}
            onKeyDown={onKey}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {ICON[item]}
            </svg>
            {t(`account.mode.${item}` as MessageKey)}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
