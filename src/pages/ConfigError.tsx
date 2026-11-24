import { EmptyState } from '@/components/EmptyState';
import { useI18n } from '@/lib/i18n';
import { envResult } from '@/lib/env';
import styles from './Page.module.css';

/** Shown instead of the app when a required setting is missing. Problems are listed in development only. */
export function ConfigError() {
  const { t } = useI18n();
  return (
    <div className={styles.center}>
      <div className={styles.panel}>
        <EmptyState icon="alert" title={t('error.config.title')}>
          {t('error.config.body')}
        </EmptyState>
        {import.meta.env.DEV && !envResult.ok ? (
          <ul>
            {envResult.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
