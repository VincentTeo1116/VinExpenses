// CP-05: the Home banner and review list for detected payments, and the Account card that explains and switches the feature on.
import { useEffect, useState } from 'react';
import { useAuth } from '@/app/AuthProvider';
import { Button } from '@/components/Button';
import { Sheet } from '@/components/Sheet';
import { useI18n } from '@/lib/i18n';
import { formatMoney } from '@/lib/money';
import { useMoney } from '@/features/money/MoneyContext';
import { captureAvailable, captureEnabled, openCaptureSettings } from './bridge';
import type { Candidate } from './engine';
import { dismissCandidate, openInbox, refreshInbox, useInbox } from './store';
import styles from './CaptureInbox.module.css';

function useSync() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? '';
  useEffect(() => {
    if (!userId || !captureAvailable()) return undefined;
    openInbox(userId);
    void refreshInbox();
    const onShow = () => document.visibilityState === 'visible' && void refreshInbox();
    document.addEventListener('visibilitychange', onShow);
    return () => document.removeEventListener('visibilitychange', onShow);
  }, [userId]);
}

export function CaptureBanner() {
  const { t } = useI18n();
  const { openAdd } = useMoney();
  const items = useInbox();
  const [open, setOpen] = useState(false);
  useSync();
  if (!captureAvailable() || items.length === 0) return null;

  const add = (item: Candidate) => {
    setOpen(false);
    openAdd({ kind: 'expense', prefill: { amount: item.amount, merchant: item.merchant, date: item.date }, onSaved: () => dismissCandidate(item.id) });
  };
  return (
    <>
      <div className={styles.banner} data-testid="capture-banner">
        <p>{t('cap.banner', { count: items.length })}</p>
        <Button variant="outline" onClick={() => setOpen(true)}>
          {t('cap.review')}
        </Button>
      </div>
      <Sheet open={open} onClose={() => setOpen(false)} title={t('cap.title')} size="wide">
        <p className={styles.sub}>{t('cap.sub')}</p>
        <ul className={styles.list}>
          {items.map((item) => (
            <li key={item.id} className={styles.row} data-testid="capture-item">
              <div className={styles.main}>
                <strong className={styles.amount}>{formatMoney(item.amount)}</strong>
                <span className={styles.shop}>{item.merchant || t('cap.noShop')}</span>
                <small className={styles.meta}>
                  {item.appLabel} · {item.date}
                </small>
              </div>
              <div className={styles.actions}>
                <Button onClick={() => add(item)}>{t('cap.add')}</Button>
                <Button variant="outline" onClick={() => dismissCandidate(item.id)}>
                  {t('cap.dismiss')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </Sheet>
    </>
  );
}

export function CaptureSettingsCard() {
  const { t } = useI18n();
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    if (!captureAvailable()) return undefined;
    const check = () => void captureEnabled().then(setOn);
    check();
    const onShow = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', onShow);
    return () => document.removeEventListener('visibilitychange', onShow);
  }, []);
  if (!captureAvailable()) return null;
  return (
    <section className={styles.card} aria-labelledby="cap-settings-title" data-testid="capture-settings">
      <h2 id="cap-settings-title" className={styles.h2}>
        {t('cap.settings.title')}
      </h2>
      <p>{t('cap.settings.sub')}</p>
      <p className={styles.status} role="status">
        {on === null ? t('common.loading') : on ? t('cap.status.on') : t('cap.status.off')}
      </p>
      <Button variant={on ? 'outline' : 'primary'} onClick={() => void openCaptureSettings()}>
        {t('cap.open')}
      </Button>
    </section>
  );
}
