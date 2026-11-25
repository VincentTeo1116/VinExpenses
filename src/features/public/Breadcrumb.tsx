// "You are here": a short trail of pills (home, then the current page). The earlier steps are links; the last one is the page itself.
import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import styles from './Breadcrumb.module.css';

export interface Crumb {
  label: string;
  /** Leave out for the page being read. */
  to?: string;
}

export function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav className={styles.nav} aria-label="Breadcrumb">
      <ol className={styles.list}>
        {items.map((item, index) => (
          <Fragment key={item.label}>
            {index > 0 && (
              <li className={styles.sep} aria-hidden="true">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m9 6 6 6-6 6" />
                </svg>
              </li>
            )}
            <li className={styles.item}>
              {item.to ? (
                <Link to={item.to} className={styles.link}>
                  {index === 0 && (
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M3 11.5 12 4l9 7.5M5.5 10v9.5h13V10" />
                    </svg>
                  )}
                  <span>{item.label}</span>
                </Link>
              ) : (
                <span className={styles.current} aria-current="page">
                  {item.label}
                </span>
              )}
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}
