// AU-07: "sign-in is paused". A live countdown for an automatic pause; no end time for one set by the admin.
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { useI18n } from '@/lib/i18n';
import { formatCountdown } from '../rules';
import { useCountdown } from '../ui/useCountdown';
import styles from './steps.module.css';

export function BlockedStep({ until, manual, onReset, onContact, onBack }: { until: number | null; manual: boolean; onReset: () => void; onContact: () => void; onBack: () => void }) {
  const { t } = useI18n();
  const left = useCountdown(until);
  return (
    <div className={styles.form}>
      <div className={styles.pauseIcon} aria-hidden="true">
        <Icon name="shield" size={28} />
      </div>
      <p className={styles.lead}>{manual ? t('blocked.manual') : t('blocked.text')}</p>
      {until && !manual ? (
        <p className={styles.bigTimer} role="timer" aria-live="off">
          {left > 0 ? t('blocked.timer', { time: formatCountdown(left) }) : t('blocked.now')}
        </p>
      ) : null}
      {manual ? null : (
        <Button block onClick={onReset}>
          <Icon name="key" size={18} />
          {t('blocked.reset')}
        </Button>
      )}
      <Button variant="outline" block onClick={onContact}>
        <Icon name="mail" size={18} />
        {t('blocked.contact')}
      </Button>
      <button type="button" className={styles.link} onClick={onBack}>
        {t('blocked.back')}
      </button>
    </div>
  );
}
