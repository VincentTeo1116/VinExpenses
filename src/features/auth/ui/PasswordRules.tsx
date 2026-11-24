// AU-04: the live checklist under the password field. Nothing is shown as wrong until the person has started typing.
import { Icon } from '@/components/Icon';
import { useI18n } from '@/lib/i18n';
import { LIMITS, passwordRules } from '../rules';
import styles from './PasswordRules.module.css';

export function PasswordRules({ value, started }: { value: string; started: boolean }) {
  const { t } = useI18n();
  const rules = passwordRules(value);
  return (
    <ul className={styles.list} aria-label={t('rules.label')}>
      {rules.map((rule) => {
        const state = rule.met ? 'met' : started ? 'bad' : 'idle';
        return (
          <li key={rule.key} className={`${styles.rule} ${styles[state]}`} data-rule={rule.key} data-state={state}>
            <Icon name={rule.met ? 'check' : 'x'} size={14} />
            <span>
              {t(`rule.${rule.key}` as const, { n: LIMITS.passwordMin })}
              <span className="sr-only">{rule.met ? ' ✓' : ''}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
