// The public guide pages and their languages in one place; plain data with no imports, so the build and the tests can read it too.
export const LANGS = ['en', 'ms', 'zh'] as const;
export type PageLang = (typeof LANGS)[number];

export const HTML_LANG: Record<PageLang, string> = { en: 'en', ms: 'ms', zh: 'zh-Hans' };
export const LANG_NAME: Record<PageLang, string> = { en: 'English', ms: 'Bahasa Malaysia', zh: '中文' };

export const CALCULATORS = ['fd-calculator', 'loan-calculator', 'bill-calculator'] as const;
export const ARTICLES = ['flat-rate-vs-reducing-balance', 'sst-vs-service-charge', 'is-fd-interest-taxable', 'how-to-read-a-malaysian-receipt'] as const;
export type CalculatorSlug = (typeof CALCULATORS)[number];
export type ArticleSlug = (typeof ARTICLES)[number];
export type GuideSlug = CalculatorSlug | ArticleSlug;

export const ALL_SLUGS: readonly GuideSlug[] = [...CALCULATORS, ...ARTICLES];

/** English pages live at the root; Malay and Chinese ones under /ms and /zh. */
export const pathFor = (lang: PageLang, slug: string): string => (lang === 'en' ? `/${slug}` : `/${lang}/${slug}`);

export const GUIDE_PATHS: string[] = LANGS.flatMap((lang) => ALL_SLUGS.map((slug) => pathFor(lang, slug)));

export function langOfPath(pathname: string): PageLang {
  if (pathname === '/ms' || pathname.startsWith('/ms/')) return 'ms';
  if (pathname === '/zh' || pathname.startsWith('/zh/')) return 'zh';
  return 'en';
}

/** The guides each article points on to. */
export const RELATED: Record<ArticleSlug, GuideSlug[]> = {
  'flat-rate-vs-reducing-balance': ['loan-calculator', 'sst-vs-service-charge', 'is-fd-interest-taxable'],
  'sst-vs-service-charge': ['bill-calculator', 'how-to-read-a-malaysian-receipt', 'flat-rate-vs-reducing-balance'],
  'is-fd-interest-taxable': ['fd-calculator', 'flat-rate-vs-reducing-balance', 'loan-calculator'],
  'how-to-read-a-malaysian-receipt': ['bill-calculator', 'sst-vs-service-charge', 'is-fd-interest-taxable'],
};

export const isCalculator = (slug: string): slug is CalculatorSlug => (CALCULATORS as readonly string[]).includes(slug);
export const isArticle = (slug: string): slug is ArticleSlug => (ARTICLES as readonly string[]).includes(slug);
