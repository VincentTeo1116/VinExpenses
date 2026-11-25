// AC-09: a gentle nudge to connect Telegram. It lives at the bottom of the "Don't forget" pop-up, so it only ever appears to people who
// have a saved fixed deposit or loan with something due (that is what Telegram reminders are for). Everyone else finds Telegram in Account.
// It stops once Telegram is connected or the person says "don't ask again"; that choice is kept with the account and on this device.
import { useState } from 'react';
import { useAuth } from '@/app/AuthProvider';
import { Button } from '@/components/Button';
import { useToast } from '@/components/Toast';
import { useI18n } from '@/lib/i18n';
import { useTelegramStatus } from '@/features/account/useTelegram';
import { CatIcon } from '@/components/CatIcon';
import styles from './TelegramPrompt.module.css';

/** The Telegram section of the reminder pop-up. `onConnect` closes the pop-up and opens Account at the Telegram card. */
export function TelegramNudge({ onConnect }: { onConnect: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
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
      <div className={styles.row}>
        <CatIcon name="telegram" color="#0284c7" size={40} />
        <div className={styles.text}>
          <h3 id="tgp-title" className={styles.title}>
            {t('tgp.popTitle')}
          </h3>
          <p className={styles.body}>{t('tgp.body')}</p>
        </div>
      </div>
      <div className={styles.actions}>
        <Button onClick={onConnect}>{t('tgp.connect')}</Button>
        <Button variant="ghost" onClick={() => void hide()}>
          {t('tgp.hide')}
        </Button>
      </div>
    </section>
  );
}
