// AU-10: Google sign-in. After it, a first-time person lands on the setup screen to choose a name and a password.
import { useState } from 'react';
import { Button } from '@/components/Button';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/app/AuthProvider';
import { setRemember } from '../device';
import type { NoticeState } from './types';
import styles from './steps.module.css';

export function GoogleButton({ notice }: { notice: (state: NoticeState) => void }) {
  const { t } = useI18n();
  const { client } = useAuth();
  const [busy, setBusy] = useState(false);

  const start = async () => {
    notice(null);
    if (!client) return notice({ kind: 'bad', text: t('error.config.body') });
    setBusy(true);
    try {
      setRemember(true);
      // The person comes back to /auth, where the new session is picked up
      const { error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}/auth` } });
      if (error) notice({ kind: 'bad', text: t('auth.googleFailed') });
    } catch {
      notice({ kind: 'bad', text: t('auth.googleFailed') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className={styles.divider} role="separator">
        <span>{t('auth.or')}</span>
      </div>
      <Button variant="outline" block loading={busy} onClick={() => void start()}>
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path fill="#4285F4" d="M22.5 12.2c0-.8-.1-1.5-.2-2.2H12v4.2h5.9a5 5 0 0 1-2.2 3.3v2.7h3.5c2.1-1.9 3.3-4.7 3.3-8z" />
          <path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.5-2.7c-1 .7-2.3 1.1-3.8 1.1-2.9 0-5.4-2-6.3-4.6H2.1v2.8A11 11 0 0 0 12 23z" />
          <path fill="#FBBC05" d="M5.7 14.1a6.6 6.6 0 0 1 0-4.2V7.1H2.1a11 11 0 0 0 0 9.8z" />
          <path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.3 1.7l3.1-3.1A11 11 0 0 0 2.1 7.1l3.6 2.8C6.6 7.4 9.1 5.4 12 5.4z" />
        </svg>
        {t('auth.google')}
      </Button>
    </>
  );
}
