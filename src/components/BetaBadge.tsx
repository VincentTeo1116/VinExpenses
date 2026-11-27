// A small "BETA" pill for features that work but are still being tuned.
import { useI18n } from '@/lib/i18n';
import styles from './BetaBadge.module.css';

export function BetaBadge({ className }: { className?: string }) {
  const { t } = useI18n();
  return <span className={[styles.badge, className ?? ''].filter(Boolean).join(' ')}>{t('beta.label')}</span>;
}
