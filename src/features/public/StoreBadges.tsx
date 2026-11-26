// Two "coming soon" store badges (not links: neither app is published yet); swap them for each store's official badge when it goes live.
import styles from './StoreBadges.module.css';

const STORES = [
  { name: 'Google Play', lead: 'Get it on', mark: 'M7 4.5v15l12.5-7.5z' },
  { name: 'App Store', lead: 'Download on the', mark: 'M12 4.5 7 19.5M12 4.5l5 15M8.6 14.5h6.8' },
] as const;

export function StoreBadges({ center = false }: { center?: boolean }) {
  return (
    <div className={`${styles.wrap} ${center ? styles.center : ''}`} data-testid="store-badges">
      <p className={styles.label}>Android and iPhone apps</p>
      <ul className={styles.list}>
        {STORES.map((store) => (
          <li key={store.name} className={styles.badge}>
            <svg viewBox="0 0 24 24" width="30" height="30" fill={store.name === 'Google Play' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={store.mark} />
            </svg>
            <span className={styles.text}>
              <small>{store.lead}</small>
              <strong>{store.name}</strong>
            </span>
            <span className={styles.soon}>Coming soon</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
