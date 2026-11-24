import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { useI18n } from '@/lib/i18n';
import styles from './ProtectedRoute.module.css';

/** Screens inside the app need a session. This is a convenience; the database still refuses anyone who is not allowed. */
export function ProtectedRoute() {
  const { status, signedOutByChoice } = useAuth();
  const { t } = useI18n();
  const location = useLocation();
  if (status === 'loading') {
    return (
      <div className={styles.loading} role="status">
        <span className={styles.spinner} aria-hidden="true" />
        <span className="sr-only">{t('common.loading')}</span>
      </div>
    );
  }
  if (status === 'signedOut' || status === 'needsMfa') return <Navigate to="/auth" replace state={signedOutByChoice ? null : { from: location.pathname }} />;
  if (status === 'needsSetup') return <Navigate to="/auth/setup" replace />;
  return <Outlet />;
}
