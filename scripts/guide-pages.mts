// The built page of each public guide. The app draws these pages with JavaScript; search engines and link previews do better when the text
// is already in the HTML, so the build writes it there (the app then replaces it when it starts). The words come from the same file the
// React page uses (src/features/guides/content.ts), so the two can never disagree.
import { GUIDES, type Guide } from '../src/features/guides/content';

const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The readable text of a guide as plain HTML (no scripts, no inline styles, no outside addresses). */
export function guideBody(guide: Guide): string {
  const table = guide.table;
  const related = guide.related
    .map((slug) => GUIDES.find((g) => g.slug === slug))
    .filter((g): g is Guide => Boolean(g))
    .map((g) => `<li><a href="${g.path}">${esc(g.heading)}</a></li>`)
    .join('');
  return [
    '<main class="static-guide">',
    '<p><a href="/">VinExpenses</a></p>',
    `<h1>${esc(guide.heading)}</h1>`,
    `<p>${esc(guide.answer)}</p>`,
    `<p><em>${esc(guide.disclaimer)}</em></p>`,
    ...guide.sections.map((s) => `<section><h2>${esc(s.heading)}</h2>${s.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('')}</section>`),
    `<table><caption>${esc(table.caption)}</caption><thead><tr>${table.head.map((h) => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${table.rows
      .map((r) => `<tr>${r.map((c, i) => (i === 0 ? `<th scope="row">${esc(c)}</th>` : `<td>${esc(c)}</td>`)).join('')}</tr>`)
      .join('')}</tbody></table>`,
    `<p>${esc(table.note)}</p>`,
    `<h2>${esc(guide.cta.title)}</h2><p>${esc(guide.cta.text)}</p><p><a href="/app">Open the app</a></p>`,
    related ? `<h2>More calculators</h2><ul>${related}</ul>` : '',
    '<noscript><p>The calculator needs JavaScript. Turn it on in your browser settings.</p></noscript>',
    '</main>',
  ].join('');
}

/** The page shell with this guide's title, description, address and text put in. */
export function guidePage(shell: string, guide: Guide, siteUrl: string): string {
  let html = shell;
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(guide.title)}</title>`);
  html = html.replace(/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${esc(guide.description)}" />`);
  html = html.replace(/<meta property="og:title" content="[^"]*" \/>/, `<meta property="og:title" content="${esc(guide.title)}" />`);
  html = html.replace(/<meta property="og:description" content="[^"]*" \/>/, `<meta property="og:description" content="${esc(guide.description)}" />`);
  if (siteUrl) {
    html = html.replace(/<meta property="og:url" content="[^"]*" \/>/, `<meta property="og:url" content="${siteUrl}${guide.path}" />`);
    html = html.replace(/<link rel="canonical" href="[^"]*" \/>/, `<link rel="canonical" href="${siteUrl}${guide.path}" />`);
  }
  return html.replace('<div id="root"></div>', `<div id="root">${guideBody(guide)}</div>`);
}
