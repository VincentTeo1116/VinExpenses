// The frame around the public pages (welcome, privacy, terms): a header that settles as you scroll, and a footer.
import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { ARTICLES, CALCULATORS, HTML_LANG, pathFor, type PageLang } from '@/features/guides/registry';
import { useUi, usePageLang } from '@/features/guides/useUi';
import { AnalyticsConsent } from '@/features/analytics/AnalyticsConsent';
import { AuthorCredit } from './AuthorCredit';
import styles from './PublicLayout.module.css';

/** Sets the tab title and description for a public page (the page is drawn by the app, so these are set here). */
export function usePageMeta(title: string, description: string, lang: PageLang = 'en') {
  useEffect(() => {
    const before = document.title;
    const beforeLang = document.documentElement.lang;
    document.documentElement.lang = HTML_LANG[lang];
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
      document.documentElement.lang = beforeLang;
      tag?.setAttribute('content', oldDescription);
      og?.setAttribute('content', oldOg);
      if (made) canonical.remove();
      else canonical.href = oldCanonical;
    };
  }, [title, description, lang]);
}

export function PublicLayout({ children, nav }: { children: ReactNode; nav?: ReactNode }) {
  const [scrolled, setScrolled] = useState(false);
  const lang = usePageLang();
  const ui = useUi();
  const groups: { title: string; links: ({ label: string; to: string } | { label: string; href: string })[] }[] = [
    { title: ui.footer.brand, links: [{ label: ui.footer.about, to: '/' }, { label: ui.openApp, to: '/app' }, { label: ui.footer.contact, href: 'mailto:teovincentkq1611@gmail.com' }] },
    { title: ui.footer.calculators, links: CALCULATORS.map((slug) => ({ label: ui.names[slug] ?? slug, to: pathFor(lang, slug) })) },
    { title: ui.footer.guides, links: ARTICLES.map((slug) => ({ label: ui.names[slug] ?? slug, to: pathFor(lang, slug) })) },
    { title: ui.footer.legal, links: [{ label: ui.footer.privacy, to: '/privacy' }, { label: ui.footer.terms, to: '/terms' }] },
  ];
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <div className={styles.page}>
      <a href="#main" className="skip-link">
        {ui.skip}
      </a>
      <header className={`${styles.head} ${scrolled ? styles.scrolled : ''}`}>
        <div className={styles.wrap}>
          <Link to="/" className={styles.brand}>
            <img src="/icons/icon-192.png" alt="" width={34} height={34} />
            <span>ManaDuit</span>
          </Link>
          <nav className={styles.nav} aria-label={ui.site}>
            {nav}
            <Link className={styles.cta} to="/app">
              {ui.openApp}
            </Link>
          </nav>
        </div>
      </header>
      <main id="main" tabIndex={-1} className={styles.main}>
        {children}
      </main>
      <footer className={styles.foot}>
        <div className={styles.wrap}>
          <div className={styles.top}>
            <div className={styles.about}>
              <Link to="/" className={styles.footBrand}>
                <img src="/icons/icon-192.png" alt="" width={36} height={36} />
                <span>ManaDuit</span>
              </Link>
              <p className={styles.tagline}>{ui.footer.tagline}</p>
              <AuthorCredit variant="card" />
            </div>
            <nav className={styles.cols} aria-label={ui.footer.aria}>
              {groups.map((group) => (
                <div key={group.title} className={styles.col}>
                  <p className={styles.colTitle}>{group.title}</p>
                  <ul>
                    {group.links.map((item) => (
                      <li key={item.label}>
                        {'to' in item ? (
                          <NavLink to={item.to} end className={styles.link}>
                            <span className={styles.text}>{item.label}</span>
                          </NavLink>
                        ) : (
                          <a className={styles.link} href={item.href}>
                            <span className={styles.text}>{item.label}</span>
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </nav>
          </div>
          <div className={styles.bottom}>
            <span>© 2026 ManaDuit ({ui.footer.formerly})</span>
            <span>{ui.footer.note}</span>
          </div>
        </div>
      </footer>
      <AnalyticsConsent />
    </div>
  );
}
