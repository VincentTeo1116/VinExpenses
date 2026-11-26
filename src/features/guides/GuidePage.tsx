/* eslint-disable jsx-a11y/no-noninteractive-tabindex -- a table that scrolls sideways on a small screen must be reachable by keyboard */
// The shared frame of the public guide pages (calculators and articles): hero, language links, the content, a way into the app and links to the other guides.
import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AuthorCredit } from '@/features/public/AuthorCredit';
import { Breadcrumb } from '@/features/public/Breadcrumb';
import { PublicLayout, usePageMeta } from '@/features/public/PublicLayout';
import { ARTICLES, CALCULATORS, LANGS, LANG_NAME, pathFor, type GuideSlug, type PageLang } from './registry';
import { useUi } from './useUi';
import styles from './GuidePage.module.css';

const ICON: Record<string, string> = {
  'fd-calculator': 'M3 10l9-6 9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18',
  'loan-calculator': 'M12 3v18M16 7.5C16 6 14.2 5 12 5S8 6 8 7.5 9.8 10 12 10s4 1.2 4 2.5S14.2 15 12 15s-4-1-4-2.5',
  'bill-calculator': 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
  article: 'M5 3h10l4 4v14H5zM14 3v5h5M8 13h8M8 17h5',
};

export function GuideIcon({ slug }: { slug: string }) {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICON[slug] ?? ICON.article} />
    </svg>
  );
}

/** The same page in the other languages, as plain links (each is a full page of its own). */
function LanguageLinks({ lang, slug }: { lang: PageLang; slug: string }) {
  const ui = useUi();
  return (
    <nav className={styles.langs} aria-label={ui.languages}>
      <ul>
        {LANGS.map((code) => (
          <li key={code}>
            {code === lang ? (
              <span className={styles.langNow} aria-current="page" lang={code}>
                {LANG_NAME[code]}
              </span>
            ) : (
              <Link to={pathFor(code, slug)} className={styles.langLink} lang={code} hrefLang={code}>
                {LANG_NAME[code]}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}

interface FrameProps {
  lang: PageLang;
  slug: GuideSlug;
  title: string;
  description: string;
  heading: ReactNode;
  shortName: string;
  eyebrow: string;
  kind: 'calculator' | 'article';
  intro?: ReactNode;
  related: GuideSlug[];
  cta: { title: string; text: string };
  children: ReactNode;
}

export function GuideFrame({ lang, slug, title, description, heading, shortName, eyebrow, kind, intro, related, cta, children }: FrameProps) {
  usePageMeta(title, description, lang);
  const ui = useUi();
  const tools = related.filter((s) => (CALCULATORS as readonly string[]).includes(s));
  const reads = related.filter((s) => (ARTICLES as readonly string[]).includes(s));
  const group = (list: GuideSlug[], label: string) =>
    list.length > 0 && (
      <nav className={styles.more} aria-label={label}>
        <h2 className={styles.moreTitle}>{label}</h2>
        {list.map((s) => (
          <Link key={s} to={pathFor(lang, s)} className={styles.moreCard}>
            <span className={styles.moreIcon}>
              <GuideIcon slug={s} />
            </span>
            <strong>{ui.names[s] ?? s}</strong>
            <span className={styles.arrow} aria-hidden="true">
              →
            </span>
          </Link>
        ))}
      </nav>
    );
  return (
    <PublicLayout>
      <header className={styles.hero}>
        <div className={styles.blobs} aria-hidden="true">
          <span className={styles.blobA} />
          <span className={styles.blobB} />
        </div>
        <div className={styles.wrap}>
          <Breadcrumb items={[{ label: ui.crumbHome, to: '/' }, { label: shortName }]} />
          <span className={styles.eyebrow}>
            <GuideIcon slug={kind === 'calculator' ? slug : 'article'} /> {eyebrow}
          </span>
          <h1 className={styles.h1}>{heading}</h1>
          {intro}
          <AuthorCredit kind={kind === 'article' ? 'writtenBy' : 'madeBy'} />
          <LanguageLinks lang={lang} slug={slug} />
        </div>
      </header>
      <div className={styles.wrap}>
        {children}
        <section className={styles.cta} aria-labelledby="g-cta">
          <div>
            <h2 id="g-cta" className={styles.ctaTitle}>
              {cta.title}
            </h2>
            <p>{cta.text}</p>
          </div>
          <Link className={styles.button} to="/app">
            {ui.openApp}
          </Link>
        </section>
        {group(tools, ui.moreCalculators)}
        {group(reads, ui.moreGuides)}
      </div>
    </PublicLayout>
  );
}

export function TableCard({ caption, head, children, note }: { caption: string; head: ReactNode; children: ReactNode; note?: string }) {
  return (
    <>
      {/* tabIndex: a table that scrolls sideways on a small screen must be reachable by keyboard */}
      <div className={styles.tableWrap} tabIndex={0} role="region" aria-label={caption}>
        <table className={styles.table}>
          <caption>{caption}</caption>
          <thead>{head}</thead>
          <tbody>{children}</tbody>
        </table>
      </div>
      {note ? <p className={styles.tableNote}>{note}</p> : null}
    </>
  );
}
