// Two "coming soon" store badges (not links: neither app is published yet); swap them for each store's official badge when it goes live.
import styles from './StoreBadges.module.css';

function PlayMark() {
  return (
    <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true">
      <path d="M3.6 2.2 13 12l-9.4 9.8c-.4-.3-.6-.8-.6-1.4V3.6c0-.6.2-1.1.6-1.4Z" fill="#00c3ff" />
      <path d="m3.6 2.2 .5-.2c.5-.2 1.1-.1 1.7.2l11.4 6.5-3.2 3.3L3.6 2.2Z" fill="#00f076" />
      <path d="m3.6 21.8 9.8-9.8 3.2 3.3L5.8 21.8c-.6.3-1.2.4-1.7.2l-.5-.2Z" fill="#ff3a44" />
      <path d="m16.6 8.7 3.4 1.9c1.2.7 1.2 1.9 0 2.6l-3.4 1.9L13.4 12l3.2-3.3Z" fill="#ffd400" />
    </svg>
  );
}

function AppleMark() {
  return (
    <svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor" aria-hidden="true">
      <path d="M17.05 12.54c-.03-2.77 2.26-4.1 2.36-4.17-1.29-1.88-3.29-2.14-4-2.17-1.7-.17-3.32 1-4.18 1-.87 0-2.2-.98-3.62-.95-1.86.03-3.58 1.08-4.54 2.75-1.94 3.36-.5 8.33 1.39 11.06.92 1.33 2.02 2.83 3.46 2.78 1.39-.06 1.91-.9 3.59-.9 1.68 0 2.15.9 3.62.87 1.5-.03 2.44-1.36 3.35-2.7 1.06-1.55 1.5-3.05 1.52-3.13-.03-.01-2.92-1.12-2.95-4.44ZM14.3 4.4c.76-.92 1.28-2.2 1.14-3.48-1.1.04-2.43.73-3.22 1.65-.7.81-1.32 2.11-1.15 3.36 1.23.1 2.48-.62 3.23-1.53Z" />
    </svg>
  );
}

const STORES = [
  { name: 'Google Play', lead: 'GET IT ON', mark: <PlayMark /> },
  { name: 'App Store', lead: 'Download on the', mark: <AppleMark /> },
] as const;

export function StoreBadges({ center = false }: { center?: boolean }) {
  return (
    <div className={`${styles.wrap} ${center ? styles.center : ''}`} data-testid="store-badges">
      <p className={styles.label}>Android and iPhone apps</p>
      <ul className={styles.list}>
        {STORES.map((store) => (
          <li key={store.name} className={styles.badge}>
            {store.mark}
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
