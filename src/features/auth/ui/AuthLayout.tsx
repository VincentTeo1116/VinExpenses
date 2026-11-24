// The frame of every sign-in screen: a brand panel (desktop) and the card with the current step.
import type { ReactNode } from 'react';
import { Icon, type IconName } from '@/components/Icon';
import { LanguageSelect } from '@/components/LanguageSelect';
import { useI18n, type MessageKey } from '@/lib/i18n';
import styles from './AuthLayout.module.css';

const POINTS: { icon: IconName; text: MessageKey }[] = [
  { icon: 'bolt', text: 'auth.point1' },
  { icon: 'repeat', text: 'auth.point2' },
  { icon: 'chart', text: 'auth.point3' },
];

export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className={styles.page}>
      <aside className={styles.brand} aria-hidden="false">
        <div className={styles.brandInner}>
          <img src="/icons/icon-192.png" alt="" width={56} height={56} className={styles.logo} />
          <p className={styles.name}>{t('app.name')}</p>
          <h2 className={styles.tagline}>{t('app.tagline')}</h2>
          <ul className={styles.points}>
            {POINTS.map((point) => (
              <li key={point.text}>
                <span className={styles.pointIcon}>
                  <Icon name={point.icon} size={18} />
                </span>
                {t(point.text)}
              </li>
            ))}
          </ul>
        </div>
      </aside>
      <main className={styles.main} id="main" tabIndex={-1}>
        <div className={styles.card}>
          <div className={styles.mobileBrand}>
            <img src="/icons/icon-192.png" alt="" width={40} height={40} />
            <span>{t('app.name')}</span>
          </div>
          <h1 className={styles.title}>{title}</h1>
          {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
          <div className={styles.body} key={title}>
            {children}
          </div>
          {footer ? <div className={styles.footer}>{footer}</div> : null}
        </div>
        <div className={styles.lang}>
          <LanguageSelect />
        </div>
      </main>
    </div>
  );
}
