// AN-01: asks once whether visits to the public pages may be counted, and (only after a Yes) loads analytics and reports each page view.
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useUi } from '@/features/guides/useUi';
import { doNotTrack, GA_ID, loadAnalytics, readChoice, saveChoice, trackPage, type Choice } from './analytics';
import styles from './AnalyticsConsent.module.css';

export function AnalyticsConsent() {
  const { pathname } = useLocation();
  const words = useUi().consent;
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
    <section className={styles.bar} aria-label={words.aria} data-testid="analytics-consent">
      <p className={styles.text}>
        {words.text} <Link to="/privacy#share">{words.details}</Link>
      </p>
      <div className={styles.actions}>
        <button type="button" className={styles.yes} onClick={() => answer('yes')}>
          {words.yes}
        </button>
        <button type="button" className={styles.no} onClick={() => answer('no')}>
          {words.no}
        </button>
      </div>
    </section>
  );
}
