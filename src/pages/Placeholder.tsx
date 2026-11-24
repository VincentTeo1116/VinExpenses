import { EmptyState } from '@/components/EmptyState';
import { LanguageSelect } from '@/components/LanguageSelect';
import { useI18n, type MessageKey } from '@/lib/i18n';
import styles from './Page.module.css';

/** A screen that is not rebuilt yet. It says so honestly, so nobody thinks something is broken. */
export function Placeholder({ title, withLanguage = false }: { title: MessageKey; withLanguage?: boolean }) {
  const { t } = useI18n();
  return (
    <div className={styles.page}>
      <h1 className={styles.h1}>{t(title)}</h1>
      <EmptyState icon="info" title={t('screen.soon.title', { screen: t(title) })}>
        {t('screen.soon.body')}
      </EmptyState>
      {withLanguage ? (
        <div className={styles.card}>
          <LanguageSelect />
        </div>
      ) : null}
    </div>
  );
}
