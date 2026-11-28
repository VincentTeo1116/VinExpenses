// Search engines may list the welcome, privacy and terms pages and must not list the app. Checks the generators and the built files.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, '..', 'scripts', 'seo.mts')).href);
const registry = () => import(pathToFileURL(path.join(__dirname, '..', 'src', 'features', 'guides', 'registry.ts')).href);
const dist = path.join(__dirname, '..', 'dist-e2e');
const built = fs.existsSync(path.join(dist, 'index.html'));

test('only a plain web address is accepted as the site address', async () => {
    const { cleanSiteUrl } = await load();
    assert.equal(cleanSiteUrl('https://vin.pages.dev/'), 'https://vin.pages.dev');
    assert.equal(cleanSiteUrl('https://vin.pages.dev/some/path?x=1'), 'https://vin.pages.dev');
    for (const bad of ['', undefined, 'javascript:alert(1)', 'not a url', 'ftp://x.com']) assert.equal(cleanSiteUrl(bad), '', String(bad));
});

test('robots.txt allows the public pages, keeps the private ones out, and names the sitemap only when the address is known', async () => {
    const { robotsTxt } = await load();
    const withSite = robotsTxt('https://vin.pages.dev');
    for (const line of ['Allow: /$', 'Allow: /privacy$', 'Allow: /terms$', 'Allow: /install$', 'Allow: /fd-calculator$', 'Allow: /loan-calculator$', 'Allow: /bill-calculator$', 'Allow: /ms/fd-calculator$', 'Allow: /zh/how-to-read-a-malaysian-receipt$', 'Disallow: /app/', 'Disallow: /auth', 'Disallow: /miniapp/', 'Disallow: /email-action.html', 'Sitemap: https://vin.pages.dev/sitemap.xml']) assert.ok(withSite.includes(line), line);
    assert.ok(!robotsTxt('').includes('Sitemap:'));
});

test('the sitemap lists exactly the public pages: the welcome page, every guide in every language, privacy, terms and install', async () => {
    const { sitemapXml } = await load();
    const { GUIDE_PATHS } = await registry();
    const xml = sitemapXml('https://vin.pages.dev', '2026-11-24');
    assert.deepEqual([...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]), ['https://vin.pages.dev/', ...GUIDE_PATHS.map((p) => `https://vin.pages.dev${p}`), 'https://vin.pages.dev/privacy', 'https://vin.pages.dev/terms', 'https://vin.pages.dev/install']);
    assert.equal(GUIDE_PATHS.length, 21);
    assert.ok(!/\/app|\/auth/.test(xml));
});

test('the sitemap lists addresses only (no language alternates), so the browser can still show it formatted; the language links live in each page\'s own head', async () => {
    const { sitemapXml } = await load();
    assert.ok(!sitemapXml('https://vin.pages.dev', '2026-11-24').includes('xhtml'));
});

test('the sitemap is readable, indented XML with a change hint for each public page', async () => {
    const { sitemapXml } = await load();
    const xml = sitemapXml('https://vin.pages.dev', '2026-11-24');
    assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>' + String.fromCharCode(10) + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + String.fromCharCode(10) + '  <url>' + String.fromCharCode(10)));
    assert.ok(xml.includes(['  <url>', '    <loc>https://vin.pages.dev/</loc>', '    <lastmod>2026-11-24</lastmod>', '    <changefreq>weekly</changefreq>', '    <priority>1.0</priority>', '  </url>'].join(String.fromCharCode(10))));
    assert.equal([...xml.matchAll(/<url>/g)].length, 25);
    assert.ok(!xml.includes('xml-stylesheet'), 'XSLT is gone from browsers, so no stylesheet is linked');
});

test('social tags are escaped, and absolute links appear only with a known address', async () => {
    const { seoTags } = await load();
    assert.ok(!/og:image/.test(seoTags('')));
    assert.match(seoTags('https://vin.pages.dev'), /og:image" content="https:\/\/vin\.pages\.dev\/landing\/dashboard-light\.webp"/);
});

const opts = { skip: built ? false : 'no build found (run npm run build:e2e)' };

test('the built page shell does not say "noindex" (the app is kept out by a header instead), and carries the social tags', opts, () => {
    const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
    assert.ok(!/name="robots"/i.test(html), 'a noindex tag in the shell would stop the welcome page being listed');
    assert.match(html, /property="og:title"/);
    assert.match(html, /rel="canonical"/);
});

test('the headers file keeps the app, sign-in, Mini App and email page out of search results, and not the public pages', opts, () => {
    const headers = fs.readFileSync(path.join(dist, '_headers'), 'utf8');
    for (const pattern of ['/app', '/app/*', '/auth', '/auth/*', '/email-action.html', '/miniapp/*']) {
        const block = headers.split(/\n(?=\/)/).find((b) => b.split('\n')[0].trim() === pattern);
        assert.ok(block && /X-Robots-Tag: noindex/.test(block), `${pattern} has no noindex header`);
    }
    for (const pattern of ['/privacy', '/terms', '/']) assert.ok(!headers.split(/\n(?=\/)/).some((b) => b.split('\n')[0].trim() === pattern && /noindex/.test(b)), `${pattern} must stay listable`);
});

test('the built robots.txt and sitemap exist', opts, () => {
    assert.match(fs.readFileSync(path.join(dist, 'robots.txt'), 'utf8'), /Disallow: \/app\//);
    assert.match(fs.readFileSync(path.join(dist, 'sitemap.xml'), 'utf8'), /<loc>http:\/\/127\.0\.0\.1:4173\/privacy<\/loc>/);
});

test('every app address also exists as a real copy of the page, so hosts without rewrite rules (Workers assets) answer them', opts, () => {
    const index = fs.readFileSync(path.join(dist, 'index.html'));
    const paths = ['app', 'app/history', 'app/plan', 'app/account', 'app/admin', 'app/report', 'auth', 'auth/setup', 'welcome', 'privacy', 'terms', 'install'];
    const OWN = ['privacy', 'terms', 'install']; // these two are listed in the sitemap, so they name their own address as canonical; the rest is the same page
    const plain = (buffer) => buffer.toString('utf8').replace(/<link rel="canonical" href="[^"]*" \/>/, '').replace(/<meta property="og:url" content="[^"]*" \/>/, '');
    for (const p of paths) {
      const page = fs.readFileSync(path.join(dist, `${p}.html`));
      if (OWN.includes(p)) {
        assert.equal(plain(page), plain(index), `${p}.html differs from the page in more than its address`);
        assert.match(page.toString('utf8'), new RegExp(`<link rel="canonical" href="http://127\\.0\\.0\\.1:4173/${p}" />`), `${p}.html canonical`);
        assert.match(page.toString('utf8'), new RegExp(`<meta property="og:url" content="http://127\\.0\\.0\\.1:4173/${p}" />`), `${p}.html og:url`);
      } else assert.ok(page.equals(index), `${p}.html`);
    }
    assert.ok(!fs.existsSync(path.join(dist, 'nothing-here.html')));
    assert.ok(fs.existsSync(path.join(dist, '404.html')));
});
