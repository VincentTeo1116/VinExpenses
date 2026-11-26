// The built page of each public guide, in each language. The app draws these pages with JavaScript; search engines and link previews do better when
// the text is already in the HTML, so the build writes it there (the app then replaces it when it starts). The words come from the same files the React pages use.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { guideFor, type Guide } from '../src/features/guides/content.ts';
import { blocksHtml, inlineText, parseArticle } from '../src/features/guides/markdown.ts';
import { ALL_SLUGS, ARTICLES, CALCULATORS, HTML_LANG, LANGS, LANG_NAME, RELATED, isArticle, pathFor, type GuideSlug, type PageLang } from '../src/features/guides/registry.ts';
import { UI } from '../src/features/guides/text.ts';

const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface BuiltPage {
  lang: PageLang;
  slug: GuideSlug;
  path: string;
  /** The file name inside the build folder, e.g. "ms/fd-calculator.html". */
  file: string;
  html: string;
}

const links = (lang: PageLang, slugs: readonly GuideSlug[], label: string) => {
  const ui = UI[lang];
  return slugs.length ? `<h2>${esc(label)}</h2><ul>${slugs.map((s) => `<li><a href="${pathFor(lang, s)}">${esc(ui.names[s] ?? s)}</a></li>`).join('')}</ul>` : '';
};

const langLinks = (lang: PageLang, slug: GuideSlug) =>
  `<p>${esc(UI[lang].languages)}: ${LANGS.map((code) => (code === lang ? `<strong>${esc(LANG_NAME[code])}</strong>` : `<a href="${pathFor(code, slug)}" hreflang="${HTML_LANG[code]}" lang="${HTML_LANG[code]}">${esc(LANG_NAME[code])}</a>`)).join(' | ')}</p>`;

function calculatorBody(guide: Guide): string {
  const ui = UI[guide.lang];
  const t = guide.table;
  return [
    '<main class="static-guide">',
    `<p><a href="/">${esc(ui.crumbHome)}</a></p>`,
    `<h1>${esc(guide.heading)}</h1>`,
    `<p>${esc(guide.answer)}</p>`,
    `<p><em>${esc(guide.disclaimer)}</em></p>`,
    langLinks(guide.lang, guide.slug),
    ...guide.sections.map((s) => `<section><h2>${esc(s.heading)}</h2>${s.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('')}</section>`),
    `<table><caption>${esc(t.caption)}</caption><thead><tr>${t.head.map((h) => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${t.rows.map((r) => `<tr>${r.map((c, i) => (i === 0 ? `<th scope="row">${esc(c)}</th>` : `<td>${esc(c)}</td>`)).join('')}</tr>`).join('')}</tbody></table>`,
    `<p>${esc(t.note)}</p>`,
    `<h2>${esc(guide.cta.title)}</h2><p>${esc(guide.cta.text)}</p><p><a href="/app">${esc(ui.openApp)}</a></p>`,
    links(guide.lang, guide.related.filter((s) => (CALCULATORS as readonly string[]).includes(s)), ui.moreCalculators),
    links(guide.lang, guide.related.filter((s) => (ARTICLES as readonly string[]).includes(s)), ui.moreGuides),
    `<noscript><p>${esc(ui.calc.fd.hint)}</p></noscript>`,
    '</main>',
  ].join('');
}

function articleBody(lang: PageLang, slug: GuideSlug, source: string): { body: string; title: string; description: string } {
  const ui = UI[lang];
  const article = parseArticle(source);
  const related = isArticle(slug) ? RELATED[slug] : [];
  const body = [
    '<main class="static-guide">',
    `<p><a href="/">${esc(ui.crumbHome)}</a></p>`,
    `<h1>${esc(inlineText(article.heading))}</h1>`,
    langLinks(lang, slug),
    blocksHtml(article.blocks),
    `<h2>${esc(ui.articleCta.title)}</h2><p>${esc(ui.articleCta.text)}</p><p><a href="/app">${esc(ui.openApp)}</a></p>`,
    links(lang, related.filter((s) => (CALCULATORS as readonly string[]).includes(s)), ui.moreCalculators),
    links(lang, related.filter((s) => (ARTICLES as readonly string[]).includes(s)), ui.moreGuides),
    '</main>',
  ].join('');
  return { body, title: article.title, description: article.description };
}

/** The page shell with this page's language, title, description, addresses, share image and text put in. */
function dress(shell: string, lang: PageLang, slug: GuideSlug, title: string, description: string, body: string, siteUrl: string, image: string | undefined): string {
  let html = shell;
  const put = (re: RegExp, text: string) => {
    html = html.replace(re, () => text);
  };
  put(/<html lang="[^"]*"/, `<html lang="${HTML_LANG[lang]}"`);
  put(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`);
  put(/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${esc(description)}" />`);
  put(/<meta property="og:title" content="[^"]*" \/>/, `<meta property="og:title" content="${esc(title)}" />`);
  put(/<meta property="og:description" content="[^"]*" \/>/, `<meta property="og:description" content="${esc(description)}" />`);
  if (siteUrl) {
    put(/<meta property="og:url" content="[^"]*" \/>/, `<meta property="og:url" content="${siteUrl}${pathFor(lang, slug)}" />`);
    put(/<link rel="canonical" href="[^"]*" \/>/, `<link rel="canonical" href="${siteUrl}${pathFor(lang, slug)}" />`);
    if (image) put(/<meta property="og:image" content="[^"]*" \/>/, `<meta property="og:image" content="${siteUrl}${image}" />\n    <meta name="twitter:image" content="${siteUrl}${image}" />`);
    const alternates = [...LANGS.map((code) => `<link rel="alternate" hreflang="${HTML_LANG[code]}" href="${siteUrl}${pathFor(code, slug)}" />`), `<link rel="alternate" hreflang="x-default" href="${siteUrl}${pathFor('en', slug)}" />`];
    put(/<\/head>/, `    ${alternates.join('\n    ')}\n  </head>`);
  }
  return html.replace('<div id="root"></div>', () => `<div id="root">${body}</div>`);
}

/** Every guide in every language, as finished HTML. `imageFor` returns the share image address of a page, or undefined when there is none. */
export function guidePages(shell: string, siteUrl: string, articlesDir: string, imageFor: (lang: PageLang, slug: GuideSlug) => string | undefined): BuiltPage[] {
  const pages: BuiltPage[] = [];
  for (const lang of LANGS) {
    for (const slug of ALL_SLUGS) {
      let title = '';
      let description = '';
      let body = '';
      if (isArticle(slug)) {
        const built = articleBody(lang, slug, readFileSync(join(articlesDir, lang, `${slug}.md`), 'utf8'));
        ({ title, description, body } = built);
      } else {
        const guide = guideFor(lang, slug);
        if (!guide) throw new Error(`no ${lang} guide for ${slug}`);
        ({ title, description } = guide);
        body = calculatorBody(guide);
      }
      const path = pathFor(lang, slug);
      pages.push({ lang, slug, path, file: `${path.slice(1)}.html`, html: dress(shell, lang, slug, title, description, body, siteUrl, imageFor(lang, slug)) });
    }
  }
  return pages;
}
