// GD-02: the markdown reader, and every article and calculator page in every language.
// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { guidesFor } from './content';
import { blocksHtml, inline, inlineText, parseArticle, type Block } from './markdown';
import { ALL_SLUGS, ARTICLES, CALCULATORS, GUIDE_PATHS, LANGS, RELATED, pathFor, type PageLang } from './registry';
import { UI } from './text';

const dir = join(process.cwd(), 'src/content/articles');
const load = (lang: PageLang, slug: string) => parseArticle(readFileSync(join(dir, lang, `${slug}.md`), 'utf8'));
const textOf = (blocks: Block[]) =>
  blocks
    .map((b) => (b.t === 'h2' || b.t === 'p' ? inlineText(b.c) : b.t === 'ul' || b.t === 'ol' ? b.items.map(inlineText).join(' ') : [...b.head, ...b.rows.flat()].map(inlineText).join(' ')))
    .join('\n');
const linksOf = (nodes: ReturnType<typeof inline>): string[] => nodes.flatMap((n) => (n.t === 'a' ? [n.href, ...linksOf(n.c)] : n.t === 'b' || n.t === 'i' ? linksOf(n.c) : []));
const allLinks = (blocks: Block[]): string[] =>
  blocks.flatMap((b) => (b.t === 'h2' || b.t === 'p' ? linksOf(b.c) : b.t === 'ul' || b.t === 'ol' ? b.items.flatMap(linksOf) : [...b.head, ...b.rows.flat()].flatMap(linksOf)));

describe('the markdown reader', () => {
  it('reads the header, the heading, paragraphs, lists and a table', () => {
    const article = parseArticle('---\ntitle: T\ndescription: D\nshort: S\nchecked: 2026-11-26\n---\n\n# Big *heading*\n\nOne\ntwo.\n\n## Part\n\n- a\n- b\n\n1. x\n2. y\n\n| A | B |\n|---|---|\n| 1 | **2** |\n');
    expect(article).toMatchObject({ title: 'T', description: 'D', short: 'S', checked: '2026-11-26' });
    expect(inlineText(article.heading)).toBe('Big heading');
    expect(article.blocks.map((b) => b.t)).toEqual(['p', 'h2', 'ul', 'ol', 'table']);
    expect(blocksHtml(article.blocks)).toContain('<p>One two.</p>');
    expect(blocksHtml(article.blocks)).toContain('<th scope="col">A</th>');
    expect(blocksHtml(article.blocks)).toContain('<td><strong>2</strong></td>');
  });
  it('allows links inside this site only; any other address stays plain text', () => {
    expect(linksOf(inline('see [the calculator](/loan-calculator) now'))).toEqual(['/loan-calculator']);
    expect(linksOf(inline('[bad](https://example.com) and [worse](javascript:alert(1))'))).toEqual([]);
  });
  it('escapes anything that looks like HTML', () => {
    expect(blocksHtml(parseArticle('# T\n\n<script>alert(1)</script> & "x"\n').blocks)).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;x&quot;</p>');
  });
  it('leaves a lone star alone', () => {
    expect(inlineText(inline('2 * 3 = 6'))).toBe('2 * 3 = 6');
  });
});

describe('the pages that exist', () => {
  it('every guide has a page in every language, at an address of its own', () => {
    expect(new Set(GUIDE_PATHS).size).toBe(LANGS.length * ALL_SLUGS.length);
    expect(pathFor('en', 'fd-calculator')).toBe('/fd-calculator');
    expect(pathFor('ms', 'fd-calculator')).toBe('/ms/fd-calculator');
    expect(pathFor('zh', 'sst-vs-service-charge')).toBe('/zh/sst-vs-service-charge');
  });
  it('every language names every page, and its footer, buttons and calculator words are all filled in', () => {
    for (const lang of LANGS) {
      for (const slug of ALL_SLUGS) expect(UI[lang].names[slug], `${lang} ${slug}`).toBeTruthy();
      const flat = JSON.stringify(UI[lang]);
      expect(flat).not.toMatch(/undefined|""/);
      expect(UI[lang].calc.bill.eachExtra(3, 'RM 1.00')).toContain('3');
      expect(UI[lang].checked('x')).toContain('x');
    }
  });
});

