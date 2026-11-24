import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import styles from './EmptyState.module.css';

/** Used for empty lists, "coming soon" screens and recoverable errors: say what happened and what to do next. */
export function EmptyState({ icon = 'info', title, children, action }: { icon?: IconName; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={styles.box}>
      <span className={styles.icon}>
        <Icon name={icon} size={26} />
      </span>
      <h2 className={styles.title}>{title}</h2>
      {children ? <p className={styles.body}>{children}</p> : null}
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  );
}
