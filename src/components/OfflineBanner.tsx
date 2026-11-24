import { useSyncExternalStore } from 'react';
import { Icon } from './Icon';
import { useI18n } from '@/lib/i18n';
import styles from './OfflineBanner.module.css';

const subscribe = (listener: () => void) => {
  window.addEventListener('online', listener);
  window.addEventListener('offline', listener);
  return () => {
    window.removeEventListener('online', listener);
    window.removeEventListener('offline', listener);
  };
};

export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}

/** PF-04: tells people plainly when they are offline, so a failed save is never a mystery. */
export function OfflineBanner() {
  const online = useOnline();
  const { t } = useI18n();
  if (online) return null;
  return (
    <div className={styles.banner} role="status">
      <Icon name="offline" size={18} />
      <span>{t('state.offline')}</span>
    </div>
  );
}
