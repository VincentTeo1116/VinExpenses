// The frame around the public pages (welcome, privacy, terms): a header that settles as you scroll, and a footer.
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import styles from './PublicLayout.module.css';

/** Sets the tab title and description for a public page (the page is drawn by the app, so these are set here). */
export function usePageMeta(title: string, description: string) {
  useEffect(() => {
    const before = document.title;
    document.title = title;
    const tag = document.querySelector('meta[name="description"]');
    const oldDescription = tag?.getAttribute('content') ?? '';
    tag?.setAttribute('content', description);
    // the address of this page as the one search engines should list (the app and sign-in pages are kept out by a header)
    let canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    const made = !canonical;
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.rel = 'canonical';
      document.head.appendChild(canonical);
    }
    const oldCanonical = canonical.href;
    canonical.href = `${window.location.origin}${window.location.pathname === '/welcome' ? '/' : window.location.pathname}`;
    const og = document.querySelector('meta[property="og:title"]');
    const oldOg = og?.getAttribute('content') ?? '';
    og?.setAttribute('content', title);
    return () => {
      document.title = before;
      tag?.setAttribute('content', oldDescription);
      og?.setAttribute('content', oldOg);
      if (made) canonical.remove();
      else canonical.href = oldCanonical;
    };
  }, [title, description]);
}

export function PublicLayout({ children, nav }: { children: ReactNode; nav?: ReactNode }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <div className={styles.page}>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className={`${styles.head} ${scrolled ? styles.scrolled : ''}`}>
        <div className={styles.wrap}>
          <Link to="/" className={styles.brand}>
            <img src="/icons/icon-192.png" alt="" width={34} height={34} />
            <span>VinExpenses</span>
          </Link>
          <nav className={styles.nav} aria-label="Site">
            {nav}
            <Link className={styles.cta} to="/app">
              Open the app
            </Link>
          </nav>
        </div>
      </header>
      <main id="main" tabIndex={-1} className={styles.main}>
        {children}
      </main>
      <footer className={styles.foot}>
        <div className={styles.wrap}>
          <span>© 2026 Vincent Teo · VinExpenses</span>
          <nav aria-label="Legal">
            <Link to="/">About</Link>
            <Link to="/privacy">Privacy Policy</Link>
            <Link to="/terms">Terms of Use</Link>
            <a href="mailto:teovincentkq1611@gmail.com">Contact</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
