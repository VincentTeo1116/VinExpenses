// AN-01: asks once whether visits to the public pages may be counted, and (only after a Yes) loads analytics and reports each page view.
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { doNotTrack, GA_ID, loadAnalytics, readChoice, saveChoice, trackPage, type Choice } from './analytics';
import styles from './AnalyticsConsent.module.css';

export function AnalyticsConsent() {
  const { pathname } = useLocation();
  const [choice, setChoice] = useState<Choice>(() => (!GA_ID || doNotTrack() ? 'no' : readChoice()));

  useEffect(() => {
    if (choice === 'yes') loadAnalytics();
  }, [choice]);
  useEffect(() => {
    if (choice === 'yes') trackPage(pathname === '/welcome' ? '/' : pathname);
  }, [choice, pathname]);

  if (choice !== null) return null;
  const answer = (value: 'yes' | 'no') => {
    saveChoice(value);
    setChoice(value);
  };
  return (
    <section className={styles.bar} aria-label="Analytics choice" data-testid="analytics-consent">
      <p className={styles.text}>
        May I count visits to these public pages with Google Analytics? It is never used inside the app, and there are no ads. <Link to="/privacy#share">Details</Link>
      </p>
      <div className={styles.actions}>
        <button type="button" className={styles.yes} onClick={() => answer('yes')}>
          Yes, that is fine
        </button>
        <button type="button" className={styles.no} onClick={() => answer('no')}>
          No thanks
        </button>
      </div>
    </section>
  );
}
