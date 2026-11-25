/* eslint-disable jsx-a11y/no-noninteractive-tabindex -- a table that scrolls sideways on a small screen must be reachable by keyboard */
// The shared frame of the public guide pages: a hero with the short answer, a workbench slot for the calculator (inputs and result side by
// side on a computer), numbered explanation cards, a table of common cases, a way into the app and links to the other guides. The words come
// from content.ts, which the build also writes into each page's HTML, so search engines see the same text.
import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AuthorCredit } from '@/features/public/AuthorCredit';
import { Breadcrumb } from '@/features/public/Breadcrumb';
import { PublicLayout, usePageMeta } from '@/features/public/PublicLayout';
import { guideBySlug, type Guide } from './content';
import styles from './GuidePage.module.css';

const ICON: Record<Guide['slug'], string> = {
  'fd-calculator': 'M3 10l9-6 9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18',
  'loan-calculator': 'M12 3v18M16 7.5C16 6 14.2 5 12 5S8 6 8 7.5 9.8 10 12 10s4 1.2 4 2.5S14.2 15 12 15s-4-1-4-2.5',
};

export function GuideIcon({ slug }: { slug: Guide['slug'] }) {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICON[slug]} />
    </svg>
  );
}

export function GuidePage({ guide, children }: { guide: Guide; children: ReactNode }) {
  usePageMeta(guide.title, guide.description);
  const others = guide.related.map((slug) => guideBySlug(slug)).filter((g): g is Guide => Boolean(g));
  return (
    <PublicLayout>
      <header className={styles.hero}>
        <div className={styles.blobs} aria-hidden="true">
          <span className={styles.blobA} />
          <span className={styles.blobB} />
        </div>
        <div className={styles.wrap}>
          <Breadcrumb items={[{ label: 'VinExpenses', to: '/' }, { label: guide.shortName }]} />
          <span className={styles.eyebrow}>
            <GuideIcon slug={guide.slug} /> Free · No sign-up · Nothing is saved
          </span>
          <h1 className={styles.h1}>{guide.heading}</h1>
          <p className={styles.answer}>{guide.answer}</p>
          <AuthorCredit lead="Made by" />
        </div>
      </header>

      <div className={styles.wrap}>
        <div className={styles.tool}>{children}</div>
        <p className={styles.disclaimer}>{guide.disclaimer}</p>

        <div className={styles.sections}>
          {guide.sections.map((section, index) => (
            <section key={section.id} className={styles.section} aria-labelledby={`g-${section.id}`}>
              <span className={styles.num} aria-hidden="true">
                {index + 1}
              </span>
              <h2 id={`g-${section.id}`} className={styles.h2}>
                {section.heading}
              </h2>
              {section.paragraphs.map((text) => (
                <p key={text}>{text}</p>
              ))}
            </section>
          ))}
        </div>

        {/* tabIndex: a table that scrolls sideways on a small screen must be reachable by keyboard */}
        <div className={styles.tableWrap} tabIndex={0} role="region" aria-label={`${guide.table.caption} (scroll sideways on a small screen)`}>
          <table className={styles.table}>
            <caption>{guide.table.caption}</caption>
            <thead>
              <tr>
                {guide.table.head.map((h) => (
                  <th key={h} scope="col">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {guide.table.rows.map((row) => (
                <tr key={row[0]}>
                  {row.map((cell, i) =>
                    i === 0 ? (
                      <th key={cell} scope="row">
                        {cell}
                      </th>
                    ) : (
                      <td key={`${row[0]}-${i}`}>{cell}</td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={styles.tableNote}>{guide.table.note}</p>

        <section className={styles.cta} aria-labelledby="g-cta">
          <div>
            <h2 id="g-cta" className={styles.ctaTitle}>
              {guide.cta.title}
            </h2>
            <p>{guide.cta.text}</p>
          </div>
          <Link className={styles.button} to="/app">
            Open the app
          </Link>
        </section>

        {others.length > 0 && (
          <nav className={styles.more} aria-label="More calculators">
            <h2 className={styles.moreTitle}>More calculators</h2>
            {others.map((g) => (
              <Link key={g.slug} to={g.path} className={styles.moreCard}>
                <span className={styles.moreIcon}>
                  <GuideIcon slug={g.slug} />
                </span>
                <span>
                  <strong>{g.heading}</strong>
                  <span className={styles.moreText}>{g.answer.split('. ')[0]}.</span>
                </span>
                <span className={styles.arrow} aria-hidden="true">
                  →
                </span>
              </Link>
            ))}
          </nav>
        )}
      </div>
    </PublicLayout>
  );
}
