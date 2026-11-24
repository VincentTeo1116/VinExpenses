// AC-09: a gentle nudge on Home to connect Telegram, until it is connected or the person says "don't ask again".
// The choice is kept with the account (so it holds on every device) and also on this device.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/app/AuthProvider';
import { Button } from '@/components/Button';
import { useToast } from '@/components/Toast';
import { useI18n } from '@/lib/i18n';
import { useTelegramStatus } from '@/features/account/useTelegram';
import { CatIcon } from '@/components/CatIcon';
import styles from './DashboardPage.module.css';

export function TelegramPrompt() {
  const { t } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const { client, session } = useAuth();
  const { status } = useTelegramStatus();
  const userId = session?.user?.id ?? '';
  const key = `et_tg_prompt_${userId}`;
  const meta = (session?.user?.user_metadata ?? {}) as Record<string, unknown>;
  const [hiddenHere, setHiddenHere] = useState(() => {
    try {
      return localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  });
  if (status === null || status.linked || meta.tg_prompt_hidden === true || hiddenHere) return null; // unknown or already connected: no nudge

  const hide = async () => {
    setHiddenHere(true);
    try {
      localStorage.setItem(key, '1');
    } catch {
      /* the account copy is enough */
    }
    toast.show('info', t('tgp.hidden'));
    try {
      await client?.auth.updateUser({ data: { tg_prompt_hidden: true } });
    } catch {
      /* the device copy is enough */
    }
  };

  return (
    <section className={styles.nudge} aria-labelledby="tgp-title" data-testid="tg-prompt">
      <CatIcon name="telegram" color="#0284c7" size={44} />
      <div className={styles.nudgeText}>
        <h2 id="tgp-title" className={styles.h2}>
          {t('tgp.title')}
        </h2>
        <p className={styles.muted}>{t('tgp.body')}</p>
      </div>
      <div className={styles.nudgeActions}>
        <Button onClick={() => navigate('/app/account', { state: { focus: 'telegram' } })}>{t('tgp.connect')}</Button>
        <Button variant="ghost" onClick={() => void hide()}>
          {t('tgp.hide')}
        </Button>
      </div>
    </section>
  );
}
