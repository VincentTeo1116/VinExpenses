// What one public guide address shows: a calculator, or an article read from its markdown file (downloaded only when that page is opened).
import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { NotFound } from '@/pages/NotFound';
import { PublicLayout } from '@/features/public/PublicLayout';
import { BillCalculator, FdCalculator, LoanCalculator } from './Calculators';
import { guideFor } from './content';
import { GuideFrame, TableCard } from './GuidePage';
import { inlineText, parseArticle, type Article, type Block, type Inline } from './markdown';
import { isArticle, isCalculator, RELATED, type CalculatorSlug, type PageLang } from './registry';
import { UI } from './text';
import styles from './GuidePage.module.css';

const files = import.meta.glob('/src/content/articles/*/*.md', { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>;

function Inlines({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        if (n.t === 'text') return <Fragment key={i}>{n.v}</Fragment>;
        if (n.t === 'code') return <code key={i}>{n.v}</code>;
        if (n.t === 'a') return <Link key={i} to={n.href}><Inlines nodes={n.c} /></Link>;
        return n.t === 'b' ? <strong key={i}><Inlines nodes={n.c} /></strong> : <em key={i}><Inlines nodes={n.c} /></em>;
      })}
    </>
  );
}

function Blocks({ blocks, fallbackLabel }: { blocks: Block[]; fallbackLabel: string }) {
  // each table is named after the heading above it
  const labels = blocks.reduce<string[]>((all, b, i) => [...all, b.t === 'h2' ? inlineText(b.c) : (all[i - 1] ?? fallbackLabel)], []);
  return (
    <>
      {blocks.map((b, i) => {
        if (b.t === 'h2') return <h2 key={i} className={styles.h2}><Inlines nodes={b.c} /></h2>;
        if (b.t === 'p') return <p key={i}><Inlines nodes={b.c} /></p>;
        if (b.t === 'ul') return <ul key={i}>{b.items.map((item, k) => <li key={k}><Inlines nodes={item} /></li>)}</ul>;
        if (b.t === 'ol') return <ol key={i}>{b.items.map((item, k) => <li key={k}><Inlines nodes={item} /></li>)}</ol>;
        return (
          <TableCard
            key={i}
            caption={labels[i] ?? fallbackLabel}
            head={<tr>{b.head.map((h, k) => <th key={k} scope="col"><Inlines nodes={h} /></th>)}</tr>}
          >
            {b.rows.map((row, r) => (
              <tr key={r}>{row.map((cell, c) => (c === 0 ? <th key={c} scope="row"><Inlines nodes={cell} /></th> : <td key={c}><Inlines nodes={cell} /></td>))}</tr>
            ))}
          </TableCard>
        );
      })}
    </>
  );
}

function CalculatorPage({ lang, slug }: { lang: PageLang; slug: CalculatorSlug }) {
  const ui = UI[lang];
  const guide = guideFor(lang, slug);
  if (!guide) return <NotFound />;
  return (
    <GuideFrame lang={lang} slug={slug} title={guide.title} description={guide.description} heading={guide.heading} shortName={ui.names[slug] ?? guide.heading} eyebrow={ui.free} kind="calculator" intro={<p className={styles.answer}>{guide.answer}</p>} related={guide.related} cta={guide.cta}>
      <div className={styles.tool}>{slug === 'fd-calculator' ? <FdCalculator /> : slug === 'loan-calculator' ? <LoanCalculator /> : <BillCalculator />}</div>
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
      <TableCard caption={guide.table.caption} note={guide.table.note} head={<tr>{guide.table.head.map((h) => <th key={h} scope="col">{h}</th>)}</tr>}>
        {guide.table.rows.map((row) => (
          <tr key={row[0]}>{row.map((cell, i) => (i === 0 ? <th key={cell} scope="row">{cell}</th> : <td key={`${row[0]}-${i}`}>{cell}</td>))}</tr>
        ))}
      </TableCard>
    </GuideFrame>
  );
}

function ArticlePage({ lang, slug }: { lang: PageLang; slug: string }) {
  const ui = UI[lang];
  const key = `/src/content/articles/${lang}/${slug}.md`;
  const load = files[key];
  const [loaded, setLoaded] = useState<{ key: string; article: Article } | null>(null);
  useEffect(() => {
    let live = true;
    if (load) void load().then((text) => live && setLoaded({ key, article: parseArticle(text) }));
    return () => {
      live = false;
    };
  }, [key, load]);

  if (!load) return <NotFound />;
  const article = loaded?.key === key ? loaded.article : undefined;
  if (article === undefined) {
    return (
      <PublicLayout>
        <div className={styles.wrap} aria-busy="true" />
      </PublicLayout>
    );
  }
  const [y, m, d] = article.checked.split('-').map(Number) as [number, number, number];
  const when = Number.isFinite(y) ? new Date(y, m - 1, d).toLocaleDateString(ui.locale, { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  const heading = inlineText(article.heading);
  return (
    <GuideFrame lang={lang} slug={slug as never} title={article.title} description={article.description} heading={heading} shortName={article.short} eyebrow={ui.guide} kind="article" intro={when ? <p className={styles.checked}>{ui.checked(when)}</p> : undefined} related={RELATED[slug as keyof typeof RELATED] ?? []} cta={ui.articleCta}>
      <article className={styles.article}>
        <Blocks blocks={article.blocks} fallbackLabel={heading} />
      </article>
    </GuideFrame>
  );
}

export function GuideRoute({ lang, slug }: { lang: PageLang; slug: string }) {
  if (isCalculator(slug)) return <CalculatorPage lang={lang} slug={slug} />;
  if (isArticle(slug)) return <ArticlePage lang={lang} slug={slug} />;
  return <NotFound />;
}
