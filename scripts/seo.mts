// Search-engine files and tags, written at build time. The public pages (welcome, privacy, terms) may be found by search engines;
// the app, the sign-in page, the Mini App and the email page may not (they also carry a no-index header, see headers.mts).
import { ALL_SLUGS, ARTICLES, GUIDE_PATHS, LANGS, pathFor } from '../src/features/guides/registry.ts';

export const PUBLIC_PATHS: readonly string[] = ['/', ...GUIDE_PATHS, '/privacy', '/terms'];
export const PRIVATE_PATHS = ['/app/', '/auth', '/miniapp/', '/email-action.html'] as const;

/** The site's address without a trailing slash, or '' when it is not set (or not a plain http(s) address). */
export function cleanSiteUrl(value: string | undefined): string {
  try {
    const url = new URL(String(value ?? ''));
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : '';
  } catch {
    return '';
  }
}

export function robotsTxt(siteUrl: string): string {
  const lines = ['User-agent: *', ...PUBLIC_PATHS.map((p) => (p === '/' ? 'Allow: /$' : `Allow: ${p}$`)), ...PRIVATE_PATHS.map((p) => `Disallow: ${p}`)];
  if (siteUrl) lines.push('', `Sitemap: ${siteUrl}/sitemap.xml`);
  return `${lines.join('\n')}\n`;
}

/** How often each public page changes and how important it is (search engines treat these as hints only). */
const PAGE_HINTS: Record<string, { changefreq: string; priority: string }> = {
  '/': { changefreq: 'weekly', priority: '1.0' },
  '/privacy': { changefreq: 'monthly', priority: '0.5' },
  '/terms': { changefreq: 'monthly', priority: '0.5' },
};
for (const lang of LANGS) {
  for (const slug of ALL_SLUGS) PAGE_HINTS[pathFor(lang, slug)] = { changefreq: 'monthly', priority: (ARTICLES as readonly string[]).includes(slug) ? '0.7' : '0.8' };
}

/** The sitemap: valid, indented XML. A person who opens it in a browser sees it in the browser's own XML viewer (the headers let that viewer style itself). */
export function sitemapXml(siteUrl: string, today: string): string {
  const urls = PUBLIC_PATHS.map((p) => {
    const hint = PAGE_HINTS[p] ?? { changefreq: 'monthly', priority: '0.5' };
    return `  <url>\n    <loc>${siteUrl}${p}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>${hint.changefreq}</changefreq>\n    <priority>${hint.priority}</priority>\n  </url>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** Tags for the page shell. Social apps read these without running any script, so they are written into the HTML itself. */
export function seoTags(siteUrl: string, image = '/landing/dashboard-light.webp'): string {
  const title = 'VinExpenses: track spending, budgets, deposits and loans';
  const description = 'A free expense tracker for Malaysia: scan receipts, set budgets, plan fixed deposits and loans, and get reminders. No ads, and your records stay private.';
  const tags = [
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="VinExpenses" />`,
    `<meta property="og:title" content="${escape(title)}" />`,
    `<meta property="og:description" content="${escape(description)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
  ];
  if (siteUrl) {
    tags.push(`<meta property="og:url" content="${siteUrl}/" />`, `<meta property="og:image" content="${siteUrl}${image}" />`, `<link rel="canonical" href="${siteUrl}/" />`);
  }
  return tags.join('\n    ');
}