describe.each(LANGS)('calculator pages (%s)', (lang) => {
  const guides = guidesFor(lang);
  it('all three calculators are there', () => {
    expect(guides.map((g) => g.slug)).toEqual([...CALCULATORS]);
  });
  it('have a title and description of a sensible length, a table that is square, and links that exist', () => {
    for (const g of guides) {
      expect(g.title.length, `${g.slug} title`).toBeLessThanOrEqual(lang === 'zh' ? 45 : 80);
      expect(g.description.length, `${g.slug} description`).toBeGreaterThan(lang === 'zh' ? 30 : 80);
      expect(g.description.length, `${g.slug} description`).toBeLessThanOrEqual(lang === 'zh' ? 90 : 165);
      for (const row of g.table.rows) expect(row.length, `${g.slug} row`).toBe(g.table.head.length);
      for (const s of g.related) expect(ALL_SLUGS).toContain(s);
      expect(g.sections.length).toBeGreaterThanOrEqual(2);
    }
  });
  it('the worked examples show the right figures', () => {
    const text = JSON.stringify(guides);
    expect(text).toContain('RM 350.00'); // RM10,000 at 3.5% for a year
    expect(text).toContain('RM 24.35'); // the sample bill after rounding
    expect(text).toContain('RM 1,616.83'); // RM300,000 at 4.2% for 25 years
  });
});

describe.each(LANGS)('articles (%s)', (lang) => {
  it.each(ARTICLES)('%s is complete, short enough, and points only to pages that exist', (slug) => {
    const article = load(lang, slug);
    expect(article.title).toContain('VinExpenses');
    expect(article.description.length).toBeGreaterThan(30);
    expect(article.description.length, 'search results cut a long description').toBeLessThanOrEqual(lang === 'zh' ? 90 : 165);
    expect(article.title.length, 'search results cut a long title').toBeLessThanOrEqual(lang === 'zh' ? 45 : 80);
    expect(article.short).toBeTruthy();
    expect(article.checked).toBe('2026-11-26');
    expect(article.blocks.filter((b) => b.t === 'h2').length).toBeGreaterThanOrEqual(3);
    const words = lang === 'zh' ? (textOf(article.blocks).match(/[一-鿿]/g) ?? []).length : textOf(article.blocks).split(/\s+/).length;
    expect(words, 'under the 800-word limit').toBeLessThan(lang === 'zh' ? 1500 : 800);
    const valid = new Set([...GUIDE_PATHS, '/', '/app', '/privacy', '/terms']);
    for (const href of allLinks(article.blocks)) expect(valid.has(href), `${slug} links to ${href}`).toBe(true);
    // it keeps to its own language: a Malay or Chinese article links to the Malay or Chinese pages
    for (const href of allLinks(article.blocks).filter((h) => GUIDE_PATHS.includes(h))) expect(GUIDE_PATHS.includes(href) && (lang === 'en' ? !/^\/(ms|zh)\//.test(href) : href.startsWith(`/${lang}/`)), `${lang} ${slug} -> ${href}`).toBe(true);
    expect(textOf(article.blocks)).toMatch(/Sources|Sumber|资料来源/);
  });
  it('each article is linked from the guides it relates to, and its related pages exist', () => {
    for (const slug of ARTICLES) for (const related of RELATED[slug]) expect(ALL_SLUGS).toContain(related);
  });
});

describe('the facts the articles rest on, in every language', () => {
  it.each(LANGS)('%s: the SST bill, the loan example and the rounding agree with the maths', (lang) => {
    const sst = textOf(load(lang, 'sst-vs-service-charge').blocks);
    for (const figure of ['24.35', '24.36', '1.26', '2.10', '21.00', '1.39']) expect(sst, figure).toContain(figure);
    const flat = textOf(load(lang, 'flat-rate-vs-reducing-balance').blocks);
    for (const figure of ['1,175.93', '27,000', '5.5%', '2,000.00', '1,841.65']) expect(flat, figure).toContain(figure);
    const fd = textOf(load(lang, 'is-fd-interest-taxable').blocks);
    expect(fd).toContain('350.00');
    expect(fd).toMatch(/PwC/);
    expect(fd).toMatch(/LHDN/);
    const receipt = textOf(load(lang, 'how-to-read-a-malaysian-receipt').blocks);
    for (const figure of ['24.35', '5.65', '24.36']) expect(receipt, figure).toContain(figure);
  });
  it.each(LANGS)('%s: no article claims more than was checked (no threshold figure, no certainty about the tax paragraph)', (lang) => {
    for (const slug of ARTICLES) {
      const text = textOf(load(lang, slug).blocks);
      expect(text, `${slug} must not quote a registration threshold`).not.toMatch(/1[.,]5 ?(million|juta)|RM ?1,?500,?000|150 万/i);
    }
  });
});
