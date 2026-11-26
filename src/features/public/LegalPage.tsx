// The shared look of the Privacy Policy and the Terms of Use: a reading bar, a short-version card whose points appear one by one,
// a contents list that follows where you are, and sections that settle in as you reach them.
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AuthorCredit } from './AuthorCredit';
import { PublicLayout, usePageMeta } from './PublicLayout';
import { calm, Reveal } from './motion';
import styles from './LegalPage.module.css';

export function LegalSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <Reveal as="section" className={styles.section}>
      <h2 id={id} className={styles.h2}>
        {title}
      </h2>
      <div className={styles.body}>{children}</div>
    </Reveal>
  );
}

interface Props {
  title: string;
  updated: string;
  intro: ReactNode;
  summary: ReactNode[];
  sections: { id: string; label: string }[];
  other: { to: string; label: string };
  children: ReactNode;
}

export function LegalPage({ title, updated, intro, summary, sections, other, children }: Props) {
  usePageMeta(`${title} · VinExpenses`, title === 'Privacy Policy' ? 'How VinExpenses collects, uses, shares and protects your personal data, and the choices you have.' : 'The terms for using VinExpenses: your account, your data, estimates not advice, and acceptable use.');
  const [active, setActive] = useState('');
  const [top, setTop] = useState(false);

  // the contents list highlights the section being read
  useEffect(() => {
    const headings = sections.map((s) => document.getElementById(s.id)).filter((el): el is HTMLElement => el !== null);
    if (!('IntersectionObserver' in window)) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActive(visible.target.id);
      },
      { rootMargin: '-90px 0px -65% 0px' },
    );
    headings.forEach((h) => observer.observe(h));
    return () => observer.disconnect();
  }, [sections]);

  useEffect(() => {
    const onScroll = () => setTop(window.scrollY > 900);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const jump = (id: string) => (event: React.MouseEvent) => {
    event.preventDefault();
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: calm() ? 'auto' : 'smooth', block: 'start' });
    el.setAttribute('tabindex', '-1');
    el.focus({ preventScroll: true });
    history.replaceState(null, '', `#${id}`);
  };

  return (
    <PublicLayout
      nav={
        <Link to={other.to}>{other.label}</Link>
      }
    >
      <div className={styles.progress} aria-hidden="true" />
      <div className={styles.hero}>
        <div className={styles.wrap}>
          <p className={styles.updated}>{updated}</p>
          <h1 className={styles.h1}>{title}</h1>
          <p className={styles.intro}>{intro}</p>
          <AuthorCredit kind="writtenBy" />
        </div>
      </div>

      <div className={styles.wrap}>
        <Reveal className={styles.summary}>
          <h2 className={styles.summaryTitle}>The short version</h2>
          <ul>
            {summary.map((point, index) => (
              <li key={index} className={styles.point}>
                {point}
              </li>
            ))}
          </ul>
        </Reveal>

        <div className={styles.layout}>
          <nav className={styles.toc} aria-label="Sections">
            <p className={styles.tocTitle}>On this page</p>
            <ul>
              {sections.map((s, index) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} onClick={jump(s.id)} aria-current={active === s.id ? 'true' : undefined}>
                    <span className={styles.n}>{index + 1}</span>
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <article className={styles.doc}>{children}</article>
        </div>

        <p className={styles.other}>
          Also read the <Link to={other.to}>{other.label}</Link>, or <Link to="/">go back to the welcome page</Link>.
        </p>
      </div>

      <button type="button" className={`${styles.top} ${top ? styles.topOn : ''}`} aria-label="Back to the top" tabIndex={top ? 0 : -1} onClick={() => window.scrollTo({ top: 0, behavior: calm() ? 'auto' : 'smooth' })}>
        ↑
      </button>
    </PublicLayout>
  );
}
