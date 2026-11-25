// The author's name with a link to the portfolio. It is only a link: nothing from the app is sent to that site, and "noreferrer" keeps this
// site's address from being passed on either. The privacy policy says so (section 4).
import styles from './AuthorCredit.module.css';

export const PORTFOLIO_URL = 'https://vincent16.vercel.app';

/** "inline" is a short line for a footer or a byline; "card" is a larger block for the end of a page. */
export function AuthorCredit({ lead = 'Designed and built by', variant = 'inline' }: { lead?: string; variant?: 'inline' | 'card' }) {
  return (
    <p className={variant === 'card' ? styles.card : styles.inline} data-testid="author-credit">
      <span>{lead}</span>{' '}
      <a href={PORTFOLIO_URL} target="_blank" rel="noopener noreferrer">
        Vincent Teo<span className="sr-only"> (opens the portfolio in a new tab)</span>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M7 17 17 7M8 7h9v9" />
        </svg>
      </a>
    </p>
  );
}
