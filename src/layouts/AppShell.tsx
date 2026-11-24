// The frame around every signed-in screen: a sticky sidebar from 1024px up, a tab bar with a big + button below that.
import { useEffect } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Icon, type IconName } from '@/components/Icon';
import { useMoney } from '@/features/money/MoneyContext';
import { useAuth } from '@/app/AuthProvider';
import { OfflineBanner } from '@/components/OfflineBanner';
import { ErrorBoundary } from '@/app/ErrorBoundary';
import { useI18n, type MessageKey } from '@/lib/i18n';
import { useAdminStatus } from '@/features/admin/useAdmin';
import { applyTheme, readTheme } from '@/features/account/theme';
import styles from './AppShell.module.css';

interface NavItem {
  to: string;
  end?: boolean;
  icon: IconName;
  label: MessageKey;
}

const NAV: NavItem[] = [
  { to: '/app', end: true, icon: 'home', label: 'nav.home' },
  { to: '/app/history', icon: 'history', label: 'nav.history' },
  { to: '/app/plan', icon: 'plan', label: 'nav.plan' },
  { to: '/app/account', icon: 'user', label: 'nav.account' },
];

// the sidebar keeps Account in the user card at its bottom instead
const SIDE = NAV.filter((item) => item.to !== '/app/account');

// shown only to the administrator (the server checks the role again on every admin action)
const ADMIN_ITEM: NavItem = { to: '/app/admin', icon: 'shield', label: 'nav.admin' };

const TITLES: Record<string, MessageKey> = {
  '/app': 'screen.home.title',
  '/app/history': 'screen.history.title',
  '/app/plan': 'screen.plan.title',
  '/app/account': 'screen.account.title',
  '/app/admin': 'screen.admin.title',
  '/app/report': 'report.open',
};

export function AppShell() {
  const { t } = useI18n();
  const location = useLocation();
  const { openAdd } = useMoney();
  const { isAdmin } = useAdminStatus();
  const { session } = useAuth();
  const meta = (session?.user?.user_metadata ?? {}) as Record<string, unknown>;
  const who = (typeof meta.username === 'string' && meta.username) || session?.user?.email || '';
  const userId = session?.user?.id;
  useEffect(() => {
    applyTheme(readTheme(userId));
    return () => applyTheme('blue');
  }, [userId]);
  const path = location.pathname.replace(/\/+$/, '') || '/app';

  // Each screen sets its own tab title, and the page is announced to screen readers by moving focus to the content
  useEffect(() => {
    const key = TITLES[path];
    document.title = `${key ? t(key) : t('app.name')} · ${t('app.name')}`;
  }, [path, t]);

  const half = Math.ceil(NAV.length / 2);
  const link = (item: NavItem) => (
    <NavLink key={item.to} to={item.to} end={item.end} state={{ from: path }} className={({ isActive }) => `${styles.tab} ${isActive ? styles.active : ''}`}>
      <Icon name={item.icon} size={22} />
      <span>{t(item.label)}</span>
    </NavLink>
  );

  return (
    <div className={styles.shell}>
      <a href="#main" className="skip-link">
        {t('nav.skip')}
      </a>

      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <img src="/icons/icon-192.png" alt="" width={36} height={36} />
          <span>{t('app.name')}</span>
        </div>
        <button type="button" className={styles.newBtn} onClick={() => openAdd()}>
          <Icon name="plus" size={20} />
          <span>{t('nav.add')}</span>
          <kbd className={styles.key} aria-hidden="true">
            N
          </kbd>
        </button>
        <nav aria-label={t('nav.main')} className={styles.sideNav}>
          {(isAdmin ? [...SIDE, ADMIN_ITEM] : SIDE).map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `${styles.sideLink} ${isActive ? styles.active : ''}`}>
              <Icon name={item.icon} size={20} />
              <span>{t(item.label)}</span>
            </NavLink>
          ))}
        </nav>
        <NavLink to="/app/account" state={{ from: path }} className={({ isActive }) => `${styles.userCard} ${isActive ? styles.userActive : ''}`}>
          <span className={styles.avatar} aria-hidden="true">
            {(who.trim()[0] ?? '?').toUpperCase()}
          </span>
          <span className={styles.userText}>
            <strong>{who}</strong>
            <small>{t('nav.accountSub')}</small>
          </span>
          <Icon name="dots" size={20} />
        </NavLink>
      </aside>

      <div className={styles.column}>
        <OfflineBanner />
        <main id="main" tabIndex={-1} className={styles.main}>
          <ErrorBoundary resetKey={path}>
            <div key={path} className={styles.screen}>
              <Outlet />
            </div>
          </ErrorBoundary>
        </main>
      </div>

      <nav aria-label={t('nav.main')} className={styles.tabbar}>
        {NAV.slice(0, half).map(link)}
        <button type="button" className={styles.fab} onClick={() => openAdd()} aria-label={t('nav.add')}>
          <Icon name="plus" size={26} />
        </button>
        {NAV.slice(half).map(link)}
      </nav>
    </div>
  );
}
