// PU-03: for an address inside the app that does not exist. (The static host serves /404.html with a real 404 status for other addresses.)
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/Button';
import { useI18n } from '@/lib/i18n';
import styles from './Page.module.css';

export function NotFound() {
  const { t } = useI18n();
  const navigate = useNavigate();
  // history.state.idx is 0 for the first page of a visit: then there is nowhere to go back to
  const canGoBack = typeof window !== 'undefined' && Number((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0;
  return (
    <div className={styles.center}>
      <div className={styles.panel}>
        <p className={styles.code} aria-hidden="true">
          404
        </p>
        <h1 className={styles.h1}>{t('notfound.title')}</h1>
        <p>{t('notfound.body')}</p>
        <div className={styles.actions}>
          {canGoBack ? <Button onClick={() => navigate(-1)}>{t('notfound.back')}</Button> : null}
          <Button variant={canGoBack ? 'outline' : 'primary'} onClick={() => navigate('/app', { replace: true })}>
            {t('notfound.home')}
          </Button>
        </div>
      </div>
    </div>
  );
}
